import type { CraftpixSheetId } from "../game/craftpixCatalog";
import { CRAFTPIX_SHEETS } from "../game/craftpixCatalog";
import { reachableCells } from "../game/dungeonRules";
import type { CanonicalEdge, DungeonMap, Vec } from "../game/types";

export const MANUAL_MAP_VERSION = 2 as const;
export const MANUAL_MAP_WIDTH = 48;
export const MANUAL_MAP_HEIGHT = 36;
export const MANUAL_MAP_TILE = 16;
export const MANUAL_TRIAL_STORAGE_KEY = "dungeon-manual-map-trial:v2";

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

/** An entrance placed on a town map and connected to an interior map. */
export interface ManualBuildingLink {
  id: string;
  name: string;
  entrance: Vec;
  interiorMapId: string;
}

export interface ManualDungeonMap {
  version: typeof MANUAL_MAP_VERSION;
  id: string;
  name: string;
  kind: ManualMapKind;
  /** Display/order value used by the map editor (1 = first floor). */
  floor: number;
  /** World-space position of local cell (0,0). The editor may grow in any
   * direction without discarding a source map's original coordinate space. */
  origin: Vec;
  width: number;
  height: number;
  tileSize: typeof MANUAL_MAP_TILE;
  layers: Record<ManualVisualLayer, ManualTilePlacement[]>;
  /** 0 = walkable, 1 = blocked.  This is always the authoritative rule. */
  collision: number[];
  /** A manually-painted collision cell ignores later palette suggestions. */
  collisionLocked: boolean[];
  hardEdges: string[];
  /** Town-only building entrances and the authored interiors they open. */
  buildingLinks: ManualBuildingLink[];
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

/** A portable rectangular selection from a manual map, stored with its top-left at 0,0. */
export interface ManualMapFragment {
  width: number;
  height: number;
  layers: Record<ManualVisualLayer, ManualTilePlacement[]>;
  collision: number[];
  collisionLocked: boolean[];
  hardEdges: string[];
  entrance?: Vec;
  stairs?: Vec;
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
    floor: 1,
    origin: { x: 0, y: 0 },
    width: dimensions.width,
    height: dimensions.height,
    tileSize: MANUAL_MAP_TILE,
    layers: emptyLayers(),
    collision: Array(dimensions.width * dimensions.height).fill(1),
    collisionLocked: Array(dimensions.width * dimensions.height).fill(false),
    hardEdges: [],
    buildingLinks: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function cloneManualMap(map: ManualDungeonMap): ManualDungeonMap {
  return {
    ...map,
    origin: { ...(map.origin ?? { x: 0, y: 0 }) },
    entrance: map.entrance ? { ...map.entrance } : undefined,
    stairs: map.stairs ? { ...map.stairs } : undefined,
    buildingLinks: (map.buildingLinks ?? []).map((link) => {
      if (!link || typeof link !== "object") return link as ManualBuildingLink;
      const value = link as ManualBuildingLink;
      return { ...value, entrance: value.entrance ? { ...value.entrance } : { x: Number.NaN, y: Number.NaN } };
    }),
    layers: Object.fromEntries(MANUAL_LAYERS.map((layer) => [layer, map.layers[layer].map((placement) => ({ ...placement }))])) as Record<ManualVisualLayer, ManualTilePlacement[]>,
    collision: [...map.collision],
    collisionLocked: [...map.collisionLocked],
    hardEdges: [...map.hardEdges],
  };
}

/**
 * Keep a one-cell empty margin around authored content.  This turns the old
 * fixed canvas into a grow-on-demand canvas while retaining its compact array
 * storage and existing editor operations.
 */
export function ensureManualMapPadding(map: ManualDungeonMap, padding = 1): void {
  const points: Vec[] = [
    ...MANUAL_LAYERS.flatMap((layer) => map.layers[layer].map(({ x, y }) => ({ x, y }))),
    ...(map.entrance ? [map.entrance] : []),
    ...(map.stairs ? [map.stairs] : []),
    ...(map.buildingLinks ?? []).map((link) => link.entrance),
  ];
  if (points.length === 0) return;
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const left = Math.max(0, padding - minX);
  const top = Math.max(0, padding - minY);
  const right = Math.max(0, maxX + padding - (map.width - 1));
  const bottom = Math.max(0, maxY + padding - (map.height - 1));
  if (left === 0 && top === 0 && right === 0 && bottom === 0) return;
  const nextWidth = map.width + left + right;
  const nextHeight = map.height + top + bottom;
  if (nextWidth > 256 || nextHeight > 256) throw new RangeError("マップは256×256セルを超えられません。");
  const collision = Array(nextWidth * nextHeight).fill(1);
  const collisionLocked = Array(nextWidth * nextHeight).fill(false);
  for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) {
    const source = manualCellIndex(map, x, y);
    const target = (y + top) * nextWidth + x + left;
    collision[target] = map.collision[source] ?? 1;
    collisionLocked[target] = map.collisionLocked[source] ?? false;
  }
  const shift = <T extends Vec>(point: T): T => ({ ...point, x: point.x + left, y: point.y + top });
  for (const layer of MANUAL_LAYERS) map.layers[layer] = map.layers[layer].map((placement) => shift(placement));
  map.entrance = map.entrance && shift(map.entrance);
  map.stairs = map.stairs && shift(map.stairs);
  map.buildingLinks = (map.buildingLinks ?? []).map((link) => ({ ...link, entrance: shift(link.entrance) }));
  map.hardEdges = map.hardEdges.map(parseManualEdge).flatMap((edge) => edge ? [manualEdgeKey(edge.x + left, edge.y + top, edge.direction)] : []);
  map.width = nextWidth;
  map.height = nextHeight;
  map.collision = collision;
  map.collisionLocked = collisionLocked;
  map.origin = { x: (map.origin?.x ?? 0) - left, y: (map.origin?.y ?? 0) - top };
}

function inBounds(map: Pick<ManualDungeonMap, "width" | "height">, point: Vec): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < map.width && point.y < map.height;
}

