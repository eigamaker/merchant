import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { PNG } from "pngjs";
import { MAP_TILE_PALETTE_FILE, savePaletteAtomically } from "./map-tile-pipeline.mjs";

export const MAP_SHEET_IMPORT_DIR = path.resolve("assets-src/map-tiles/sheets/imported");
export const ACTOR_IMPORT_DIR = path.resolve("assets-src/actors/imported");
export const MAP_IMPORT_MANIFEST = path.resolve("assets-src/map-tiles/imports.json");
export const ACTOR_IMPORT_MANIFEST = path.resolve("assets-src/actors/imports.json");
export const IMPORT_MAX_BYTES = 100 * 1024 * 1024;
export const IMPORT_MAX_UNPACKED_BYTES = 500 * 1024 * 1024;
export const IMPORT_MAX_ENTRIES = 10_000;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  processEntities: false,
  htmlEntities: false,
});

const ACTIONS = ["idle", "walk", "run", "attack", "walkAttack", "runAttack", "hurt", "death"];
const IMAGE_EXTENSIONS = new Set([".png"]);
const normalizeName = (value) => String(value ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
const array = (value) => value === undefined ? [] : Array.isArray(value) ? value : [value];

function issue(message, file) {
  return file ? `${file}: ${message}` : message;
}

function safeEntryName(value) {
  const name = normalizeName(value);
  if (!name || name.startsWith("/") || name.split("/").some((part) => part === ".." || part === "")) return undefined;
  return name;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function pngInfo(bytes, source) {
  if (bytes.length < 33 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error(issue("PNG signature is missing", source));
  if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") throw new Error(issue("PNG IHDR is missing", source));
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), bitDepth = bytes[24], colorType = bytes[25];
  let decoded;
  try { decoded = PNG.sync.read(bytes); } catch (error) { throw new Error(issue(`PNG decode failed: ${error.message}`, source)); }
  return { width, height, bitDepth, colorType, data: decoded.data };
}

function normalizedPng(bytes, source) {
  const decoded = PNG.sync.read(bytes);
  return PNG.sync.write({ width: decoded.width, height: decoded.height, data: Buffer.from(decoded.data) });
}

function cellGeometry(width, height, tileSize, margin = 0, spacing = 0) {
  const step = tileSize + spacing;
  const innerWidth = width - margin * 2 + spacing;
  const innerHeight = height - margin * 2 + spacing;
  if (innerWidth < tileSize || innerHeight < tileSize || innerWidth % step !== 0 || innerHeight % step !== 0) return undefined;
  return { columns: innerWidth / step, rows: innerHeight / step, frameCount: (innerWidth / step) * (innerHeight / step) };
}

function boundaryScore(info, tileSize) {
  const { width, height, data } = info;
  const pixel = (x, y) => (y * width + x) * 4;
  const difference = (a, b) => Math.abs(data[a] - data[b]) + Math.abs(data[a + 1] - data[b + 1]) + Math.abs(data[a + 2] - data[b + 2]) + Math.abs(data[a + 3] - data[b + 3]);
  let boundary = 0, boundaryCount = 0, internal = 0, internalCount = 0;
  for (let x = 1; x < width; x += 1) for (let y = 0; y < height; y += 1) { const value = difference(pixel(x - 1, y), pixel(x, y)); if (x % tileSize === 0) { boundary += value; boundaryCount += 1; } else { internal += value; internalCount += 1; } }
  for (let y = 1; y < height; y += 1) for (let x = 0; x < width; x += 1) { const value = difference(pixel(x, y - 1), pixel(x, y)); if (y % tileSize === 0) { boundary += value; boundaryCount += 1; } else { internal += value; internalCount += 1; } }
  const boundaryMean = boundaryCount ? boundary / boundaryCount : 0;
  const internalMean = internalCount ? internal / internalCount : 0;
  return { boundaryMean, internalMean, ratio: internalMean ? boundaryMean / internalMean : 0 };
}

function sheetSuggestions(bytes, source) {
  const info = pngInfo(bytes, source);
  const candidates = [16, 32].map((tileSize) => {
    const geometry = cellGeometry(info.width, info.height, tileSize, 0, 0);
    return geometry ? { tileSize, margin: 0, spacing: 0, ...geometry, boundary: boundaryScore(info, tileSize) } : undefined;
  }).filter(Boolean);
  let suggestedTileSize;
  const available = candidates.map((candidate) => candidate.tileSize);
  if (available.length === 1) suggestedTileSize = available[0];
  else if (candidates.length === 2) {
    const first = candidates.find((candidate) => candidate.tileSize === 16);
    const second = candidates.find((candidate) => candidate.tileSize === 32);
    if (second.boundary.ratio >= first.boundary.ratio * 1.5) suggestedTileSize = 32;
    else if (first.boundary.ratio >= second.boundary.ratio * 1.5) suggestedTileSize = 16;
  }
  return { width: info.width, height: info.height, bitDepth: info.bitDepth, colorType: info.colorType, candidates, suggestedTileSize, normalized: info.colorType !== 6 || info.bitDepth !== 8 };
}

function slug(value, fallback = "asset") {
  const text = String(value ?? "").normalize("NFKC").toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return text || fallback;
}

function actionFromName(name) {
  const lower = name.toLowerCase().replaceAll("-", "_");
  const candidates = [
    ["walk_attack", "walkAttack"], ["run_attack", "runAttack"], ["idle", "idle"], ["walk", "walk"], ["run", "run"], ["attack", "attack"], ["hurt", "hurt"], ["death", "death"],
  ];
  return candidates.find(([token]) => lower.includes(token))?.[1];
}

function actorFamily(name) {
  const lower = name.toLowerCase();
  if (lower.includes("unarmed")) return "unarmed";
  if (lower.includes("sword")) return "sword";
  const base = path.basename(name).split("_")[0];
  return slug(base, "actor");
}

function imageSourceFromTileset(tileset) {
  const image = array(tileset.image)[0];
  return typeof image?.["@_source"] === "string" ? normalizeName(image["@_source"]) : undefined;
}

function resolveRelative(baseFile, target) {
  const raw = normalizeName(target);
  if (!raw || raw.startsWith("/")) return undefined;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(baseFile), raw));
  return safeEntryName(resolved);
}

