import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

export const MAP_TILE_INPUT_DIR = path.resolve("assets-src/map-tiles/sheets");
export const MAP_TILE_PALETTE_FILE = path.resolve("assets-src/map-tiles/palettes.json");
export const MAP_TILE_OUTPUT_DIR = path.resolve("public/assets/map-tiles/generated");
export const MAP_TILE_GENERATED_TS = path.resolve("src/game/mapAssetCatalog.generated.ts");
export const DUNGEON_THEME_FILE = path.resolve("assets-src/dungeon-themes/themes.json");
export const DUNGEON_THEME_GENERATED_TS = path.resolve("src/game/dungeonThemeCatalog.generated.ts");
export const MAP_EDITOR_THEME_API = "/__map-editor/dungeon-themes";
/** Canonical development-only editor API. */
export const MAP_EDITOR_PALETTE_API = "/__map-editor/palettes";
/** Legacy alias retained for existing clients. */
export const MAP_TILE_PALETTE_API = "/__map-tiles/palettes.json";

const layers = new Set(["ground", "structure", "decoration"]);
const kinds = new Set(["home", "dungeon"]);
/** How the importer produced the sheet. See scripts/asset-import-pipeline.mjs. */
const sourceFormats = new Set(["grid", "wolf-autotile", "section-catalog"]);
/** blob47 covers all 256 eight-neighbour combinations with 47 tiles. */
const autotileSchemes = new Set(["blob47"]);
const BLOB47_TILE_COUNT = 47;
const idPattern = /^[a-z][a-z0-9._-]*$/;
const themePlacements = new Set(["floor", "wall", "wallFace", "corner", "deadEnd"]);
/** Palette triage vocabulary. Mirrors src/review/paletteModel.ts. */
const cellRoles = new Set(["floor", "wall", "prop", "stairs", "liquid"]);
const cellStatuses = new Set(["ready", "unsorted", "rejected"]);
const spawnRoles = new Set(["common", "elite"]);
/** Tiles the game places itself. Mirrors DUNGEON_THEME_OBJECT_KINDS. */
const themeObjectKinds = new Set(["chest", "corpse"]);
const requiredThemeIds = ["cave", "ruins", "lava"];
/** Enemies defined in code (src/game/craftpixActors.ts), so not discoverable on disk. */
const builtInEnemyIds = new Set([
  "slime1", "slime2", "slime3", "plant1", "plant2", "plant3",
  "orc1", "orc2", "orc3", "vampire1", "vampire2", "vampire3",
]);
export const ACTOR_SOURCE_DIR = path.resolve("assets-src/actors/imported");

/**
 * Every actor a theme may put in an enemy pool: the built-ins plus whatever has
 * been imported.  Validating against the built-ins alone locked imported enemies
 * out of procedural generation even though the manual map editor offered them.
 */
export function availableEnemyIds(sourceDir = ACTOR_SOURCE_DIR) {
  const ids = new Set(builtInEnemyIds);
  if (!fs.existsSync(sourceDir)) return ids;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) { visit(absolute); continue; }
      if (entry.name !== "actor.json") continue;
      try {
        const definition = JSON.parse(fs.readFileSync(absolute, "utf8"));
        if (typeof definition?.id === "string" && (definition.roles ?? []).includes("enemy")) ids.add(definition.id);
      } catch {
        // A malformed actor is reported by the actor build, not by theme validation.
      }
    }
  };
  visit(sourceDir);
  return ids;
}

/** Alpha at or below this reads as transparent when tracing a silhouette. */
const STACKED_ALPHA_FLOOR = 8;

