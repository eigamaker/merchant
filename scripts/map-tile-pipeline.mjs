import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

export const MAP_TILE_INPUT_DIR = path.resolve("assets-src/map-tiles/sheets");
export const MAP_TILE_PALETTE_FILE = path.resolve("assets-src/map-tiles/palettes.json");
export const MAP_TILE_OUTPUT_DIR = path.resolve("public/assets/map-tiles/generated");
export const MAP_TILE_GENERATED_TS = path.resolve("src/game/mapAssetCatalog.generated.ts");
/** Canonical development-only editor API. */
export const MAP_EDITOR_PALETTE_API = "/__map-editor/palettes";
/** Legacy alias retained for existing clients. */
export const MAP_TILE_PALETTE_API = "/__map-tiles/palettes.json";

const layers = new Set(["ground", "structure", "decoration"]);
const kinds = new Set(["home", "dungeon"]);
const idPattern = /^[a-z][a-z0-9._-]*$/;

function issue(message, file) {
  return file ? `${file}: ${message}` : message;
}

function integer(value) { return Number.isInteger(value); }

function readPngInfo(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.length < 33 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(issue("PNG signature is missing", file));
  }
  if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") throw new Error(issue("PNG IHDR is missing", file));
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  if (bitDepth !== 8 || colorType !== 6) throw new Error(issue("PNG must be 8-bit RGBA", file));
  // pngjs also verifies the compressed stream and catches truncated images.
  try { PNG.sync.read(bytes); } catch (error) { throw new Error(issue(`PNG decode failed: ${error.message}`, file)); }
  return { width, height };
}

function assertConfig(config, file) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error(issue("configuration must be an object", file));
  const c = config;
  if (c.version !== 1) throw new Error(issue("version must be 1", file));
  if (typeof c.id !== "string" || !idPattern.test(c.id)) throw new Error(issue("id must match /^[a-z][a-z0-9._-]*$/", file));
  if (typeof c.label !== "string" || !c.label.trim()) throw new Error(issue("label is required", file));
  if (c.tileSize !== 16 && c.tileSize !== 32) throw new Error(issue("tileSize must be 16 or 32", file));
  for (const name of ["margin", "spacing"]) if (!integer(c[name]) || c[name] < 0) throw new Error(issue(`${name} must be a non-negative integer`, file));
  if (!Array.isArray(c.mapKinds) || c.mapKinds.length === 0 || c.mapKinds.some((kind) => !kinds.has(kind)) || new Set(c.mapKinds).size !== c.mapKinds.length) throw new Error(issue("mapKinds must contain unique home/dungeon values", file));
  if (!layers.has(c.defaultLayer)) throw new Error(issue("defaultLayer is invalid", file));
  if (typeof c.defaultWalkable !== "boolean") throw new Error(issue("defaultWalkable must be boolean", file));
  return c;
}

export function readTileSheets(inputDir = MAP_TILE_INPUT_DIR) {
  if (!fs.existsSync(inputDir)) throw new Error(`map tile input directory does not exist: ${inputDir}`);
  const names = fs.readdirSync(inputDir);
  const pngNames = names.filter((name) => name.toLowerCase().endsWith(".png"));
  const jsonNames = names.filter((name) => name.endsWith(".tileset.json"));
  const jsonBases = new Set(jsonNames.map((name) => name.slice(0, -".tileset.json".length)));
  const pngBases = new Set(pngNames.map((name) => name.slice(0, -4)));
  const missingJson = pngNames.filter((name) => !jsonBases.has(name.slice(0, -4)));
  const missingPng = jsonNames.filter((name) => !pngBases.has(name.slice(0, -".tileset.json".length)));
  if (missingJson.length) throw new Error(`Missing .tileset.json for: ${missingJson.join(", ")}`);
  if (missingPng.length) throw new Error(`Missing PNG for: ${missingPng.join(", ")}`);
  const ids = new Set();
  const assets = [];
  for (const pngName of pngNames.sort()) {
    const base = pngName.slice(0, -4);
    const pngFile = path.join(inputDir, pngName);
    const jsonFile = path.join(inputDir, `${base}.tileset.json`);
    const config = assertConfig(JSON.parse(fs.readFileSync(jsonFile, "utf8")), jsonFile);
    if (ids.has(config.id)) throw new Error(issue(`duplicate asset id ${config.id}`, jsonFile));
    ids.add(config.id);
    const { width, height } = readPngInfo(pngFile);
    const step = config.tileSize + config.spacing;
    const innerWidth = width - 2 * config.margin + config.spacing;
    const innerHeight = height - 2 * config.margin + config.spacing;
    if (innerWidth < config.tileSize || innerHeight < config.tileSize || innerWidth % step !== 0 || innerHeight % step !== 0) {
      throw new Error(issue(`PNG dimensions ${width}x${height} do not fit tileSize=${config.tileSize}, margin=${config.margin}, spacing=${config.spacing}`, pngFile));
    }
    const columns = innerWidth / step;
    const rows = innerHeight / step;
    assets.push({ id: config.id, label: config.label, sourceFile: pngFile, tileSize: config.tileSize, margin: config.margin, spacing: config.spacing, columns, rows, frameCount: columns * rows, mapKinds: [...config.mapKinds], defaultLayer: config.defaultLayer, defaultWalkable: config.defaultWalkable });
  }
  return assets;
}