function parseXml(bytes, source) {
  const text = Buffer.from(bytes).toString("utf8");
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error(issue("DOCTYPE and external entities are not allowed", source));
  try { return xmlParser.parse(text); } catch (error) { throw new Error(issue(`XML parse failed: ${error.message}`, source)); }
}

function classifyTmx(document, fileName, tilesets) {
  const map = document.map ?? document.tileset;
  const layers = array(map?.layer).map((layer) => String(layer?.["@_name"] ?? "").toLowerCase());
  const names = tilesets.map((entry) => `${entry.name} ${entry.image ?? ""}`.toLowerCase()).join(" ");
  const animations = tilesets.reduce((count, entry) => count + entry.animationCount, 0);
  const actionSignal = ACTIONS.some((action) => names.includes(action.toLowerCase())) || layers.some((layer) => /body|head|shadow|swing|red|full/.test(layer));
  if (animations > 0 && actionSignal) return { target: "actor", confidence: "high", reason: "tile animations and action/layer naming" };
  if (animations === 0 && !actionSignal) return { target: "mapTiles", confidence: "medium", reason: "static tileset" };
  return { target: "manual", confidence: "low", reason: "TMX contains mixed or ambiguous signals" };
}

function actorClipFromImage(fileName, bytes, tmxTileSize, durationsMs) {
  const info = pngInfo(bytes, fileName);
  const action = actionFromName(path.basename(fileName));
  const frameHeight = info.height % 4 === 0 ? info.height / 4 : undefined;
  const frameWidth = frameHeight && info.width % frameHeight === 0 ? frameHeight : undefined;
  const average = durationsMs?.length ? durationsMs.reduce((sum, duration) => sum + duration, 0) / durationsMs.length : 150;
  return { action, path: fileName, width: info.width, height: info.height, frameWidth, frameHeight, columns: frameWidth ? info.width / frameWidth : undefined, rows: 4, tileSize: tmxTileSize, directions: ["down", "up", "left", "right"], frameRate: Math.round((1000 / average) * 100) / 100, durationsMs };
}