function frameSilhouette(png, geometry, frame) {
  const { tileSize, margin, spacing, columns } = geometry;
  const step = tileSize + spacing;
  const originX = margin + (frame % columns) * step;
  const originY = margin + Math.floor(frame / columns) * step;
  let opaque = 0;
  let top = 0n;
  let bottom = 0n;
  for (let y = 0; y < tileSize; y += 1) for (let x = 0; x < tileSize; x += 1) {
    if (png.data[((originY + y) * png.width + (originX + x)) * 4 + 3] <= STACKED_ALPHA_FLOOR) continue;
    opaque += 1;
    if (y === 0) top |= 1n << BigInt(x);
    if (y === tileSize - 1) bottom |= 1n << BigInt(x);
  }
  return { coverage: opaque / (tileSize * tileSize), top, bottom };
}

/**
 * Frames holding the lower half of a picture two cells tall: the half that sits
 * in the cell, with the rest drawn one cell above it. An up-staircase is drawn
 * that way and a down-staircase is not, which is the distinction a theme would
 * otherwise carry by hand for every sheet it shops from.
 *
 * A pair is proposed when the frame above is partly transparent - so it cannot
 * be a standalone floor or wall - reaches its own bottom edge, and ends on
 * columns that all continue into this frame's top edge.
 *
 * Those tests alone also fit two unrelated tiles that happen to meet at an
 * opaque seam. What separates the cases is that the scan runs top-down and
 * consumes both halves of a pair, so the lower half of one piece is never read
 * as the upper half of the piece below it. That is an assumption about how
 * sheets are laid out rather than evidence in the pixels, so this stays a
 * proposal: a theme that disagrees says so with an explicit height.
 */
export function detectStackedFrames(png, geometry) {
  const { columns, rows } = geometry;
  if (columns < 1 || rows < 2) return [];
  const silhouettes = [];
  for (let frame = 0; frame < columns * rows; frame += 1) silhouettes.push(frameSilhouette(png, geometry, frame));
  const claimed = new Set();
  const lowerHalves = [];
  for (let frame = columns; frame < columns * rows; frame += 1) {
    const above = frame - columns;
    if (claimed.has(above)) continue;
    const upper = silhouettes[above];
    const lower = silhouettes[frame];
    if (upper.coverage <= 0 || upper.coverage >= 1) continue;
    if (upper.bottom === 0n || lower.top === 0n) continue;
    if ((upper.bottom & ~lower.top) !== 0n) continue;
    claimed.add(above);
    claimed.add(frame);
    lowerHalves.push(frame);
  }
  return lowerHalves;
}

/**
 * Asks the detector about one frame, decoding each sheet at most once and only
 * when something references it. An autotile sheet never qualifies: its rows are
 * animation frames, not the top and bottom of one picture.
 */
export function stackedFrameLookup(assets) {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const cache = new Map();
  return (assetId, frame) => {
    if (!cache.has(assetId)) {
      const asset = assetsById.get(assetId);
      const readable = asset && !asset.autotile && asset.sourceFile && fs.existsSync(asset.sourceFile);
      cache.set(assetId, readable ? new Set(detectStackedFrames(PNG.sync.read(fs.readFileSync(asset.sourceFile)), asset)) : new Set());
    }
    return cache.get(assetId).has(frame);
  };
}

/** Applies one transform to every piece a theme places on purpose. */
function mapThemePieces(document, map) {
  return {
    ...document,
    themes: document.themes.map((theme) => {
      const objects = theme.objects && Object.fromEntries(Object.entries(theme.objects).map(([kind, ref]) => [kind, map(ref)]));
      return { ...theme, stairsUp: map(theme.stairsUp), stairsDown: map(theme.stairsDown), ...(objects ? { objects } : {}) };
    }),
  };
}

/** Piece heights the author left unset, filled in from the sheet. */
export function resolveDungeonThemePieces(document, assets) {
  const stacked = stackedFrameLookup(assets);
  return mapThemePieces(document, (ref) => (ref.height === undefined && stacked(ref.assetId, ref.frame) ? { ...ref, height: 2 } : { ...ref }));
}

/**
 * The inverse, applied before the authored file is written back. A height the
 * detector would have produced anyway is dropped, so the source keeps only what
 * a person actually chose and detection stays free to improve.
 */