function validPlacement(map: Pick<ManualDungeonMap, "width" | "height">, placement: ManualTilePlacement): boolean {
  const sheet = CRAFTPIX_SHEETS[placement.sheet];
  return Boolean(sheet && inBounds(map, placement) && Number.isInteger(placement.frame) && placement.frame >= 0 && placement.frame < sheet.frames);
}

function validBuildingLink(map: Pick<ManualDungeonMap, "width" | "height">, link: unknown): link is ManualBuildingLink {
  if (!link || typeof link !== "object") return false;
  const value = link as Partial<ManualBuildingLink>;
  if (!value.entrance) return false;
  return typeof value.id === "string" && value.id.trim().length > 0
    && typeof value.name === "string" && value.name.trim().length > 0
    && typeof value.interiorMapId === "string" && value.interiorMapId.trim().length > 0
    && inBounds(map, value.entrance);
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

function pointInRect(point: Vec, x: number, y: number, width: number, height: number): boolean {
  return point.x >= x && point.y >= y && point.x < x + width && point.y < y + height;
}

function edgeIsInsideRect(edge: CanonicalEdge, x: number, y: number, width: number, height: number): boolean {
  const other = edge.direction === "east" ? { x: edge.x + 1, y: edge.y } : { x: edge.x, y: edge.y + 1 };
  return pointInRect(edge, x, y, width, height) && pointInRect(other, x, y, width, height);
}

/** Copies every editable property in a rectangular map selection. */
export function copyManualMapFragment(map: ManualDungeonMap, start: Vec, end: Vec): ManualMapFragment {
  const minX = Math.max(0, Math.min(start.x, end.x));
  const maxX = Math.min(map.width - 1, Math.max(start.x, end.x));
  const minY = Math.max(0, Math.min(start.y, end.y));
  const maxY = Math.min(map.height - 1, Math.max(start.y, end.y));
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const layers = Object.fromEntries(MANUAL_LAYERS.map((layer) => [layer, map.layers[layer]
    .filter((placement) => pointInRect(placement, minX, minY, width, height))
    .map((placement) => ({ ...placement, x: placement.x - minX, y: placement.y - minY }))
  ])) as Record<ManualVisualLayer, ManualTilePlacement[]>;
  const collision: number[] = [];
  const collisionLocked: boolean[] = [];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = manualCellIndex(map, minX + x, minY + y);
    collision.push(map.collision[index] ?? 1);
    collisionLocked.push(map.collisionLocked[index] ?? false);
  }
  const hardEdges = map.hardEdges
    .map(parseManualEdge)
    .filter((edge): edge is CanonicalEdge => {
      if (!edge) return false;
      return edgeIsInsideRect(edge, minX, minY, width, height);
    })
    .map((edge) => manualEdgeKey(edge.x - minX, edge.y - minY, edge.direction));
  const relativeMarker = (marker: Vec | undefined): Vec | undefined => marker && pointInRect(marker, minX, minY, width, height)
    ? { x: marker.x - minX, y: marker.y - minY }
    : undefined;
  return { width, height, layers, collision, collisionLocked, hardEdges, entrance: relativeMarker(map.entrance), stairs: relativeMarker(map.stairs) };
}