function parseTmxFile(fileName, bytes, files) {
  const document = parseXml(bytes, fileName);
  const root = document.map ?? document.tileset;
  if (!root) return { tilesets: [], classification: { target: "manual", confidence: "low", reason: "not a Tiled map/tileset" }, actors: [], warnings: [issue("TMX/TSX root is missing", fileName)] };
  const sourceTilesets = array(root.tileset);
  const tilesets = [];
  const actorClips = [];
  const warnings = [];
  for (const raw of sourceTilesets) {
    let tileset = raw;
    let tilesetFile = fileName;
    if (typeof raw?.["@_source"] === "string") {
      const resolved = resolveRelative(fileName, raw["@_source"]);
      if (!resolved || !files.has(resolved)) { warnings.push(issue(`external TSX is missing: ${raw["@_source"]}`, fileName)); continue; }
      tilesetFile = resolved;
      tileset = parseXml(files.get(resolved), resolved).tileset;
    }
    const imageSource = imageSourceFromTileset(tileset);
    const imagePath = imageSource ? resolveRelative(tilesetFile, imageSource) : undefined;
    if (!imagePath || !files.has(imagePath)) { warnings.push(issue(`tileset image is missing: ${imageSource ?? "(none)"}`, tilesetFile)); continue; }
    const imageBytes = files.get(imagePath);
    const image = pngInfo(imageBytes, imagePath);
    const tilewidth = Number(tileset["@_tilewidth"] ?? root["@_tilewidth"] ?? 0);
    const tileheight = Number(tileset["@_tileheight"] ?? root["@_tileheight"] ?? 0);
    const margin = Number(tileset["@_margin"] ?? 0), spacing = Number(tileset["@_spacing"] ?? 0);
    const geometry = tilewidth === tileheight && (tilewidth === 16 || tilewidth === 32) ? cellGeometry(image.width, image.height, tilewidth, margin, spacing) : undefined;
    if (!geometry) warnings.push(issue(`tileset geometry does not fit a 16/32px square grid (${image.width}x${image.height})`, imagePath));
    const tileEntries = array(tileset.tile);
    const durationsMs = tileEntries.flatMap((tile) => array(tile?.animation?.frame).map((frame) => Number(frame?.["@_duration"]))).filter((duration) => Number.isFinite(duration) && duration > 0).slice(0, 64);
    const animationCount = tileEntries.filter((tile) => tile?.animation).length;
    const entry = { name: String(tileset["@_name"] ?? path.basename(imagePath, ".png")), image: imagePath, width: image.width, height: image.height, tileSize: tilewidth, margin, spacing, geometry, animationCount, sourceFile: fileName };
    tilesets.push(entry);
    if (imagePath.toLowerCase().includes("with_shadow") && !imagePath.toLowerCase().includes("parts")) actorClips.push(actorClipFromImage(imagePath, imageBytes, tilewidth, durationsMs.length ? durationsMs : undefined));
  }
  const classification = classifyTmx(document, fileName, tilesets);
  const actorGroups = new Map();
  for (const clip of actorClips) {
    if (!clip.action || !clip.frameWidth || !clip.frameHeight) continue;
    const family = actorFamily(clip.path);
    if (!actorGroups.has(family)) actorGroups.set(family, []);
    actorGroups.get(family).push(clip);
  }
  const actors = [...actorGroups.entries()].map(([family, clips]) => ({ id: slug(`${path.basename(fileName, path.extname(fileName))}-${family}`), label: `${family} (${path.basename(fileName)})`, sourcePack: fileName, roles: ["enemy"], clips: Object.fromEntries(clips.map((clip) => [clip.action, clip])), warnings: clips.some((clip) => !clip.columns) ? ["フレーム寸法を自動判定できないアクションがあります"] : [] }));
  return { tilesets, classification, actors, warnings };
}