export function authoredDungeonThemePieces(document, assets) {
  const stacked = stackedFrameLookup(assets);
  return mapThemePieces(document, (ref) => {
    if (ref.height === undefined || ref.height !== (stacked(ref.assetId, ref.frame) ? 2 : 1)) return { ...ref };
    const { height, ...rest } = ref;
    return rest;
  });
}

function issue(message, file) {
  return file ? `${file}: ${message}` : message;
}

function integer(value) { return Number.isInteger(value); }

function inputFiles(inputDir) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory() && entry.name !== "generated") visit(absolute);
      else files.push({ absolute, relative: path.relative(inputDir, absolute).replaceAll("\\", "/") });
    }
  };
  visit(inputDir);
  return files;
}

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
  if (c.sourceFormat !== undefined && !sourceFormats.has(c.sourceFormat)) throw new Error(issue("sourceFormat is invalid", file));
  if (c.autotile !== undefined) {
    if (!c.autotile || typeof c.autotile !== "object" || Array.isArray(c.autotile)) throw new Error(issue("autotile must be an object", file));
    if (!autotileSchemes.has(c.autotile.scheme)) throw new Error(issue("autotile.scheme is invalid", file));
    if (!integer(c.autotile.animationFrames) || c.autotile.animationFrames < 1) throw new Error(issue("autotile.animationFrames must be a positive integer", file));
  }
  return c;
}

export function readTileSheets(inputDir = MAP_TILE_INPUT_DIR) {
  if (!fs.existsSync(inputDir)) throw new Error(`map tile input directory does not exist: ${inputDir}`);
  const files = inputFiles(inputDir);
  const pngNames = files.filter(({ relative }) => relative.toLowerCase().endsWith(".png")).map(({ relative }) => relative);
  const jsonNames = files.filter(({ relative }) => relative.endsWith(".tileset.json")).map(({ relative }) => relative);
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
    if (config.autotile) {
      // An expanded blob set is one row of 47 tiles per animation frame, so a
      // frame index is `animationFrame * 47 + frameByMask[neighbourMask]`.
      if (columns !== BLOB47_TILE_COUNT) throw new Error(issue(`autotile sheet must be ${BLOB47_TILE_COUNT} tiles wide, found ${columns}`, jsonFile));
      if (rows !== config.autotile.animationFrames) throw new Error(issue(`autotile sheet has ${rows} rows but declares ${config.autotile.animationFrames} animation frames`, jsonFile));
    }
    assets.push({ id: config.id, label: config.label, sourceFile: pngFile, tileSize: config.tileSize, margin: config.margin, spacing: config.spacing, columns, rows, frameCount: columns * rows, mapKinds: [...config.mapKinds], defaultLayer: config.defaultLayer, defaultWalkable: config.defaultWalkable, ...(config.autotile ? { autotile: { scheme: config.autotile.scheme, animationFrames: config.autotile.animationFrames } } : {}) });
  }
  return assets;
}

