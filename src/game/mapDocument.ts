import type { DungeonMap, MapKind } from "./types";
import { tileWalkable } from "./mapTiles";
import { MAP_ASSET_CATALOG } from "./mapAssetCatalog.generated";

export const MAP_DOCUMENT_VERSION = 5 as const;
export const MAP_SIZE_MIN = 4;
export const MAP_SIZE_MAX = 256;
export type TileSize = 16 | 32;
export type ManualLayer = "ground" | "structure" | "decoration";
export type MapMarkerKind = "homeSpawn" | "dungeonEntrance" | "homeStorage" | "homePreparation" | "homeVisitors" | "stairsUp" | "stairsDown";
export interface ManualTilePlacement { assetId: string; frame: number; }
export interface MapMarkerVisual { assetId: string; frame: number; }
export interface MapMarker { id: string; kind: MapMarkerKind; x: number; y: number; visual?: MapMarkerVisual; }
export interface MapDocument {
  version: 5; id: string; name: string; kind: MapKind; floor: number; width: number; height: number; tileSize: TileSize;
  /** Retained for legacy tools; v5 rendering reads the explicit layers. */ terrain: Array<string | null>;
  /** true means walkable.  This is mandatory in v5. */ collision: boolean[];
  layers: Record<ManualLayer, Array<ManualTilePlacement | null>>; markers: MapMarker[]; createdAt: string; updatedAt: string;
}
export interface MapFragment { width: number; height: number; terrain: Array<string | null>; markers: MapMarker[]; }
export interface MapCreateOptions { width?: number; height?: number; tileSize?: TileSize; floor?: number; }
export type MapMutationResult = { ok: true } | { ok: false; reason: string };
export interface TrialMapPack { home: MapDocument; dungeons: MapDocument[]; }

const LAYERS: readonly ManualLayer[] = ["ground", "structure", "decoration"];
const ASSETS = new Map<string, typeof MAP_ASSET_CATALOG[number]>(MAP_ASSET_CATALOG.map((asset) => [asset.id, asset]));
const STAIR_KINDS = new Set<MapMarkerKind>(["stairsUp", "stairsDown"]);
const MARKER_KINDS = new Set<MapMarkerKind>(["homeSpawn", "dungeonEntrance", "homeStorage", "homePreparation", "homeVisitors", "stairsUp", "stairsDown"]);
const inside = (map: Pick<MapDocument, "width" | "height">, x: number, y: number): boolean => x >= 0 && y >= 0 && x < map.width && y < map.height;
export function mapIndex(map: Pick<MapDocument, "width">, x: number, y: number): number { return y * map.width + x; }
const touch = (map: MapDocument): void => { map.updatedAt = new Date().toISOString(); };