function archiveFiles(bytes, fileName) {
  if (bytes.length > IMPORT_MAX_BYTES) throw new Error(`input exceeds ${IMPORT_MAX_BYTES} bytes`);
  const entries = unzipSync(bytes);
  const files = new Map();
  let total = 0;
  for (const [rawName, value] of Object.entries(entries)) {
    const name = safeEntryName(rawName);
    if (!name || name.endsWith("/")) continue;
    if (name.startsWith("__MACOSX/")) continue;
    if (value.length > IMPORT_MAX_UNPACKED_BYTES || (total += value.length) > IMPORT_MAX_UNPACKED_BYTES) throw new Error("unpacked archive exceeds safety limit");
    if (files.size >= IMPORT_MAX_ENTRIES) throw new Error("archive contains too many files");
    files.set(name, Buffer.from(value));
  }
  return files;
}

function sourceRecord(fileName, bytes) {
  return { fileName, bytes: bytes.length, sha256: sha256(bytes) };
}

function mapCandidate(id, label, sourcePath, bytes, suggestions, extra = {}) {
  return { id, label, sourcePath, ...suggestions, mapKinds: ["home", "dungeon"], defaultLayer: "decoration", defaultWalkable: false, selected: false, warnings: [], ...extra, _bytes: bytes };
}