function validateCell(cell, page, assetsById, index) {
  if (!cell || typeof cell !== "object" || !integer(cell.x) || !integer(cell.y) || cell.x < 0 || cell.y < 0 || cell.x >= page.width || cell.y >= page.height) throw new Error(`page ${page.id} cell ${index} has invalid coordinates`);
  const asset = assetsById.get(cell.assetId);
  if (!asset) throw new Error(`page ${page.id} cell ${index} references unknown asset ${String(cell.assetId)}`);
  if (asset.tileSize !== page.tileSize) throw new Error(`page ${page.id} cell ${index} asset ${asset.id} is incompatible with page`);
  if (!integer(cell.frame) || cell.frame < 0 || cell.frame >= asset.frameCount) throw new Error(`page ${page.id} cell ${index} has invalid frame`);
  if (!layers.has(cell.layer) || typeof cell.walkable !== "boolean") throw new Error(`page ${page.id} cell ${index} has invalid layer/walkable`);
  // Triage tags. Absent means the tile has not been sorted yet, which is valid.
  if (cell.role !== undefined && !cellRoles.has(cell.role)) throw new Error(`page ${page.id} cell ${index} has invalid role ${String(cell.role)}`);
  if (cell.status !== undefined && !cellStatuses.has(cell.status)) throw new Error(`page ${page.id} cell ${index} has invalid status ${String(cell.status)}`);
  if (cell.note !== undefined && typeof cell.note !== "string") throw new Error(`page ${page.id} cell ${index} has invalid note`);
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

function writeGeneratedTypescript(file, assets, palette, themeFile, themeGeneratedTs = DUNGEON_THEME_GENERATED_TS) {
  const definitions = assets.map(({ sourceFile, ...asset }) => ({ ...asset, path: `/assets/map-tiles/generated/${asset.id}.png` }));
  const text = `/* AUTO-GENERATED by scripts/build-map-tile-assets.mjs. Do not edit. */\nexport const MAP_ASSET_CATALOG = ${tsLiteral(definitions)} as const;\nexport const MAP_ASSET_IDS = MAP_ASSET_CATALOG.map((asset) => asset.id);\nexport const DEFAULT_PALETTE_LAYOUT = ${tsLiteral(palette)} as const;\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
  if (themeFile) {
    const themes = readDungeonThemes(themeFile, assets);
    const themeText = `/* AUTO-GENERATED by scripts/build-map-tile-assets.mjs. Do not edit. */\nexport const DUNGEON_THEME_CATALOG = ${tsLiteral(themes.themes)} as const;\nexport const DUNGEON_THEME_IDS = DUNGEON_THEME_CATALOG.map((theme) => theme.id);\n`;
    fs.mkdirSync(path.dirname(themeGeneratedTs), { recursive: true });
    fs.writeFileSync(themeGeneratedTs, themeText, "utf8");
  }
}

/**
 * Floors and walls have to tile on the 16px world grid, but a decoration is a
 * single picture and may be coarser: a 32px sheet covers 2x2 cells.
 */
function validateFrameRef(ref, assetsById, context, { weighted = false, allowCoarse = false } = {}) {
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) throw new Error(`${context} must be an asset frame reference`);
  const asset = assetsById.get(ref.assetId);
  if (!asset) throw new Error(`${context} references unknown asset ${String(ref.assetId)}`);
  const sizeOk = allowCoarse ? asset.tileSize % 16 === 0 : asset.tileSize === 16;
  if (!sizeOk || !asset.mapKinds.includes("dungeon")) throw new Error(`${context} asset ${asset.id} must be a ${allowCoarse ? "16px or 32px" : "16px"} dungeon asset`);
  if (!integer(ref.frame) || ref.frame < 0 || ref.frame >= asset.frameCount) throw new Error(`${context} has invalid frame ${String(ref.frame)}`);
  if (weighted && (!Number.isFinite(ref.weight) || ref.weight <= 0)) throw new Error(`${context} weight must be positive`);
  return asset;
}

/**
 * A placed piece, plus the optional height that says it is two cells tall.
 * The upper half is the frame one row further up, so row 0 can never carry one.
 */
function validatePieceRef(ref, assetsById, context) {
  const asset = validateFrameRef(ref, assetsById, context);
  if (ref.height === undefined) return asset;
  if (ref.height !== 1 && ref.height !== 2) throw new Error(`${context} height must be 1 or 2`);
  if (ref.height === 2 && ref.frame < asset.columns) throw new Error(`${context} height 2 has no upper half above frame ${ref.frame}`);
  return asset;
}

export function validateDungeonThemes(value, assets, enemyIds = availableEnemyIds()) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1 || !Array.isArray(value.themes)) throw new Error("dungeon themes must be {version:1,themes:[]}");
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const ids = new Set();
  for (const required of requiredThemeIds) if (!value.themes.some((theme) => theme?.id === required)) throw new Error(`missing required dungeon theme ${required}`);
  for (const [themeIndex, theme] of value.themes.entries()) {
    const context = `theme ${theme?.id ?? themeIndex}`;
    if (!theme || typeof theme !== "object" || theme.version !== 1 || typeof theme.id !== "string" || !idPattern.test(theme.id) || ids.has(theme.id)) throw new Error(`${context} has duplicate or invalid id`);
    ids.add(theme.id);
    if (typeof theme.label !== "string" || !theme.label.trim()) throw new Error(`${context} label is required`);
    if (typeof theme.enabled !== "boolean") throw new Error(`${context} enabled must be boolean`);
    if (theme.tileSize !== 16) throw new Error(`${context} tileSize must be 16`);
    if (!Array.isArray(theme.floorVariants) || theme.floorVariants.length < 3) throw new Error(`${context} needs at least three floor variants`);
    theme.floorVariants.forEach((ref, index) => validateFrameRef(ref, assetsById, `${context} floorVariants[${index}]`, { weighted: true }));
    // A theme names either one expanded autotile, which derives every
    // neighbourhood, or the legacy sixteen frames indexed by the cardinal mask.
    if (theme.wall !== undefined) {
      if (!theme.wall || typeof theme.wall !== "object" || Array.isArray(theme.wall)) throw new Error(`${context} wall must be an object`);
      const wallAsset = assetsById.get(theme.wall.assetId);
      if (!wallAsset) throw new Error(`${context} wall references unknown asset ${String(theme.wall.assetId)}`);
      if (!wallAsset.autotile) throw new Error(`${context} wall asset ${wallAsset.id} is not an expanded autotile`);
      if (wallAsset.tileSize !== 16 || !wallAsset.mapKinds.includes("dungeon")) throw new Error(`${context} wall asset ${wallAsset.id} must be a 16px dungeon asset`);
      if (theme.wall.faceHeight !== undefined && theme.wall.faceHeight !== 1 && theme.wall.faceHeight !== 2) throw new Error(`${context} wall faceHeight must be 1 or 2`);
      if (theme.wall.face !== undefined) {
        const faceAsset = validateFrameRef(theme.wall.face, assetsById, `${context} wall face`);
        // The lower half of a two-cell face is the frame one row further down.
        if (theme.wall.faceHeight === 2 && theme.wall.face.frame + faceAsset.columns >= faceAsset.frameCount) {
          throw new Error(`${context} wall face has no lower half below frame ${theme.wall.face.frame}`);
        }
      } else if (theme.wall.faceHeight === 2) {
        throw new Error(`${context} wall faceHeight 2 needs a face`);
      }
    }
    if (theme.wallFrameByMask !== undefined || theme.wall === undefined) {
      if (!Array.isArray(theme.wallFrameByMask) || theme.wallFrameByMask.length !== 16) throw new Error(`${context} wallFrameByMask must contain 16 entries`);
      theme.wallFrameByMask.forEach((ref, index) => validateFrameRef(ref, assetsById, `${context} wallFrameByMask[${index}]`));
    }
    validatePieceRef(theme.stairsUp, assetsById, `${context} stairsUp`);
    validatePieceRef(theme.stairsDown, assetsById, `${context} stairsDown`);
    // Optional: a theme without these keeps the shared placeholder object sheet.
    if (theme.objects !== undefined) {
      if (!theme.objects || typeof theme.objects !== "object" || Array.isArray(theme.objects)) throw new Error(`${context} objects must be an object`);
      for (const [kind, ref] of Object.entries(theme.objects)) {
        if (!themeObjectKinds.has(kind)) throw new Error(`${context} objects has unknown kind ${kind}`);
        validatePieceRef(ref, assetsById, `${context} objects.${kind}`);
      }
    }
    if (!Array.isArray(theme.decorations) || theme.decorations.length < 6) throw new Error(`${context} needs at least six decoration rules`);
    const decorationIds = new Set();
    for (const [index, rule] of theme.decorations.entries()) {
      const ruleContext = `${context} decorations[${index}]`;
      if (!rule || typeof rule.id !== "string" || !idPattern.test(rule.id) || decorationIds.has(rule.id)) throw new Error(`${ruleContext} has duplicate or invalid id`);
      decorationIds.add(rule.id);
      if (!themePlacements.has(rule.placement)) throw new Error(`${ruleContext} has invalid placement`);
      if (!Number.isFinite(rule.weight) || rule.weight <= 0) throw new Error(`${ruleContext} weight must be positive`);
      if (!integer(rule.maxPerFloor) || rule.maxPerFloor < 1) throw new Error(`${ruleContext} maxPerFloor must be a positive integer`);
      // Absent means the rule places props. The six-rule floor counts authored
      // rules, so switching one off never makes a theme fail its contract.
      if (rule.enabled !== undefined && typeof rule.enabled !== "boolean") throw new Error(`${ruleContext} enabled must be boolean`);
      if (!Array.isArray(rule.variants) || rule.variants.length === 0) throw new Error(`${ruleContext} needs variants`);
      rule.variants.forEach((ref, variantIndex) => validateFrameRef(ref, assetsById, `${ruleContext} variants[${variantIndex}]`, { weighted: true, allowCoarse: true }));
    }
    // A theme carries either a spawn table or the legacy three depth buckets.
    if (theme.spawns !== undefined) {
      if (!Array.isArray(theme.spawns) || theme.spawns.length === 0) throw new Error(`${context} spawns must not be empty`);
      for (const [index, entry] of theme.spawns.entries()) {
        const spawnContext = `${context} spawns[${index}]`;
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${spawnContext} must be an object`);
        if (!enemyIds.has(entry.actorId)) throw new Error(`${spawnContext} references unavailable enemy ${String(entry.actorId)}`);
        if (!integer(entry.minFloor) || entry.minFloor < 1) throw new Error(`${spawnContext} minFloor must be a positive integer`);
        if (entry.maxFloor !== undefined && (!integer(entry.maxFloor) || entry.maxFloor < entry.minFloor)) throw new Error(`${spawnContext} maxFloor must be at least minFloor`);
        if (!Number.isFinite(entry.weight) || entry.weight <= 0) throw new Error(`${spawnContext} weight must be positive`);
        if (entry.role !== undefined && !spawnRoles.has(entry.role)) throw new Error(`${spawnContext} role is invalid`);
        if (entry.maxPerFloor !== undefined && (!integer(entry.maxPerFloor) || entry.maxPerFloor < 1)) throw new Error(`${spawnContext} maxPerFloor must be a positive integer`);
      }
      // Every floor the game can reach has to have something to meet.
      if (!theme.spawns.some((entry) => entry.minFloor <= 1)) throw new Error(`${context} spawns leave floor 1 empty`);
    } else {
      if (!theme.enemyPools || typeof theme.enemyPools !== "object") throw new Error(`${context} needs spawns or enemyPools`);
      for (const depth of ["shallow", "middle", "deep"]) {
        const pool = theme.enemyPools[depth];
        if (!Array.isArray(pool) || pool.length === 0) throw new Error(`${context} enemyPools.${depth} must not be empty`);
        for (const actorId of pool) if (!enemyIds.has(actorId)) throw new Error(`${context} enemyPools.${depth} references unavailable enemy ${String(actorId)}`);
      }
    }
  }
  if (!value.themes.find((theme) => theme.id === "cave")?.enabled) throw new Error("fallback dungeon theme cave must stay enabled");
  return value;
}