function validateCell(cell, page, assetsById, index) {
  if (!cell || typeof cell !== "object" || !integer(cell.x) || !integer(cell.y) || cell.x < 0 || cell.y < 0 || cell.x >= page.width || cell.y >= page.height) throw new Error(`page ${page.id} cell ${index} has invalid coordinates`);
  const asset = assetsById.get(cell.assetId);
  if (!asset) throw new Error(`page ${page.id} cell ${index} references unknown asset ${String(cell.assetId)}`);
  if (asset.tileSize !== page.tileSize || !asset.mapKinds.includes(page.mapKind)) throw new Error(`page ${page.id} cell ${index} asset ${asset.id} is incompatible with page`);
  if (!integer(cell.frame) || cell.frame < 0 || cell.frame >= asset.frameCount) throw new Error(`page ${page.id} cell ${index} has invalid frame`);
  if (!layers.has(cell.layer) || typeof cell.walkable !== "boolean") throw new Error(`page ${page.id} cell ${index} has invalid layer/walkable`);
}

export function validatePalette(value, assets, { allowEmpty = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1 || !Array.isArray(value.pages)) throw new Error("palette must be {version:1,pages:[]}");
  if (!allowEmpty && value.pages.length === 0) throw new Error("palette must contain at least one page");
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const pageIds = new Set();
  for (const [index, page] of value.pages.entries()) {
    if (!page || typeof page !== "object" || typeof page.id !== "string" || !idPattern.test(page.id) || pageIds.has(page.id)) throw new Error(`page ${index} has duplicate or invalid id`);
    pageIds.add(page.id);
    if (typeof page.label !== "string" || !page.label.trim() || !kinds.has(page.mapKind) || (page.tileSize !== 16 && page.tileSize !== 32) || !integer(page.width) || !integer(page.height) || page.width < 1 || page.width > 256 || page.height < 1 || page.height > 256 || !Array.isArray(page.cells)) throw new Error(`page ${page.id} has invalid metadata`);
    const coordinates = new Set();
    for (const [cellIndex, cell] of page.cells.entries()) {
      validateCell(cell, page, assetsById, cellIndex);
      const coordinate = `${cell.x},${cell.y}`;
      if (coordinates.has(coordinate)) throw new Error(`page ${page.id} contains duplicate cell ${coordinate}`);
      coordinates.add(coordinate);
    }
  }
  return value;
}

function defaultPalette(assets) {
  const pages = [];
  for (const mapKind of ["home", "dungeon"]) {
    const candidates = assets.filter((asset) => asset.mapKinds.includes(mapKind));
    if (!candidates.length) continue;
    const tileSize = candidates[0].tileSize;
    pages.push({ id: `${mapKind}-default`, label: `${mapKind === "home" ? "家" : "ダンジョン"}・基本`, mapKind, tileSize, width: 8, height: 4, cells: candidates.slice(0, 8).map((asset, x) => ({ x, y: 0, assetId: asset.id, frame: 0, layer: asset.defaultLayer, walkable: asset.defaultWalkable })) });
  }
  return { version: 1, pages };
}

function tsLiteral(value) { return JSON.stringify(value, null, 2).replace(/\n/g, "\n"); }