export function analyzeImport(input, { fileName = "input" } = {}) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const isZip = bytes.subarray(0, 2).toString("ascii") === "PK" || /\.zip$/i.test(fileName);
  const files = isZip ? archiveFiles(bytes, fileName) : new Map([[path.basename(fileName), bytes]]);
  const pngEntries = [...files.entries()].filter(([name]) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()));
  const tmxEntries = [...files.entries()].filter(([name]) => /\.(tmx|tsx)$/i.test(name));
  const metaEntries = [...files.entries()].filter(([name]) => /(^|\/)(license|readme)([^/]*)\.(txt|md)$/i.test(name));
  const tileEntries = [...files.entries()].filter(([name]) => /\.tile$/i.test(name));
  const mapTiles = [];
  const warnings = [];
  const actors = [];
  const tmxReports = [];
  const referenced = new Set();
  for (const [name, value] of tmxEntries) {
    const report = parseTmxFile(name, value, files);
    tmxReports.push({ fileName: name, classification: report.classification, tilesets: report.tilesets.map(({ _bytes, ...entry }) => entry), warnings: report.warnings });
    report.tilesets.forEach((entry) => { if (entry.image) referenced.add(entry.image); });
    if (report.classification.target === "actor") actors.push(...report.actors);
    if (report.classification.target === "mapTiles") for (const entry of report.tilesets) if (entry.geometry && files.has(entry.image)) mapTiles.push(mapCandidate(slug(`${path.basename(name, path.extname(name))}-${entry.name}`), entry.name, entry.image, files.get(entry.image), { tileSize: entry.tileSize, margin: entry.margin, spacing: entry.spacing, ...entry.geometry }, { selected: true, sourceTmx: name }));
    warnings.push(...report.warnings);
  }
  const actorTmx = tmxReports.some((report) => report.classification.target === "actor");
  const pngSuggestions = new Map(pngEntries.map(([name, value]) => [name, sheetSuggestions(value, name)]));
  let only16 = 0, only32 = 0;
  for (const suggestions of pngSuggestions.values()) {
    const sizes = suggestions.candidates.map((candidate) => candidate.tileSize);
    if (sizes.length === 1 && sizes[0] === 16) only16 += 1;
    if (sizes.length === 1 && sizes[0] === 32) only32 += 1;
  }
  const archiveConsensus = isZip && only16 > only32 ? 16 : isZip && only32 > only16 ? 32 : undefined;
  for (const [name, value] of pngEntries) {
    const suggestions = pngSuggestions.get(name);
    if (archiveConsensus && suggestions.candidates.some((candidate) => candidate.tileSize === archiveConsensus)) suggestions.suggestedTileSize = archiveConsensus;
    const tmxReferenced = referenced.has(name);
    const id = slug(name.replace(/\//g, "-"));
    const candidate = mapCandidate(id, path.basename(name, ".png"), name, value, { tileSize: suggestions.suggestedTileSize, margin: 0, spacing: 0, ...(suggestions.suggestedTileSize ? cellGeometry(suggestions.width, suggestions.height, suggestions.suggestedTileSize, 0, 0) : {}) }, { selected: !actorTmx && !tmxReferenced && Boolean(suggestions.suggestedTileSize), suggestions, sourceArchive: isZip ? fileName : undefined });
    if (tileEntries.length) candidate.selected = !actorTmx && /(^|\/)(base|world)\.png$/i.test(name);
    if (!suggestions.suggestedTileSize) candidate.warnings.push("16px/32pxグリッドを自動確定できません。手動設定が必要です。");
    if (tmxReferenced) candidate.selected = false;
    mapTiles.push(candidate);
  }
  if (tileEntries.length) warnings.push(`WOLF RPG Editorの.tile設定を${tileEntries.length}件検出しました。自動接続規則は静的タイルへ変換しません。`);
  if (!metaEntries.length) warnings.push("License/READMEが見つかりません。利用条件を手動確認してください。");
  const dedup = new Map();
  for (const candidate of mapTiles) { const key = `${candidate.sourcePath}:${candidate.tileSize}:${candidate.margin}:${candidate.spacing}`; if (!dedup.has(key)) dedup.set(key, candidate); }
  return {
    version: 1,
    source: sourceRecord(fileName, bytes),
    archive: isZip,
    files: [...files.keys()],
    licenses: metaEntries.map(([name]) => name),
    warnings,
    tmx: tmxReports,
    mapTiles: [...dedup.values()],
    actors,
    _files: files,
  };
}

function copyManifest(file, entry) {
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { version: 1, imports: [] };
  if (!Array.isArray(existing.imports)) existing.imports = [];
  existing.imports.push(entry);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(existing, null, 2) + "\n", "utf8");
}

function ensureId(id) {
  if (!/^[a-z][a-z0-9._-]*$/.test(id)) throw new Error(`invalid asset id: ${id}`);
}

function nonEmptyFrame(bytes, tileSize, columns, frame, margin = 0, spacing = 0) {
  const image = PNG.sync.read(bytes), column = frame % columns, row = Math.floor(frame / columns);
  const startX = margin + column * (tileSize + spacing), startY = margin + row * (tileSize + spacing);
  for (let y = 0; y < tileSize; y += 1) for (let x = 0; x < tileSize; x += 1) if (image.data[((startY + y) * image.width + startX + x) * 4 + 3] !== 0) return true;
  return false;
}

