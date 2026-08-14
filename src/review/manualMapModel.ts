import type { CraftpixSheetId } from "../game/craftpixCatalog";
import { CRAFTPIX_SHEETS } from "../game/craftpixCatalog";
import { reachableCells } from "../game/dungeonRules";
import type { CanonicalEdge, DungeonMap, Vec } from "../game/types";

export const MANUAL_MAP_VERSION = 1 as const;
export const MANUAL_MAP_WIDTH = 48;
export const MANUAL_MAP_HEIGHT = 36;
export const MANUAL_MAP_TILE = 16;
export const MANUAL_TRIAL_STORAGE_KEY = "dungeon-manual-map-trial:v1";

export type ManualMapKind = "town" | "interior" | "dungeon";
export const MANUAL_MAP_PRESETS: Record<ManualMapKind, { width: number; height: number; label: string }> = {
  town: { width: 60, height: 45, label: "街" },
  interior: { width: 32, height: 24, label: "建物内部" },
  dungeon: { width: MANUAL_MAP_WIDTH, height: MANUAL_MAP_HEIGHT, label: "ダンジョン" },
};

export const MANUAL_LAYERS = ["ground", "structure", "decoration", "overhead", "light"] as const;
export type ManualVisualLayer = typeof MANUAL_LAYERS[number];

export interface ManualTilePlacement {
  x: number;
  y: number;
  sheet: CraftpixSheetId;
  frame: number;
  animationId?: string;
  flipX?: boolean;
  flipY?: boolean;
  rotation?: 0 | 90 | 180 | 270;
}

export interface ManualDungeonMap {
  version: typeof MANUAL_MAP_VERSION;
  id: string;
  name: string;
  kind: ManualMapKind;
  width: number;
  height: number;
  tileSize: typeof MANUAL_MAP_TILE;
  layers: Record<ManualVisualLayer, ManualTilePlacement[]>;
  /** 0 = walkable, 1 = blocked.  This is always the authoritative rule. */
  collision: number[];
  /** A manually-painted collision cell ignores later palette suggestions. */
  collisionLocked: boolean[];
  hardEdges: string[];
  entrance?: Vec;
  stairs?: Vec;
  createdAt: string;
  updatedAt: string;
  legacyReference?: boolean;
}

export interface ManualDungeonMapPack {
  version: typeof MANUAL_MAP_VERSION;
  maps: ManualDungeonMap[];
}

export interface MapValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  cells?: Vec[];
}

export function manualCellIndex(x: number, y: number): number;
export function manualCellIndex(width: number, x: number, y: number): number;
export function manualCellIndex(map: Pick<ManualDungeonMap, "width">, x: number, y: number): number;
export function manualCellIndex(first: number | Pick<ManualDungeonMap, "width">, second: number, third?: number): number {
  if (typeof first === "number" && third === undefined) return second * MANUAL_MAP_WIDTH + first;
  const width = typeof first === "number" ? first : first.width;
  return (third ?? 0) * width + second;
}

export function manualEdgeKey(x: number, y: number, direction: "east" | "south"): string {
  return `${x},${y},${direction}`;
}

export function parseManualEdge(key: string): CanonicalEdge | undefined {
  const match = /^(\d+),(\d+),(east|south)$/.exec(key);
  if (!match) return undefined;
  return { x: Number(match[1]), y: Number(match[2]), direction: match[3] as "east" | "south" };
}

function emptyLayers(): Record<ManualVisualLayer, ManualTilePlacement[]> {
  return { ground: [], structure: [], decoration: [], overhead: [], light: [] };
}