export function readDungeonThemes(file = DUNGEON_THEME_FILE, assets = readTileSheets()) {
  if (!fs.existsSync(file)) throw new Error(`dungeon theme file does not exist: ${file}`);
  const document = validateDungeonThemes(JSON.parse(fs.readFileSync(file, "utf8")), assets);
  // Both the generated catalogue and the review editor read pieces through here,
  // so they agree on how tall each one is without either having to guess.
  return resolveDungeonThemePieces(document, assets);
}

function prunePaletteUnknownAssets(palette, assets) {
  const known = new Set(assets.map((asset) => asset.id));
  let removed = 0;
  const pages = (palette.pages ?? []).map((page) => ({
    ...page,
    cells: (page.cells ?? []).filter((cell) => {
      const keep = known.has(cell.assetId);
      if (!keep) removed += 1;
      return keep;
    }),
  }));
  return { palette: { ...palette, pages }, removed };
}

function writePaletteAfterSourceRemoval(file, palette) {
  const temporary = `${file}.${process.pid}.${Date.now()}.prune.tmp`;
  const backup = `${file}.${process.pid}.${Date.now()}.prune.bak`;
  const hadOriginal = fs.existsSync(file);
  fs.writeFileSync(temporary, JSON.stringify(palette, null, 2) + "\n", "utf8");
  try {
    if (hadOriginal) fs.renameSync(file, backup);
    fs.renameSync(temporary, file);
    if (hadOriginal) fs.rmSync(backup, { force: true });
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    if (hadOriginal && fs.existsSync(backup)) {
      fs.rmSync(file, { force: true });
      fs.renameSync(backup, file);
    }
    throw error;
  }
}