function appendPalettePages(paletteFile, selectedAssets, existingPages) {
  const pages = [...existingPages];
  const used = new Set(pages.map((page) => page.id));
  for (const asset of selectedAssets) {
    const bytes = asset._normalizedBytes;
    const geometry = asset._geometry;
    if (!bytes || !geometry) continue;
    for (const mapKind of asset.mapKinds ?? ["home", "dungeon"]) {
      const maxColumns = Math.max(1, Math.min(256, geometry.columns));
      const maxRows = 256;
      for (let yOffset = 0, part = 1; yOffset < geometry.rows; yOffset += maxRows, part += 1) {
        for (let xOffset = 0, columnPart = 1; xOffset < geometry.columns; xOffset += maxColumns, columnPart += 1) {
          let id = slug(`${asset.id}-${mapKind}-${part}-${columnPart}`, "imported-page"), suffix = 2;
          while (used.has(id)) id = `${slug(`${asset.id}-${mapKind}-${part}-${columnPart}`, "imported-page")}-${suffix++}`;
          used.add(id);
          const width = Math.min(maxColumns, geometry.columns - xOffset), height = Math.min(maxRows, geometry.rows - yOffset), cells = [];
          for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
            const frame = (yOffset + y) * geometry.columns + xOffset + x;
            if (nonEmptyFrame(bytes, asset.tileSize, geometry.columns, frame, asset.margin ?? 0, asset.spacing ?? 0)) cells.push({ x, y, assetId: asset.id, frame, layer: asset.defaultLayer ?? "decoration", walkable: asset.defaultWalkable ?? false });
          }
          pages.push({ version: 1, id, label: `${asset.label}・${mapKind}${part > 1 || columnPart > 1 ? ` ${part}-${columnPart}` : ""}`, mapKind, tileSize: asset.tileSize, width, height, cells });
        }
      }
    }
  }
  return pages;
}