/**
 * Pastes a copied selection at its top-left anchor. Cells outside the destination are ignored.
 * The destination cells are overwritten, including empty layer cells and map markers.
 */
export function pasteManualMapFragment(map: ManualDungeonMap, fragment: ManualMapFragment, anchor: Vec): boolean {
  let pasted = false;
  const targetCells: Vec[] = [];
  for (let y = 0; y < fragment.height; y += 1) for (let x = 0; x < fragment.width; x += 1) {
    const target = { x: anchor.x + x, y: anchor.y + y };
    if (!inBounds(map, target)) continue;
    targetCells.push(target);
    const sourceIndex = y * fragment.width + x;
    const targetIndex = manualCellIndex(map, target.x, target.y);
    map.collision[targetIndex] = fragment.collision[sourceIndex] ?? 1;
    map.collisionLocked[targetIndex] = fragment.collisionLocked[sourceIndex] ?? false;
    pasted = true;
  }
  if (!pasted) return false;

  for (const layer of MANUAL_LAYERS) {
    map.layers[layer] = map.layers[layer].filter((placement) => !targetCells.some((cell) => cell.x === placement.x && cell.y === placement.y));
    for (const placement of fragment.layers[layer]) {
      const target = { x: anchor.x + placement.x, y: anchor.y + placement.y };
      if (inBounds(map, target)) map.layers[layer].push({ ...placement, ...target });
    }
  }

  const targetCellKeys = new Set(targetCells.map((cell) => `${cell.x},${cell.y}`));
  const edgeWithinPastedCells = (edge: CanonicalEdge): boolean => {
    const other = edge.direction === "east" ? { x: edge.x + 1, y: edge.y } : { x: edge.x, y: edge.y + 1 };
    return targetCellKeys.has(`${edge.x},${edge.y}`) && targetCellKeys.has(`${other.x},${other.y}`);
  };
  map.hardEdges = map.hardEdges.filter((key) => {
    const edge = parseManualEdge(key);
    return !edge || !edgeWithinPastedCells(edge);
  });
  for (const key of fragment.hardEdges) {
    const edge = parseManualEdge(key);
    if (!edge) continue;
    const target = { x: anchor.x + edge.x, y: anchor.y + edge.y };
    if (edgeIsInsideRect({ ...edge, ...target }, 0, 0, map.width, map.height)) map.hardEdges.push(manualEdgeKey(target.x, target.y, edge.direction));
  }

  if (map.entrance && targetCellKeys.has(`${map.entrance.x},${map.entrance.y}`)) map.entrance = undefined;
  if (map.stairs && targetCellKeys.has(`${map.stairs.x},${map.stairs.y}`)) map.stairs = undefined;
  const pasteMarker = (marker: Vec | undefined): Vec | undefined => {
    if (!marker) return undefined;
    const target = { x: anchor.x + marker.x, y: anchor.y + marker.y };
    return inBounds(map, target) ? target : undefined;
  };
  const entrance = pasteMarker(fragment.entrance);
  const stairs = pasteMarker(fragment.stairs);
  if (entrance) map.entrance = entrance;
  if (stairs) map.stairs = stairs;
  return true;
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
  if (map.version !== MANUAL_MAP_VERSION || !MANUAL_MAP_PRESETS[map.kind] || !Number.isInteger(map.floor) || map.floor < 1 || !map.origin || !Number.isInteger(map.origin.x) || !Number.isInteger(map.origin.y) || map.width < 1 || map.width > 256 || map.height < 1 || map.height > 256 || map.tileSize !== MANUAL_MAP_TILE) {
    issues.push({ severity: "error", code: "dimensions", message: "マップ種類、サイズ、16pxグリッドを確認してください。" });
  }
  if (map.collision.length !== expectedLength || map.collision.some((value) => value !== 0 && value !== 1) || map.collisionLocked.length !== expectedLength) {
    issues.push({ severity: "error", code: "collision", message: "通行判定データが壊れています。" });
  }
  const invalidTiles = MANUAL_LAYERS.flatMap((layer) => map.layers[layer].filter((placement) => !validPlacement(map, placement)).map((placement) => ({ ...placement, layer })));
  if (invalidTiles.length) issues.push({ severity: "error", code: "tile", message: `無効な素材配置が${invalidTiles.length}件あります。`, cells: invalidTiles.map(({ x, y }) => ({ x, y })) });
  const buildingLinks = map.buildingLinks ?? [];
  if (map.kind !== "town" && buildingLinks.length) issues.push({ severity: "warning", code: "building-link-kind", message: "建物リンクは街マップでのみ使用されます。" });
  const invalidBuildingLinks = buildingLinks.filter((link) => !validBuildingLink(map, link));
  if (invalidBuildingLinks.length) issues.push({ severity: "error", code: "building-link", message: `無効な建物リンクが${invalidBuildingLinks.length}件あります。` });
  const validLinkIds = buildingLinks.filter((link): link is ManualBuildingLink => validBuildingLink(map, link)).map((link) => link.id);
  if (new Set(validLinkIds).size !== validLinkIds.length) issues.push({ severity: "error", code: "building-link-id", message: "建物IDが重複しています。" });
  if (map.kind !== "town" && (!map.entrance || !inBounds(map, map.entrance))) issues.push({ severity: "error", code: "entrance", message: "入口を1つ配置してください。" });
  if (map.kind === "dungeon" && (!map.stairs || !inBounds(map, map.stairs))) issues.push({ severity: "error", code: "stairs", message: "下り階段を1つ配置してください。" });
  const invalidEdges = map.hardEdges.filter((key) => {
    const edge = parseManualEdge(key);
    return !edge || edge.x < 0 || edge.y < 0 || (edge.direction === "east" && edge.x >= map.width - 1) || (edge.direction === "south" && edge.y >= map.height - 1);
  });
  if (invalidEdges.length) issues.push({ severity: "error", code: "edges", message: `無効な境界ブロックが${invalidEdges.length}件あります。` });

  if (issues.some((issue) => issue.severity === "error") || map.kind !== "dungeon" || !map.entrance || !map.stairs) return issues;
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
    && (map.floor === undefined || (typeof map.floor === "number" && Number.isInteger(map.floor) && map.floor >= 1))
    && (map.origin === undefined || (typeof map.origin.x === "number" && typeof map.origin.y === "number"))
    && (map.buildingLinks === undefined || Array.isArray(map.buildingLinks))
    && Boolean(map.layers) && MANUAL_LAYERS.every((layer) => Array.isArray(map.layers?.[layer]));
}

export function normalizeManualMap(value: unknown): ManualDungeonMap | undefined {
  if (!validMap(value)) return undefined;
  const copy = cloneManualMap({ ...value, kind: value.kind ?? "dungeon", floor: value.floor ?? 1, origin: value.origin ?? { x: 0, y: 0 }, buildingLinks: value.buildingLinks ?? [] } as ManualDungeonMap);
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
    const request = indexedDB.open(DATABASE_NAME, 2);
    request.onupgradeneeded = () => {
      // v1 referenced non-canonical PNG frame numbers.  Resetting the editor
      // store is intentional: those maps cannot be faithfully migrated.
      if (request.result.objectStoreNames.contains(STORE_NAME)) request.result.deleteObjectStore(STORE_NAME);
      request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
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