export function buildMapTileAssets(options = {}) {
  const inputDir = options.inputDir ?? MAP_TILE_INPUT_DIR;
  const paletteFile = options.paletteFile ?? MAP_TILE_PALETTE_FILE;
  const outputDir = options.outputDir ?? MAP_TILE_OUTPUT_DIR;
  const generatedTs = options.generatedTs ?? MAP_TILE_GENERATED_TS;
  const themeFile = options.themeFile ?? (path.resolve(inputDir) === MAP_TILE_INPUT_DIR ? DUNGEON_THEME_FILE : undefined);
  const themeGeneratedTs = options.themeGeneratedTs ?? DUNGEON_THEME_GENERATED_TS;
  const assets = readTileSheets(inputDir);
  if (assets.length === 0) throw new Error("No map tile sheets found");
  let palette;
  if (fs.existsSync(paletteFile)) palette = JSON.parse(fs.readFileSync(paletteFile, "utf8"));
  else palette = defaultPalette(assets);
  const pruned = prunePaletteUnknownAssets(palette, assets);
  palette = pruned.palette;
  if (pruned.removed > 0 && fs.existsSync(paletteFile)) {
    writePaletteAfterSourceRemoval(paletteFile, palette);
    console.warn(`Removed ${pruned.removed} palette cells whose source sheets no longer exist.`);
  }
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
  writeGeneratedTypescript(generatedTs, assets, palette, themeFile, themeGeneratedTs);
  const themes = themeFile ? readDungeonThemes(themeFile, assets) : { version: 1, themes: [] };
  return { assets: definitions, palette, themes };
}

export function saveDungeonThemesAtomically(value, { themeFile = DUNGEON_THEME_FILE, inputDir = MAP_TILE_INPUT_DIR, generateAssets = buildMapTileAssets } = {}) {
  const assets = readTileSheets(inputDir);
  validateDungeonThemes(value, assets);
  fs.mkdirSync(path.dirname(themeFile), { recursive: true });
  const suffix = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const temporary = `${themeFile}.${suffix}.tmp`;
  const backup = `${themeFile}.${suffix}.bak`;
  const hadOriginal = fs.existsSync(themeFile);
  let backupCreated = false;
  try {
    fs.writeFileSync(temporary, JSON.stringify(authoredDungeonThemePieces(value, assets), null, 2) + "\n", "utf8");
    if (hadOriginal) { fs.renameSync(themeFile, backup); backupCreated = true; }
    fs.renameSync(temporary, themeFile);
    const result = generateAssets({ inputDir, themeFile });
    if (backupCreated) fs.rmSync(backup, { force: true });
    return result.themes;
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    if (backupCreated) {
      fs.rmSync(themeFile, { force: true });
      fs.renameSync(backup, themeFile);
    }
    throw error;
  }
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