export function commitImport(analysis, { mapTiles = [], actors = [], createPalettePages = false, licenseAcknowledged = false, paletteFile = MAP_TILE_PALETTE_FILE, mapSheetImportDir = MAP_SHEET_IMPORT_DIR, actorImportDir = ACTOR_IMPORT_DIR, mapImportManifest = MAP_IMPORT_MANIFEST, actorImportManifest = ACTOR_IMPORT_MANIFEST, paletteInputDir, paletteOutputDir, paletteGeneratedTs } = {}) {
  if (!licenseAcknowledged) throw new Error("利用条件の確認が必要です");
  if (!analysis?._files) throw new Error("analysis has expired; analyze the source again");
  const mapRoot = path.join(mapSheetImportDir, slug(analysis.source.fileName, "import"));
  const actorRoot = path.join(actorImportDir, slug(analysis.source.fileName, "import"));
  const created = [];
  const paletteWasPresent = fs.existsSync(paletteFile);
  const paletteOriginal = paletteWasPresent ? fs.readFileSync(paletteFile) : undefined;
  const manifestFiles = [mapImportManifest, actorImportManifest];
  const manifestSnapshots = new Map(manifestFiles.map((file) => [file, fs.existsSync(file) ? fs.readFileSync(file) : undefined]));
  try {
    for (const selected of mapTiles.filter((entry) => entry.selected !== false)) {
      ensureId(selected.id);
      if (selected.tileSize !== 16 && selected.tileSize !== 32) throw new Error(`map asset ${selected.id} requires tileSize 16 or 32`);
      const bytes = analysis._files.get(selected.sourcePath);
      if (!bytes) throw new Error(`missing source file: ${selected.sourcePath}`);
      const normalized = normalizedPng(bytes, selected.sourcePath);
      const geometry = cellGeometry(pngInfo(normalized, selected.sourcePath).width, pngInfo(normalized, selected.sourcePath).height, selected.tileSize, selected.margin ?? 0, selected.spacing ?? 0);
      if (!geometry) throw new Error(`map asset ${selected.id} dimensions do not fit configured grid`);
      const destination = path.join(mapRoot, `${selected.id}.png`), configFile = path.join(mapRoot, `${selected.id}.tileset.json`);
      if (fs.existsSync(destination) || fs.existsSync(configFile)) throw new Error(`asset already exists: ${selected.id}`);
      fs.mkdirSync(mapRoot, { recursive: true });
      fs.writeFileSync(destination, normalized);
      fs.writeFileSync(configFile, JSON.stringify({ version: 1, id: selected.id, label: selected.label, tileSize: selected.tileSize, margin: selected.margin ?? 0, spacing: selected.spacing ?? 0, mapKinds: selected.mapKinds ?? ["home", "dungeon"], defaultLayer: selected.defaultLayer ?? "decoration", defaultWalkable: selected.defaultWalkable ?? false, source: { archive: analysis.source.fileName, path: selected.sourcePath, sha256: sha256(bytes) } }, null, 2) + "\n", "utf8");
      selected._normalizedBytes = normalized;
      selected._geometry = geometry;
      created.push(destination, configFile);
    }
    for (const actor of actors.filter((entry) => entry.selected !== false)) {
      ensureId(actor.id);
      const actorDir = path.join(actorRoot, actor.id);
      if (fs.existsSync(actorDir)) throw new Error(`actor already exists: ${actor.id}`);
      fs.mkdirSync(actorDir, { recursive: true });
      const clips = {};
      for (const [action, clip] of Object.entries(actor.clips ?? {})) {
        if (!clip?.path || !analysis._files.has(clip.path)) continue;
        const destination = path.join(actorDir, `${action}.png`);
        fs.writeFileSync(destination, normalizedPng(analysis._files.get(clip.path), clip.path));
        created.push(destination);
        clips[action] = { ...clip, path: path.relative(path.resolve("assets-src/actors"), destination).replaceAll("\\", "/") };
      }
      const definition = { version: 1, id: actor.id, label: actor.label, roles: actor.roles ?? ["enemy"], clips, scale: actor.scale ?? 1, origin: actor.origin ?? { x: 0.5, y: 0.72 }, enemyStats: actor.enemyStats };
      const definitionFile = path.join(actorDir, "actor.json");
      fs.writeFileSync(definitionFile, JSON.stringify(definition, null, 2) + "\n", "utf8");
      created.push(definitionFile);
    }
    if (createPalettePages && mapTiles.some((entry) => entry.selected !== false)) {
      const current = fs.existsSync(paletteFile) ? JSON.parse(fs.readFileSync(paletteFile, "utf8")) : { version: 1, pages: [] };
      const pages = appendPalettePages(paletteFile, mapTiles.filter((entry) => entry.selected !== false), current.pages ?? []);
      savePaletteAtomically({ version: 1, pages }, { paletteFile, inputDir: paletteInputDir ?? path.resolve("assets-src/map-tiles/sheets"), outputDir: paletteOutputDir, generatedTs: paletteGeneratedTs });
    }
    copyManifest(mapImportManifest, { source: analysis.source, mapTiles: mapTiles.filter((entry) => entry.selected !== false).map(({ _bytes, _normalizedBytes, _geometry, ...entry }) => entry), warnings: analysis.warnings });
    copyManifest(actorImportManifest, { source: analysis.source, actors: actors.filter((entry) => entry.selected !== false).map(({ _bytes, ...entry }) => entry), warnings: analysis.warnings });
    // Palette page creation is intentionally delegated to the existing palette
    // validator/writer. The importer records the request so a caller can build
    // pages without making the source pipeline depend on editor state.
    return { created, createPalettePages, paletteFile };
  } catch (error) {
    for (const file of created.reverse()) { try { fs.rmSync(file, { force: true }); } catch { /* best effort rollback */ } }
    try { if (paletteOriginal) fs.writeFileSync(paletteFile, paletteOriginal); else if (!paletteWasPresent) fs.rmSync(paletteFile, { force: true }); } catch { /* preserve the original error */ }
    for (const [file, original] of manifestSnapshots) { try { if (original) fs.writeFileSync(file, original); else fs.rmSync(file, { force: true }); } catch { /* preserve the original error */ } }
    throw error;
  }
}

export function analyzeImportFile(file, options = {}) {
  return analyzeImport(fs.readFileSync(file), { fileName: options.fileName ?? path.basename(file) });
}