function writeGeneratedTypescript(file, assets, palette) {
  const definitions = assets.map(({ sourceFile, ...asset }) => ({ ...asset, path: `/assets/map-tiles/generated/${asset.id}.png` }));
  const text = `/* AUTO-GENERATED by scripts/build-map-tile-assets.mjs. Do not edit. */\nexport const MAP_ASSET_CATALOG = ${tsLiteral(definitions)} as const;\nexport const MAP_ASSET_IDS = MAP_ASSET_CATALOG.map((asset) => asset.id);\nexport const DEFAULT_PALETTE_LAYOUT = ${tsLiteral(palette)} as const;\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

export function buildMapTileAssets({ inputDir = MAP_TILE_INPUT_DIR, paletteFile = MAP_TILE_PALETTE_FILE, outputDir = MAP_TILE_OUTPUT_DIR, generatedTs = MAP_TILE_GENERATED_TS } = {}) {
  const assets = readTileSheets(inputDir);
  if (assets.length === 0) throw new Error("No map tile sheets found");
  let palette;
  if (fs.existsSync(paletteFile)) palette = JSON.parse(fs.readFileSync(paletteFile, "utf8"));
  else palette = defaultPalette(assets);
  validatePalette(palette, assets);
  fs.mkdirSync(outputDir, { recursive: true });
  // Keep the dedicated directory itself in place. This makes repeated Vite
  // watcher/API generations safe on Windows, where removing a directory while
  // another generation has a file open can report ENOTEMPTY.
  for (const entry of fs.readdirSync(outputDir)) fs.rmSync(path.join(outputDir, entry), { recursive: true, force: true });
  for (const asset of assets) fs.copyFileSync(asset.sourceFile, path.join(outputDir, `${asset.id}.png`));
  const definitions = assets.map(({ sourceFile, ...asset }) => ({ ...asset, path: `/assets/map-tiles/generated/${asset.id}.png` }));
  fs.writeFileSync(path.join(outputDir, "catalog.json"), JSON.stringify({ version: 1, assets: definitions }, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(outputDir, "palettes.json"), JSON.stringify(palette, null, 2) + "\n", "utf8");
  writeGeneratedTypescript(generatedTs, assets, palette);
  return { assets: definitions, palette };
}

export function savePaletteAtomically(value, { paletteFile = MAP_TILE_PALETTE_FILE, inputDir = MAP_TILE_INPUT_DIR, outputDir = MAP_TILE_OUTPUT_DIR, generatedTs = MAP_TILE_GENERATED_TS, generateAssets = buildMapTileAssets } = {}) {
  const assets = readTileSheets(inputDir);
  validatePalette(value, assets);
  fs.mkdirSync(path.dirname(paletteFile), { recursive: true });
  const suffix = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const temporary = `${paletteFile}.${suffix}.tmp`;
  const backup = `${paletteFile}.${suffix}.bak`;
  const hadOriginal = fs.existsSync(paletteFile);
  let backupCreated = false;
  let replacementInstalled = false;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
    // Windows cannot rename over an existing file. Move the validated current
    // source aside first so every later failure can restore it losslessly.
    if (hadOriginal) {
      fs.renameSync(paletteFile, backup);
      backupCreated = true;
    }
    fs.renameSync(temporary, paletteFile);
    replacementInstalled = true;
    const result = generateAssets({ inputDir, paletteFile, outputDir, generatedTs });
    if (backupCreated) {
      fs.rmSync(backup, { force: true });
      backupCreated = false;
    }
    return result;
  } catch (error) {
    let rollbackError;
    try {
      if (backupCreated) {
        if (replacementInstalled || fs.existsSync(paletteFile)) fs.rmSync(paletteFile, { force: true });
        fs.renameSync(backup, paletteFile);
        backupCreated = false;
      } else if (!hadOriginal && replacementInstalled) {
        fs.rmSync(paletteFile, { force: true });
      }
    } catch (failure) {
      rollbackError = failure;
    } finally {
      fs.rmSync(temporary, { force: true });
      if (!backupCreated) fs.rmSync(backup, { force: true });
    }
    if (rollbackError) throw new AggregateError([error, rollbackError], "Palette save failed and the original source could not be restored");
    throw error;
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