function resolveArgs(first: MapKind | string, second?: string | MapCreateOptions, third?: MapCreateOptions): { kind: MapKind; name: string; options: MapCreateOptions } {
  const direct = first === "home" || first === "dungeon";
  const kind = (direct ? first : (typeof second === "string" && (second === "home" || second === "dungeon") ? second : undefined)) as MapKind | undefined;
  if (!kind) throw new Error("map kind must be home or dungeon");
  return { kind, name: direct ? (typeof second === "string" ? second : kind) : first, options: (direct ? (typeof second === "object" ? second : third) : third) ?? {} };
}
function checkedDimensions(options: MapCreateOptions, kind: MapKind): { width: number; height: number; tileSize: TileSize } {
  const width = options.width ?? (kind === "home" ? 32 : 48), height = options.height ?? (kind === "home" ? 20 : 36), tileSize = options.tileSize ?? 16;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < MAP_SIZE_MIN || height < MAP_SIZE_MIN || width > MAP_SIZE_MAX || height > MAP_SIZE_MAX) throw new Error(`map dimensions must be ${MAP_SIZE_MIN}..${MAP_SIZE_MAX}`);
  if (tileSize !== 16 && tileSize !== 32) throw new Error("tileSize must be 16 or 32");
  return { width, height, tileSize };
}
export function createBlankMap(first: MapKind | string, second?: string | MapCreateOptions, third?: MapCreateOptions): MapDocument {
  const { kind, name, options } = resolveArgs(first, second, third); const { width, height, tileSize } = checkedDimensions(options, kind); const size = width * height; const now = new Date().toISOString();
  return { version: 5, id: `map-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name, kind, floor: Math.max(0, Math.floor(options.floor ?? (kind === "home" ? 0 : 1))), width, height, tileSize, terrain: Array(size).fill(null), collision: Array(size).fill(false), layers: { ground: Array(size).fill(null), structure: Array(size).fill(null), decoration: Array(size).fill(null) }, markers: [], createdAt: now, updatedAt: now };
}
export const createManualMap = createBlankMap;
export function cloneMap(map: MapDocument): MapDocument { return { ...map, terrain: [...map.terrain], collision: [...map.collision], layers: Object.fromEntries(LAYERS.map((layer) => [layer, map.layers[layer].map((cell) => cell ? { ...cell } : null)])) as MapDocument["layers"], markers: map.markers.map((marker) => ({ ...marker, visual: marker.visual ? { ...marker.visual } : undefined })) }; }
function defaultLayer(assetId: string): ManualLayer { return ASSETS.get(assetId)?.defaultLayer ?? (assetId.endsWith("wall") ? "structure" : "ground"); }
function defaultWalkable(assetId: string | null): boolean { return assetId ? ASSETS.get(assetId)?.defaultWalkable ?? tileWalkable(assetId) : false; }
function visualAssetAt(map: MapDocument, index: number): string | null { return map.layers.decoration[index]?.assetId ?? map.layers.structure[index]?.assetId ?? map.layers.ground[index]?.assetId ?? null; }
function defaultMarkerVisual(kind: "stairsUp" | "stairsDown"): MapMarkerVisual { return { assetId: kind === "stairsUp" ? "dungeon.stairs-up" : "dungeon.stairs-down", frame: 0 }; }

/** Compatibility helper for tools that only carry an asset ID. */
export function placeTile(map: MapDocument, x: number, y: number, assetId: string | null): boolean { if (!inside(map, x, y)) return false; const index = mapIndex(map, x, y); map.terrain[index] = assetId; map.collision[index] = defaultWalkable(assetId); touch(map); return true; }
export function placeManualTile(map: MapDocument, x: number, y: number, assetId: string | null, layer: ManualLayer = "ground", frame = 0): boolean {
  if (!inside(map, x, y)) return false; const index = mapIndex(map, x, y); map.layers[layer][index] = assetId === null ? null : { assetId, frame: Math.max(0, Math.floor(frame)) }; map.terrain[index] = assetId ?? visualAssetAt(map, index); touch(map); return true;
}
export function setCollision(map: MapDocument, x: number, y: number, walkable: boolean): boolean { if (!inside(map, x, y)) return false; map.collision[mapIndex(map, x, y)] = walkable; touch(map); return true; }
export function eraseTile(map: MapDocument, x: number, y: number): boolean { if (!inside(map, x, y)) return false; const index = mapIndex(map, x, y); map.terrain[index] = null; map.collision[index] = false; LAYERS.forEach((layer) => { map.layers[layer][index] = null; }); touch(map); return true; }
export function fillMap(map: MapDocument, x: number, y: number, assetId: string | null): void { if (!inside(map, x, y)) return; const source = map.terrain[mapIndex(map, x, y)]; if (source === assetId) return; const queue: Array<[number, number]> = [[x, y]], seen = new Set<string>(); while (queue.length) { const [cx, cy] = queue.shift()!; const key = `${cx},${cy}`; if (seen.has(key) || !inside(map, cx, cy) || map.terrain[mapIndex(map, cx, cy)] !== source) continue; seen.add(key); placeTile(map, cx, cy, assetId); queue.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]); } }
export function rectangleMap(map: MapDocument, x1: number, y1: number, x2: number, y2: number, assetId: string | null): void { for (let y = Math.max(0, Math.min(y1, y2)); y <= Math.min(map.height - 1, Math.max(y1, y2)); y += 1) for (let x = Math.max(0, Math.min(x1, x2)); x <= Math.min(map.width - 1, Math.max(x1, x2)); x += 1) placeTile(map, x, y, assetId); }
export function addMarker(map: MapDocument, marker: MapMarker): void { if (!inside(map, marker.x, marker.y)) throw new Error("marker out of bounds"); if (map.markers.some((value) => value.id === marker.id)) throw new Error("duplicate marker"); const kind = marker.kind; map.markers.push({ ...marker, kind, visual: marker.visual ? { ...marker.visual } : (kind === "stairsUp" || kind === "stairsDown" ? defaultMarkerVisual(kind) : undefined) }); touch(map); }
export function copyMapFragment(map: MapDocument, x1: number, y1: number, x2: number, y2: number): MapFragment { const left = Math.max(0, Math.min(x1, x2)), top = Math.max(0, Math.min(y1, y2)), right = Math.min(map.width - 1, Math.max(x1, x2)), bottom = Math.min(map.height - 1, Math.max(y1, y2)), width = right - left + 1, height = bottom - top + 1; const terrain: Array<string | null> = []; for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) terrain.push(map.terrain[mapIndex(map, left + x, top + y)]); return { width, height, terrain, markers: map.markers.filter((marker) => marker.x >= left && marker.x <= right && marker.y >= top && marker.y <= bottom).map((marker) => ({ ...marker, x: marker.x - left, y: marker.y - top, visual: marker.visual ? { ...marker.visual } : undefined })) }; }
export function pasteMapFragment(map: MapDocument, fragment: MapFragment, x: number, y: number): boolean { if (x < 0 || y < 0 || x + fragment.width > map.width || y + fragment.height > map.height) return false; for (let fy = 0; fy < fragment.height; fy += 1) for (let fx = 0; fx < fragment.width; fx += 1) placeTile(map, x + fx, y + fy, fragment.terrain[fy * fragment.width + fx] ?? null); for (const marker of fragment.markers) { const next = { ...marker, x: x + marker.x, y: y + marker.y, visual: marker.visual ? { ...marker.visual } : undefined }, old = map.markers.find((value) => value.id === marker.id); if (old) Object.assign(old, next); else map.markers.push(next); } touch(map); return true; }

function isEmpty(map: MapDocument): boolean { return map.terrain.every((value) => value === null) && map.collision.every((value) => !value) && LAYERS.every((layer) => map.layers[layer].every((value) => value === null)) && map.markers.length === 0; }
/** Tile-size conversion is deliberately unavailable once any authored datum exists. */
export function setMapTileSize(map: MapDocument, tileSize: TileSize): MapMutationResult { if (tileSize !== 16 && tileSize !== 32) return { ok: false, reason: "tileSize must be 16 or 32" }; if (map.tileSize === tileSize) return { ok: true }; if (!isEmpty(map)) return { ok: false, reason: "tile size can only change on an empty map" }; map.tileSize = tileSize; touch(map); return { ok: true }; }
export const changeMapTileSize = setMapTileSize;
/** Top-left is preserved; data outside a smaller rectangle causes a safe refusal. */
export function resizeMap(map: MapDocument, width: number, height: number): MapMutationResult {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < MAP_SIZE_MIN || width > MAP_SIZE_MAX || height < MAP_SIZE_MIN || height > MAP_SIZE_MAX) return { ok: false, reason: `dimensions must be ${MAP_SIZE_MIN}..${MAP_SIZE_MAX}` }; if (map.width === width && map.height === height) return { ok: true };
  if (width < map.width || height < map.height) { for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) { if (x < width && y < height) continue; const index = mapIndex(map, x, y); if (map.terrain[index] !== null || map.collision[index] || LAYERS.some((layer) => map.layers[layer][index] !== null)) return { ok: false, reason: "would discard tiles or collision" }; } if (map.markers.some((marker) => marker.x >= width || marker.y >= height)) return { ok: false, reason: "would discard markers" }; }
  const oldWidth = map.width, oldHeight = map.height, size = width * height, terrain: Array<string | null> = Array(size).fill(null), collision = Array<boolean>(size).fill(false), layers = { ground: Array<ManualTilePlacement | null>(size).fill(null), structure: Array<ManualTilePlacement | null>(size).fill(null), decoration: Array<ManualTilePlacement | null>(size).fill(null) };
  for (let y = 0; y < Math.min(height, oldHeight); y += 1) for (let x = 0; x < Math.min(width, oldWidth); x += 1) { const from = y * oldWidth + x, to = y * width + x; terrain[to] = map.terrain[from]; collision[to] = map.collision[from]; LAYERS.forEach((layer) => { layers[layer][to] = map.layers[layer][from] ? { ...map.layers[layer][from]! } : null; }); }
  map.width = width; map.height = height; map.terrain = terrain; map.collision = collision; map.layers = layers; touch(map); return { ok: true };
}

function cellWalkable(map: MapDocument, x: number, y: number): boolean { return map.collision[mapIndex(map, x, y)] === true; }
function reachable(map: MapDocument, a: MapMarker, b: MapMarker): boolean { const queue: Array<[number, number]> = [[a.x, a.y]], seen = new Set([`${a.x},${a.y}`]); while (queue.length) { const [x, y] = queue.shift()!; if (x === b.x && y === b.y) return true; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, key = `${nx},${ny}`; if (inside(map, nx, ny) && !seen.has(key) && cellWalkable(map, nx, ny)) { seen.add(key); queue.push([nx, ny]); } } } return false; }
function isPlacement(value: unknown): value is ManualTilePlacement { return Boolean(value) && typeof value === "object" && typeof (value as ManualTilePlacement).assetId === "string" && (value as ManualTilePlacement).assetId.trim().length > 0 && Number.isInteger((value as ManualTilePlacement).frame) && (value as ManualTilePlacement).frame >= 0; }
function isMarker(value: unknown): value is MapMarker { if (!value || typeof value !== "object") return false; const marker = value as Partial<MapMarker>; return typeof marker.id === "string" && Boolean(marker.id.trim()) && MARKER_KINDS.has(marker.kind as MapMarkerKind) && Number.isInteger(marker.x) && Number.isInteger(marker.y) && (marker.visual === undefined || isPlacement(marker.visual)); }
function assetIssue(assetId: string, kind: MapKind, tileSize: TileSize, frame?: number): string | undefined { const asset = ASSETS.get(assetId); if (!asset) return `missing asset ${assetId}`; if (!(asset.mapKinds as readonly MapKind[]).includes(kind)) return "invalid tile"; if (asset.tileSize !== tileSize) return `asset tileSize ${assetId}`; if (frame !== undefined && frame >= asset.frameCount) return `asset frame ${assetId}`; return undefined; }
/** Unknown catalog IDs are retained in the document and reported here, never stripped. */
export function validateStructure(value: unknown): string[] {
  if (!value || typeof value !== "object") return ["document object"]; const map = value as Partial<MapDocument>, errors: string[] = [];
  for (const key of ["id", "name", "createdAt", "updatedAt"] as const) if (typeof map[key] !== "string" || !(map[key] as string).trim()) errors.push(key);
  if (map.version !== 5) errors.push("version"); if (map.kind !== "home" && map.kind !== "dungeon") errors.push("kind"); if (!Number.isInteger(map.width) || !Number.isInteger(map.height) || map.width! < MAP_SIZE_MIN || map.height! < MAP_SIZE_MIN || map.width! > MAP_SIZE_MAX || map.height! > MAP_SIZE_MAX) errors.push("dimensions"); if (!Number.isInteger(map.floor) || map.floor! < 0) errors.push("floor"); if (map.tileSize !== 16 && map.tileSize !== 32) errors.push("tileSize");
  const size = (map.width ?? 0) * (map.height ?? 0); if (!Array.isArray(map.terrain) || map.terrain.length !== size || map.terrain.some((assetId) => assetId !== null && (typeof assetId !== "string" || !assetId.trim()))) errors.push("terrain size"); if (!Array.isArray(map.collision) || map.collision.length !== size || map.collision.some((value) => typeof value !== "boolean")) errors.push("collision size");
  if (!map.layers || typeof map.layers !== "object") errors.push("layers"); else for (const layer of LAYERS) { const cells = map.layers[layer]; if (!Array.isArray(cells) || cells.length !== size) errors.push(`layer ${layer} size`); else if (cells.some((cell) => cell !== null && !isPlacement(cell))) errors.push(`layer ${layer} tile`); }
  if (!Array.isArray(map.markers)) errors.push("markers"); else if (map.markers.some((marker) => !isMarker(marker))) errors.push("invalid marker"); return [...new Set(errors)];
}
export function validateMap(map: MapDocument): string[] {
  const errors = validateStructure(map); if (errors.length) return errors; const allowed = map.kind === "home" ? ["homeSpawn", "dungeonEntrance", "homeStorage", "homePreparation", "homeVisitors"] as const : ["stairsUp", "stairsDown"] as const, ids = new Set<string>();
  map.terrain.forEach((assetId) => { if (assetId) { const issue = assetIssue(assetId, map.kind, map.tileSize); if (issue) errors.push(issue); } }); LAYERS.forEach((layer) => map.layers[layer].forEach((cell) => { if (cell) { const issue = assetIssue(cell.assetId, map.kind, map.tileSize, cell.frame); if (issue) errors.push(issue); } }));
  for (const marker of map.markers) { if (ids.has(marker.id)) errors.push("duplicate marker"); ids.add(marker.id); if (!allowed.includes(marker.kind as never)) errors.push("marker kind"); if (!inside(map, marker.x, marker.y)) errors.push("marker bounds"); else if (!cellWalkable(map, marker.x, marker.y)) errors.push("marker on blocked cell"); if (STAIR_KINDS.has(marker.kind) && !marker.visual) errors.push(`marker ${marker.kind} visual`); if (marker.visual) { const issue = assetIssue(marker.visual.assetId, map.kind, map.tileSize, marker.visual.frame); if (issue) errors.push(issue); } }
  for (const kind of allowed) if (!(map.kind === "dungeon" && kind === "stairsDown") && map.markers.filter((marker) => marker.kind === kind).length !== 1) errors.push(`marker ${kind}`);
  if (map.kind === "home") {
    const spawn = map.markers.find((marker) => marker.kind === "homeSpawn");
    for (const kind of ["dungeonEntrance", "homeStorage", "homePreparation", "homeVisitors"] as const) {
      const target = map.markers.find((marker) => marker.kind === kind);
      if (spawn && target && !reachable(map, spawn, target)) errors.push(`marker ${kind} unreachable`);
    }
  } else {
    const up = map.markers.find((marker) => marker.kind === "stairsUp"), down = map.markers.find((marker) => marker.kind === "stairsDown");
    if (up && down && !reachable(map, up, down)) errors.push("markers unreachable");
  }
  return [...new Set(errors)];
}

type LegacyMap = { version: 3 | 4; id: string; name: string; kind: MapKind; floor: number; width: number; height: number; tileSize?: number; terrain: Array<string | null>; collision?: boolean[]; tileFrames?: Array<number | null>; layers?: Partial<Record<ManualLayer, Array<{ tileId?: string; assetId?: string; frame: number } | null>>>; markers: Array<{ id: string; kind: string; x: number; y: number; visual?: MapMarkerVisual }>; createdAt: string; updatedAt: string; };
function migrateLegacy(value: LegacyMap): MapDocument {
  const { width, height } = value, size = width * height; if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAP_SIZE_MAX || height > MAP_SIZE_MAX || !Array.isArray(value.terrain) || value.terrain.length !== size) throw new Error("invalid legacy MapDocument dimensions or terrain");
  const terrain = value.terrain.map((assetId) => typeof assetId === "string" ? assetId : null), layers = { ground: Array<ManualTilePlacement | null>(size).fill(null), structure: Array<ManualTilePlacement | null>(size).fill(null), decoration: Array<ManualTilePlacement | null>(size).fill(null) };
  LAYERS.forEach((layer) => { const old = value.layers?.[layer]; if (!Array.isArray(old) || old.length !== size) return; old.forEach((cell, index) => { const assetId = cell?.assetId ?? cell?.tileId; if (assetId && Number.isInteger(cell?.frame) && cell!.frame >= 0) layers[layer][index] = { assetId, frame: cell!.frame }; }); });
  terrain.forEach((assetId, index) => { if (assetId && !layers.ground[index] && !layers.structure[index] && !layers.decoration[index]) layers[defaultLayer(assetId)][index] = { assetId, frame: Math.max(0, Math.floor(value.tileFrames?.[index] ?? 0)) }; });
  const markers = value.markers.map((marker): MapMarker => { const kind = (marker.kind === "dungeonReturn" ? "stairsUp" : marker.kind === "stairs" ? "stairsDown" : marker.kind) as MapMarkerKind; return { id: marker.id, kind, x: marker.x, y: marker.y, visual: kind === "stairsUp" || kind === "stairsDown" ? marker.visual ?? defaultMarkerVisual(kind) : undefined }; });
  const collision = Array.isArray(value.collision) && value.collision.length === size && value.collision.every((walkable) => typeof walkable === "boolean") ? [...value.collision] : terrain.map((assetId, index) => defaultWalkable(layers.decoration[index]?.assetId ?? layers.structure[index]?.assetId ?? layers.ground[index]?.assetId ?? assetId));
  return { version: 5, id: value.id, name: value.name, kind: value.kind, floor: Math.max(0, Math.floor(value.floor ?? (value.kind === "home" ? 0 : 1))), width, height, tileSize: value.tileSize === 32 ? 32 : 16, terrain, collision, layers, markers, createdAt: value.createdAt, updatedAt: value.updatedAt };
}
export function normalizeMap(value: unknown): MapDocument { if (!value || typeof value !== "object") throw new Error("invalid MapDocument v3/v4/v5: document object"); const raw = value as { version?: number }; const map = raw.version === 3 || raw.version === 4 ? migrateLegacy(value as LegacyMap) : cloneMap(value as MapDocument); const errors = validateStructure(map); if (errors.length) throw new Error(`invalid MapDocument v3/v4/v5: ${errors.join(", ")}`); return map; }
export function compileMap(input: MapDocument): DungeonMap { const map = normalizeMap(input), tiles = Array.from({ length: map.height }, (_, y) => Array.from({ length: map.width }, (_, x) => cellWalkable(map, x, y) ? 0 : 1)), up = map.markers.find((marker) => marker.kind === "stairsUp") ?? map.markers.find((marker) => marker.kind === "homeSpawn"), down = map.markers.find((marker) => marker.kind === "stairsDown") ?? map.markers.find((marker) => marker.kind === "dungeonEntrance"), stairsUp = up ? { x: up.x, y: up.y } : { x: 1, y: 1 }, stairsDown = down ? { x: down.x, y: down.y } : undefined; return { width: map.width, height: map.height, tileSize: map.tileSize, tiles, stairsUp, stairsDown, stairsUpVisual: up?.visual ? { ...up.visual } : undefined, stairsDownVisual: down?.visual ? { ...down.visual } : undefined, authoredLayers: Object.fromEntries(LAYERS.map((layer) => [layer, map.layers[layer].map((cell) => cell ? { ...cell } : null)])) as DungeonMap["authoredLayers"] }; }
export function validateTrialMapPack(pack: TrialMapPack): string[] { const errors = [...validateMap(pack.home)]; if (pack.home.kind !== "home") errors.push("trial home kind"); const floors = [...pack.dungeons].sort((a, b) => a.floor - b.floor); if (!floors.length) errors.push("trial dungeon floors"); floors.forEach((map, index) => { errors.push(...validateMap(map)); if (map.kind !== "dungeon") errors.push("trial dungeon kind"); if (map.floor !== index + 1) errors.push("dungeon floors must be unique and contiguous"); const down = map.markers.filter((marker) => marker.kind === "stairsDown").length; if (index < floors.length - 1 && down !== 1) errors.push(`floor ${map.floor} marker stairsDown`); if (index === floors.length - 1 && down > 1) errors.push(`floor ${map.floor} marker stairsDown`); }); return [...new Set(errors)]; }

const DB = "home-dungeon-map-editor", STORE = "maps", TRIAL = "home-dungeon-map-trial:v5", LEGACY_TRIAL = "home-dungeon-map-trial:v3";
export class MapRepository { private memory = new Map<string, MapDocument>(); private db?: Promise<IDBDatabase>; private open(): Promise<IDBDatabase> { if (typeof indexedDB === "undefined") return Promise.reject(new Error("indexedDB unavailable")); if (!this.db) this.db = new Promise((resolve, reject) => { const request = indexedDB.open(DB, 2); request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" }); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); return this.db; } async list(): Promise<MapDocument[]> { try { const db = await this.open(); return await new Promise((resolve, reject) => { const request = db.transaction(STORE).objectStore(STORE).getAll(); request.onsuccess = () => resolve((request.result as unknown[]).map(normalizeMap)); request.onerror = () => reject(request.error); }); } catch { return [...this.memory.values()].map(cloneMap); } } async save(map: MapDocument): Promise<void> { const copy = normalizeMap(map); this.memory.set(copy.id, copy); try { const db = await this.open(); await new Promise<void>((resolve, reject) => { const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(copy); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); } catch { /* memory fallback */ } } async delete(id: string): Promise<void> { this.memory.delete(id); try { const db = await this.open(); db.transaction(STORE, "readwrite").objectStore(STORE).delete(id); } catch { /* memory fallback */ } } }
export function storeTrialMapPack(pack: TrialMapPack): void { const normalized = { home: normalizeMap(pack.home), dungeons: pack.dungeons.map(normalizeMap) }, errors = validateTrialMapPack(normalized); if (errors.length) throw new Error(`trial map validation failed: ${errors.join(", ")}`); localStorage.setItem(TRIAL, JSON.stringify(normalized)); }
export function loadTrialMapPack(): TrialMapPack | undefined { try { const raw = localStorage.getItem(TRIAL); if (!raw) return undefined; const parsed = JSON.parse(raw) as { home?: unknown; dungeons?: unknown[] }; if (!parsed.home || !Array.isArray(parsed.dungeons)) return undefined; const pack = { home: normalizeMap(parsed.home), dungeons: parsed.dungeons.map(normalizeMap) }; return validateTrialMapPack(pack).length === 0 ? pack : undefined; } catch { return undefined; } }
/** Legacy single-map trial bridge. New callers must store a home + complete floor pack. */
export function storeTrialMap(map: MapDocument): void { localStorage.setItem(LEGACY_TRIAL, JSON.stringify(normalizeMap(map))); }
export function loadTrialMap(): MapDocument | undefined { const pack = loadTrialMapPack(); if (pack?.dungeons[0]) return pack.dungeons[0]; try { const raw = localStorage.getItem(LEGACY_TRIAL); return raw ? normalizeMap(JSON.parse(raw)) : undefined; } catch { return undefined; } }