function mapId(): string {
  return `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createBlankManualMap(name = "新しいダンジョン", kind: ManualMapKind = "dungeon"): ManualDungeonMap {
  const now = new Date().toISOString();
  const dimensions = MANUAL_MAP_PRESETS[kind];
  return {
    version: MANUAL_MAP_VERSION,
    id: mapId(),
    name,
    kind,
    width: dimensions.width,
    height: dimensions.height,
    tileSize: MANUAL_MAP_TILE,
    layers: emptyLayers(),
    collision: Array(dimensions.width * dimensions.height).fill(1),
    collisionLocked: Array(dimensions.width * dimensions.height).fill(false),
    hardEdges: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function cloneManualMap(map: ManualDungeonMap): ManualDungeonMap {
  return {
    ...map,
    entrance: map.entrance ? { ...map.entrance } : undefined,
    stairs: map.stairs ? { ...map.stairs } : undefined,
    layers: Object.fromEntries(MANUAL_LAYERS.map((layer) => [layer, map.layers[layer].map((placement) => ({ ...placement }))])) as Record<ManualVisualLayer, ManualTilePlacement[]>,
    collision: [...map.collision],
    collisionLocked: [...map.collisionLocked],
    hardEdges: [...map.hardEdges],
  };
}

function inBounds(map: Pick<ManualDungeonMap, "width" | "height">, point: Vec): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < map.width && point.y < map.height;
}

function validPlacement(map: Pick<ManualDungeonMap, "width" | "height">, placement: ManualTilePlacement): boolean {
  const sheet = CRAFTPIX_SHEETS[placement.sheet];
  return Boolean(sheet && inBounds(map, placement) && Number.isInteger(placement.frame) && placement.frame >= 0 && placement.frame < sheet.frames);
}

export function topPlacement(map: ManualDungeonMap, layer: ManualVisualLayer, x: number, y: number): ManualTilePlacement | undefined {
  const matches = map.layers[layer].filter((placement) => placement.x === x && placement.y === y);
  return matches.at(-1);
}

export function removeTopPlacement(map: ManualDungeonMap, layer: ManualVisualLayer, x: number, y: number): void {
  const placements = map.layers[layer];
  for (let index = placements.length - 1; index >= 0; index -= 1) {
    const placement = placements[index];
    if (placement?.x === x && placement.y === y) { placements.splice(index, 1); return; }
  }
}

export function collisionSuggestion(layer: ManualVisualLayer, tile: Pick<ManualTilePlacement, "sheet" | "frame">): 0 | 1 | undefined {
  if (layer === "structure") return 1;
  if (layer !== "ground") return undefined;
  if (tile.sheet === "water-coasts" || tile.sheet === "water-details" || tile.sheet === "cracks-coasts") return 1;
  return 0;
}

export function placeManualTile(map: ManualDungeonMap, layer: ManualVisualLayer, placement: ManualTilePlacement, options: { stack?: boolean; applySuggestion?: boolean } = {}): void {
  if (!inBounds(map, placement)) return;
  if (!options.stack) removeTopPlacement(map, layer, placement.x, placement.y);
  map.layers[layer].push({ ...placement });
  const index = manualCellIndex(map, placement.x, placement.y);
  const suggestion = collisionSuggestion(layer, placement);
  if (options.applySuggestion !== false && suggestion !== undefined && !map.collisionLocked[index]) map.collision[index] = suggestion;
}

export function manualMapToDungeonMap(map: ManualDungeonMap, specialRoom?: Vec): DungeonMap {
  const tiles = Array.from({ length: map.height }, (_, y) => Array.from({ length: map.width }, (_, x) => map.collision[manualCellIndex(map, x, y)] ?? 1));
  const hardEdges = map.hardEdges.map(parseManualEdge).filter((edge): edge is CanonicalEdge => edge !== undefined);
  return {
    width: map.width,
    height: map.height,
    tileSize: MANUAL_MAP_TILE,
    visualTheme: "craftpix-manual",
    tiles,
    formatVersion: 2,
    heights: Array.from({ length: map.height }, () => Array(map.width).fill(0)),
    hardEdges,
    ledgeEdges: [],
    traversalLinks: [],
    renderLayers: Object.fromEntries(MANUAL_LAYERS.map((layer) => [layer, map.layers[layer].map((placement) => ({
      assetId: `manual:${placement.sheet}:${placement.frame}`,
      animationId: placement.animationId,
      x: placement.x,
      y: placement.y,
      layer,
      flipX: placement.flipX,
      flipY: placement.flipY,
      rotation: placement.rotation,
    }))])) as DungeonMap["renderLayers"],
    entrance: map.entrance ? { ...map.entrance } : { x: 0, y: 0 },
    stairs: map.stairs ? { ...map.stairs } : { x: 0, y: 0 },
    returnStairs: map.entrance ? { ...map.entrance } : { x: 0, y: 0 },
    specialRoom,
  };
}

export function validateManualMap(map: ManualDungeonMap): MapValidationIssue[] {
  const issues: MapValidationIssue[] = [];
  const expectedLength = map.width * map.height;
  if (map.version !== MANUAL_MAP_VERSION || !MANUAL_MAP_PRESETS[map.kind] || map.width < 16 || map.width > 128 || map.height < 12 || map.height > 96 || map.tileSize !== MANUAL_MAP_TILE) {
    issues.push({ severity: "error", code: "dimensions", message: "マップ種類、サイズ、16pxグリッドを確認してください。" });
  }
  if (map.collision.length !== expectedLength || map.collision.some((value) => value !== 0 && value !== 1) || map.collisionLocked.length !== expectedLength) {
    issues.push({ severity: "error", code: "collision", message: "通行判定データが壊れています。" });
  }
  const invalidTiles = MANUAL_LAYERS.flatMap((layer) => map.layers[layer].filter((placement) => !validPlacement(map, placement)).map((placement) => ({ ...placement, layer })));
  if (invalidTiles.length) issues.push({ severity: "error", code: "tile", message: `無効な素材配置が${invalidTiles.length}件あります。`, cells: invalidTiles.map(({ x, y }) => ({ x, y })) });
  if (!map.entrance || !inBounds(map, map.entrance)) issues.push({ severity: "error", code: "entrance", message: "入口を1つ配置してください。" });
  if (!map.stairs || !inBounds(map, map.stairs)) issues.push({ severity: "error", code: "stairs", message: "下り階段を1つ配置してください。" });
  const invalidEdges = map.hardEdges.filter((key) => {
    const edge = parseManualEdge(key);
    return !edge || edge.x < 0 || edge.y < 0 || (edge.direction === "east" && edge.x >= map.width - 1) || (edge.direction === "south" && edge.y >= map.height - 1);
  });
  if (invalidEdges.length) issues.push({ severity: "error", code: "edges", message: `無効な境界ブロックが${invalidEdges.length}件あります。` });

  if (issues.some((issue) => issue.severity === "error") || !map.entrance || !map.stairs) return issues;
  const dungeon = manualMapToDungeonMap(map);
  const reached = reachableCells(dungeon, map.entrance);
  const entryKey = `${map.entrance.x},${map.entrance.y}`;
  const stairsKey = `${map.stairs.x},${map.stairs.y}`;
  if (!reached.has(entryKey)) issues.push({ severity: "error", code: "entrance-blocked", message: "入口は通行可能セルに置いてください。", cells: [map.entrance] });
  if (!reached.has(stairsKey)) issues.push({ severity: "error", code: "stairs-unreachable", message: "下り階段は入口から到達可能にしてください。", cells: [map.stairs] });
  const walkable = map.collision.reduce((count, value) => count + (value === 0 ? 1 : 0), 0);
  if (reached.size < 40) issues.push({ severity: "error", code: "small", message: `到達可能セルが${reached.size}です。試遊には40セル以上必要です。` });
  if (walkable !== reached.size) issues.push({ severity: "error", code: "islands", message: "入口から到達できない通行可能セルがあります。" });
  const visualWarnings: Vec[] = [];
  for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) {
    if (map.collision[manualCellIndex(map, x, y)] === 0 && !topPlacement(map, "ground", x, y)) visualWarnings.push({ x, y });
  }
  if (visualWarnings.length) issues.push({ severity: "warning", code: "ground", message: `地面タイルのない通行可能セルが${visualWarnings.length}件あります。`, cells: visualWarnings });
  const prohibited = MANUAL_LAYERS.flatMap((layer) => map.layers[layer].filter((placement) => placement.sheet === "doors").map((placement) => ({ x: placement.x, y: placement.y })));
  if (prohibited.length) issues.push({ severity: "warning", code: "legacy-door", message: `扉・格子・レバー用の旧素材が${prohibited.length}件あります。新規マップでは置換してください。`, cells: prohibited });
  return issues;
}

function validMap(value: unknown): value is ManualDungeonMap {
  if (!value || typeof value !== "object") return false;
  const map = value as Partial<ManualDungeonMap>;
  return map.version === MANUAL_MAP_VERSION && typeof map.id === "string" && typeof map.name === "string"
    && (map.kind === undefined || Boolean(MANUAL_MAP_PRESETS[map.kind])) && typeof map.width === "number" && typeof map.height === "number" && map.tileSize === MANUAL_MAP_TILE
    && Array.isArray(map.collision) && Array.isArray(map.collisionLocked) && Array.isArray(map.hardEdges)
    && Boolean(map.layers) && MANUAL_LAYERS.every((layer) => Array.isArray(map.layers?.[layer]));
}

export function normalizeManualMap(value: unknown): ManualDungeonMap | undefined {
  if (!validMap(value)) return undefined;
  const copy = cloneManualMap({ ...value, kind: value.kind ?? "dungeon" } as ManualDungeonMap);
  const errors = validateManualMap(copy).filter((issue) => issue.code === "dimensions" || issue.code === "collision" || issue.code === "tile" || issue.code === "edges");
  if (errors.length) return undefined;
  return copy;
}

export function normalizeManualMapPack(value: unknown): ManualDungeonMapPack | undefined {
  if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== MANUAL_MAP_VERSION || !Array.isArray((value as { maps?: unknown }).maps)) return undefined;
  const maps = (value as { maps: unknown[] }).maps.map(normalizeManualMap);
  if (maps.some((map) => !map)) return undefined;
  return { version: MANUAL_MAP_VERSION, maps: maps as ManualDungeonMap[] };
}

let inMemoryTrialMap: ManualDungeonMap | undefined;

export function storeManualTrialMap(map: ManualDungeonMap): void {
  inMemoryTrialMap = cloneManualMap(map);
  if (typeof sessionStorage !== "undefined") sessionStorage.setItem(MANUAL_TRIAL_STORAGE_KEY, JSON.stringify(map));
}

export function loadManualTrialMap(): ManualDungeonMap | undefined {
  if (typeof sessionStorage === "undefined") return inMemoryTrialMap ? cloneManualMap(inMemoryTrialMap) : undefined;
  try { return normalizeManualMap(JSON.parse(sessionStorage.getItem(MANUAL_TRIAL_STORAGE_KEY) ?? "")) ?? (inMemoryTrialMap ? cloneManualMap(inMemoryTrialMap) : undefined); }
  catch { return inMemoryTrialMap ? cloneManualMap(inMemoryTrialMap) : undefined; }
}

const DATABASE_NAME = "dungeon-manual-map-editor";
const STORE_NAME = "maps";

function openManualDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class ManualMapRepository {
  async list(): Promise<ManualDungeonMap[]> {
    const database = await openManualDatabase();
    const maps = await new Promise<ManualDungeonMap[]>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result as unknown[]).map(normalizeManualMap).filter((map): map is ManualDungeonMap => Boolean(map)));
      request.onerror = () => reject(request.error);
    });
    database.close();
    return maps.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async save(map: ManualDungeonMap): Promise<void> {
    const database = await openManualDatabase();
    const copy = cloneManualMap(map);
    copy.updatedAt = new Date().toISOString();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(copy);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }

  async delete(id: string): Promise<void> {
    const database = await openManualDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }
}
