import { blobFrame, neighbourMask } from "./autotile";
import { depthBand } from "./dungeonDifficulty";
import { DUNGEON_THEME_CATALOG } from "./dungeonThemeCatalog.generated";
import { MAP_ASSET_CATALOG } from "./mapAssetCatalog.generated";
import type { DungeonMap, Vec } from "./types";

export type DungeonThemeId = typeof DUNGEON_THEME_CATALOG[number]["id"];
export type DungeonThemeDepth = "shallow" | "middle" | "deep";
/**
 * Where a decoration rule may drop a prop.
 *
 * `wall` is any wall cell touching floor, which includes the far side of a
 * wall the camera never sees. `wallFace` is the near side only - the cell the
 * wall shows to the player - which is what anything hung on a wall needs.
 */
export type DungeonDecorationPlacement = "floor" | "wall" | "wallFace" | "corner" | "deadEnd";

export interface AssetFrameRef {
  assetId: string;
  frame: number;
}

/**
 * A piece of scenery the game places on purpose: a staircase, a chest, a body.
 * It is one cell or two. The reference always names the cell it stands in;
 * `height: 2` says the picture continues into the row above on the sheet and is
 * drawn one cell further up. An up-staircase leans back into the cell behind it
 * that way, while a down-staircase is a hole and stays flat.
 *
 * The build derives this from the sheet's alpha (scripts/map-tile-pipeline.mjs),
 * so a theme names only the frame its author can see in the palette.
 */
export interface DungeonPieceRef extends AssetFrameRef {
  height?: 1 | 2;
}

/**
 * Tiles the game places for its own reasons rather than for atmosphere. A
 * decoration rule scatters props wherever its placement matches; these appear
 * only where something is actually there to interact with, so a player can read
 * a body as loot to recover instead of as scenery.
 *
 * Absent entries fall back to the shared placeholder object sheet, which is what
 * every theme used before it could name its own.
 */
export interface DungeonThemeObjects {
  /** Where an unopened chest waits. */
  chest?: DungeonPieceRef;
  /** Where an adventurer died and left something to recover. */
  corpse?: DungeonPieceRef;
}

export type DungeonThemeObjectKind = keyof DungeonThemeObjects;
export const DUNGEON_THEME_OBJECT_KINDS: readonly DungeonThemeObjectKind[] = ["chest", "corpse"];

export interface WeightedFrameRef extends AssetFrameRef {
  weight: number;
}

export interface DungeonDecorationRule {
  id: string;
  placement: DungeonDecorationPlacement;
  variants: readonly WeightedFrameRef[];
  weight: number;
  maxPerFloor: number;
  /**
   * `false` keeps the rule authored but places nothing. A prop that ought to do
   * something - a pit that drops you a floor - can sit here fully chosen while
   * it would still only be scenery, instead of being deleted and re-found later.
   */
  enabled?: boolean;
}

/**
 * A whole wall set in one reference. The sheet is an expanded blob autotile, so
 * naming the asset is enough: the tile for any neighbourhood is derived rather
 * than authored, which replaces sixteen hand-entered frame numbers per theme.
 */
export interface DungeonWallAutotile {
  assetId: string;
  /**
   * Drawn on wall cells whose south neighbour is floor — the side of the wall
   * that faces the camera. Without one the top tile is used everywhere.
   */
  face?: AssetFrameRef;
  /** 2 makes the face overhang one cell upwards, so the wall reads as a block. */
  faceHeight?: 1 | 2;
}

/**
 * One line of a theme's spawn table. Depth range and weight replace the three
 * fixed shallow/middle/deep buckets, so a creature can fade in and out instead
 * of appearing or vanishing at a hard boundary.
 */
export interface DungeonSpawnEntry {
  actorId: string;
  minFloor: number;
  /** Omitted means "from minFloor down". */
  maxFloor?: number;
  weight: number;
  role?: "common" | "elite";
  maxPerFloor?: number;
}

export interface DungeonThemeDefinition {
  version: 1;
  id: string;
  label: string;
  enabled: boolean;
  tileSize: 16;
  floorVariants: readonly WeightedFrameRef[];
  /** Preferred. Resolves all 256 eight-neighbour cases from one asset. */
  wall?: DungeonWallAutotile;
  /** Legacy fallback: sixteen frames indexed by the four-neighbour mask. */
  wallFrameByMask?: readonly AssetFrameRef[];
  stairsUp: DungeonPieceRef;
  stairsDown: DungeonPieceRef;
  /** Optional. Without it the game falls back to the placeholder object sheet. */
  objects?: DungeonThemeObjects;
  decorations: readonly DungeonDecorationRule[];
  /** Preferred. Depth ranges and weights, spent against the floor's budget. */
  spawns?: readonly DungeonSpawnEntry[];
  /** Legacy fallback: three fixed depth buckets. */
  enemyPools?: Record<DungeonThemeDepth, readonly string[]>;
}

export interface DungeonRenderPlan {
  themeId: string;
  ground: Array<AssetFrameRef | null>;
  structure: Array<AssetFrameRef | null>;
  decoration: Array<AssetFrameRef | null>;
  /**
   * Pieces that belong to the cell at their index but are drawn one cell above
   * it. They sort with the entities so a wall can stand in front of an actor.
   */
  overhang: Array<AssetFrameRef | null>;
}

export const DUNGEON_THEME_FALLBACK_ID: DungeonThemeId = "cave";
export const DUNGEON_THEME_SCHEDULE_VERSION = 1 as const;
export const DUNGEON_THEME_ZONE_FLOORS = 3;

const themes = new Map<string, DungeonThemeDefinition>(
  DUNGEON_THEME_CATALOG.map((theme) => [theme.id, theme as DungeonThemeDefinition]),
);

function mix32(value: number): number {
  let result = value | 0;
  result = Math.imul(result ^ (result >>> 16), 0x21f0aaad);
  result = Math.imul(result ^ (result >>> 15), 0x735a2d97);
  return (result ^ (result >>> 15)) >>> 0;
}

export function deriveDungeonSeed(seed: number, stream: string, floor = 0): number {
  let value = mix32(seed ^ Math.imul(floor + 1, 0x9e3779b1));
  for (let index = 0; index < stream.length; index += 1) value = mix32(value ^ stream.charCodeAt(index));
  return value || 1;
}

function coordinateHash(seed: number, x: number, y: number, salt: number): number {
  return mix32(seed ^ Math.imul(x + 1, 0x85ebca6b) ^ Math.imul(y + 1, 0xc2b2ae35) ^ salt);
}

export function dungeonTheme(id: string | undefined): DungeonThemeDefinition {
  return themes.get(id ?? "") ?? themes.get(DUNGEON_THEME_FALLBACK_ID)!;
}

export function enabledDungeonThemeIds(): string[] {
  const ids = DUNGEON_THEME_CATALOG.filter((theme) => theme.enabled).map((theme) => theme.id);
  return ids.includes(DUNGEON_THEME_FALLBACK_ID) ? ids : [DUNGEON_THEME_FALLBACK_ID, ...ids];
}

export function snapshotDungeonThemePool(): string[] {
  return enabledDungeonThemeIds();
}

function shuffled<T>(values: readonly T[], seed: number): T[] {
  const result = [...values];
  let state = seed >>> 0 || 1;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = mix32(state + index);
    const other = state % (index + 1);
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}

/** Three consecutive floors share a theme. Every pool-sized cycle reshuffles independently. */
export function dungeonThemeIdForFloor(seed: number, floor: number, poolIds: readonly string[], override?: string): string {
  if (override && themes.has(override)) return override;
  const pool = [...new Set(poolIds)].filter((id) => themes.has(id));
  if (pool.length === 0) pool.push(DUNGEON_THEME_FALLBACK_ID);
  const zone = Math.floor((Math.max(1, floor) - 1) / DUNGEON_THEME_ZONE_FLOORS);
  const cycle = Math.floor(zone / pool.length);
  const cycleOrder = shuffled(pool, deriveDungeonSeed(seed, "theme-schedule", cycle));
  return cycleOrder[zone % pool.length] ?? DUNGEON_THEME_FALLBACK_ID;
}

export function dungeonThemeDepth(floor: number): DungeonThemeDepth {
  return depthBand(floor);
}

/** The spawn lines a floor is eligible for, in table order. */
export function dungeonThemeSpawns(themeId: string, floor: number): readonly DungeonSpawnEntry[] {
  const theme = dungeonTheme(themeId);
  if (!theme.spawns?.length) {
    const pool = theme.enemyPools?.[dungeonThemeDepth(floor)] ?? [];
    return pool.map((actorId) => ({ actorId, minFloor: 1, weight: 1 }));
  }
  return theme.spawns.filter((entry) => floor >= entry.minFloor && (entry.maxFloor === undefined || floor <= entry.maxFloor));
}

export function dungeonThemeEnemyRoster(themeId: string, floor: number): readonly string[] {
  return [...new Set(dungeonThemeSpawns(themeId, floor).map((entry) => entry.actorId))];
}

function weightedFrame(values: readonly WeightedFrameRef[], hash: number): AssetFrameRef {
  const total = values.reduce((sum, value) => sum + value.weight, 0);
  let cursor = (hash / 0x100000000) * total;
  for (const value of values) {
    cursor -= value.weight;
    if (cursor < 0) return { assetId: value.assetId, frame: value.frame };
  }
  const fallback = values[values.length - 1]!;
  return { assetId: fallback.assetId, frame: fallback.frame };
}

const isWall = (map: DungeonMap, x: number, y: number): boolean =>
  x < 0 || y < 0 || x >= map.width || y >= map.height || map.tiles[y]?.[x] !== 0;

/** N=1, E=2, S=4, W=8. A bit is set when the neighbouring cell is also a wall. */
export function dungeonWallMask(map: DungeonMap, x: number, y: number): number {
  const wall = (xx: number, yy: number) => isWall(map, xx, yy);
  return Number(wall(x, y - 1)) | (Number(wall(x + 1, y)) << 1) | (Number(wall(x, y + 1)) << 2) | (Number(wall(x - 1, y)) << 3);
}

/** The eight-neighbour form, which is what a corner-aware autotile needs. */
export function dungeonWallNeighbourMask(map: DungeonMap, x: number, y: number): number {
  return neighbourMask(x, y, (xx, yy) => isWall(map, xx, yy));
}

const autotileByAssetId = new Map<string, { scheme: string; animationFrames: number }>(
  MAP_ASSET_CATALOG
    .filter((asset): asset is typeof asset & { autotile: { scheme: string; animationFrames: number } } => "autotile" in asset && Boolean(asset.autotile))
    .map((asset) => [asset.id, asset.autotile]),
);

const columnsByAssetId = new Map<string, number>(MAP_ASSET_CATALOG.map((asset) => [asset.id, asset.columns]));

/**
 * A two-cell face is drawn as two frames stacked on the sheet: the reference
 * names the upper half and the row below it carries the lower half, which is how
 * these wall sheets are laid out. A one-cell face uses the same frame for both.
 */
export function dungeonWallFaceHalves(wall: DungeonWallAutotile | undefined): { upper: AssetFrameRef; lower: AssetFrameRef } | undefined {
  if (!wall?.face) return undefined;
  const columns = columnsByAssetId.get(wall.face.assetId) ?? 0;
  if ((wall.faceHeight ?? 1) === 1 || columns <= 0) return { upper: { ...wall.face }, lower: { ...wall.face } };
  return { upper: { ...wall.face }, lower: { assetId: wall.face.assetId, frame: wall.face.frame + columns } };
}

/**
 * The halves of a stair piece. The mirror of `dungeonWallFaceHalves`: a wall is
 * authored from its top so its reference is the upper half, while a stair is
 * authored from the cell it occupies so its reference is the lower half and the
 * upper one is the frame a row earlier.
 */
export function dungeonPieceHalves(ref: DungeonPieceRef): { lower: AssetFrameRef; upper?: AssetFrameRef } {
  const lower: AssetFrameRef = { assetId: ref.assetId, frame: ref.frame };
  const columns = columnsByAssetId.get(ref.assetId) ?? 0;
  if ((ref.height ?? 1) === 1 || columns <= 0 || ref.frame < columns) return { lower };
  return { lower, upper: { assetId: ref.assetId, frame: ref.frame - columns } };
}

/** The tile a theme wants for one of the game's own objects, if it names one. */
export function dungeonThemeObject(theme: DungeonThemeDefinition, kind: DungeonThemeObjectKind): DungeonPieceRef | undefined {
  const ref = theme.objects?.[kind];
  return ref ? { ...ref } : undefined;
}

/** Whether a theme's wall reference resolves to an expanded blob sheet. */
export function dungeonWallAutotile(theme: DungeonThemeDefinition): { assetId: string; animationFrames: number } | undefined {
  if (!theme.wall) return undefined;
  const autotile = autotileByAssetId.get(theme.wall.assetId);
  if (!autotile || autotile.scheme !== "blob47") return undefined;
  return { assetId: theme.wall.assetId, animationFrames: autotile.animationFrames };
}

export type DungeonWallAutotileResolver = (theme: DungeonThemeDefinition) => { assetId: string; animationFrames: number } | undefined;

/**
 * The wall tile for one cell. An autotile theme derives it from the eight
 * neighbours; older themes keep their sixteen authored frames.
 *
 * `resolve` is injectable so the derived path can be exercised without a
 * blob sheet in the generated catalogue.
 */
export function dungeonWallFrame(theme: DungeonThemeDefinition, map: DungeonMap, x: number, y: number, animationFrame = 0, resolve: DungeonWallAutotileResolver = dungeonWallAutotile): AssetFrameRef {
  const face = dungeonWallFaceHalves(theme.wall);
  if (face && !isWall(map, x, y + 1)) return face.lower;
  const autotile = resolve(theme);
  if (autotile) {
    return { assetId: autotile.assetId, frame: blobFrame(dungeonWallNeighbourMask(map, x, y), animationFrame, autotile.animationFrames) };
  }
  const authored = theme.wallFrameByMask?.[dungeonWallMask(map, x, y)];
  if (authored) return { ...authored };
  // A theme with neither a resolvable autotile nor authored frames would leave
  // holes in the map, so fall back to the first frame of whatever it names.
  return { assetId: theme.wall?.assetId ?? theme.floorVariants[0]!.assetId, frame: 0 };
}

function walkableNeighbours(map: DungeonMap, x: number, y: number): number {
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => map.tiles[y + dy!]?.[x + dx!] === 0).length;
}

function placementMatches(map: DungeonMap, placement: DungeonDecorationPlacement, x: number, y: number): boolean {
  const floor = map.tiles[y]?.[x] === 0;
  const neighbours = walkableNeighbours(map, x, y);
  if (placement === "floor") return floor;
  if (placement === "wall") return !floor && neighbours > 0;
  // The face is the side the wall turns towards the camera, the same test
  // dungeonWallFrame uses to decide which wall tile to draw.
  if (placement === "wallFace") return !floor && map.tiles[y + 1]?.[x] === 0;
  if (placement === "deadEnd") return floor && neighbours <= 1;
  if (!floor) return false;
  const north = map.tiles[y - 1]?.[x] !== 0;
  const east = map.tiles[y]?.[x + 1] !== 0;
  const south = map.tiles[y + 1]?.[x] !== 0;
  const west = map.tiles[y]?.[x - 1] !== 0;
  return (north && east) || (east && south) || (south && west) || (west && north);
}

function same(a: Vec | undefined, x: number, y: number): boolean {
  return Boolean(a && a.x === x && a.y === y);
}

export function createDungeonRenderPlan(map: DungeonMap, runSeed: number, floor: number, themeOverride?: DungeonThemeDefinition): DungeonRenderPlan {
  const theme = themeOverride ?? dungeonTheme(map.procedural?.themeId);
  const size = map.width * map.height;
  const ground: Array<AssetFrameRef | null> = Array(size).fill(null);
  const structure: Array<AssetFrameRef | null> = Array(size).fill(null);
  const decoration: Array<AssetFrameRef | null> = Array(size).fill(null);
  const overhang: Array<AssetFrameRef | null> = Array(size).fill(null);
  const visualSeed = deriveDungeonSeed(runSeed, "visual", floor);
  const wallFace = dungeonWallFaceHalves(theme.wall);
  const overhangs = wallFace !== undefined && (theme.wall?.faceHeight ?? 1) === 2;
  for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) {
    const index = y * map.width + x;
    if (map.tiles[y]?.[x] === 0) { ground[index] = weightedFrame(theme.floorVariants, coordinateHash(visualSeed, x, y, 0x13)); continue; }
    structure[index] = dungeonWallFrame(theme, map, x, y);
    // A two-cell-high face keeps its collision in this cell but reaches one cell
    // up, so the upper half is carried separately and sorted with the entities.
    if (overhangs && !isWall(map, x, y + 1) && y > 0) overhang[index] = { ...wallFace!.upper };
  }
  for (const [ruleIndex, rule] of theme.decorations.entries()) {
    // Skipped rather than filtered out: the rule's index salts its placement
    // hash, so switching one off leaves every other rule where it already was.
    if (rule.enabled === false) continue;
    const candidates: Array<{ x: number; y: number; hash: number }> = [];
    for (let y = 1; y < map.height - 1; y += 1) for (let x = 1; x < map.width - 1; x += 1) {
      if (same(map.stairsUp, x, y) || same(map.stairsDown, x, y) || !placementMatches(map, rule.placement, x, y)) continue;
      const hash = coordinateHash(visualSeed, x, y, 0x100 + ruleIndex);
      if (hash / 0x100000000 < rule.weight) candidates.push({ x, y, hash });
    }
    candidates.sort((a, b) => a.hash - b.hash || a.y - b.y || a.x - b.x);
    for (const candidate of candidates.slice(0, rule.maxPerFloor)) {
      const index = candidate.y * map.width + candidate.x;
      if (!decoration[index]) decoration[index] = weightedFrame(rule.variants, mix32(candidate.hash ^ 0xa53));
    }
  }
  const placeStairs = (at: Vec, ref: DungeonPieceRef): void => {
    const index = at.y * map.width + at.x;
    const halves = dungeonPieceHalves(ref);
    decoration[index] = halves.lower;
    // The upper half sorts with the entities rather than the terrain, so the
    // party passes behind the far side of a staircase and in front of the near.
    if (halves.upper && at.y > 0) overhang[index] = halves.upper;
  };
  placeStairs(map.stairsUp, theme.stairsUp);
  if (map.stairsDown) placeStairs(map.stairsDown, theme.stairsDown);
  return { themeId: theme.id, ground, structure, decoration, overhang };
}

export function dungeonThemeAssetIds(themeIds: readonly string[] = enabledDungeonThemeIds()): Set<string> {
  const result = new Set<string>();
  for (const id of themeIds) {
    const theme = dungeonTheme(id);
    for (const ref of theme.floorVariants) result.add(ref.assetId);
    if (theme.wall) result.add(theme.wall.assetId);
    for (const ref of theme.wallFrameByMask ?? []) result.add(ref.assetId);
    result.add(theme.stairsUp.assetId);
    result.add(theme.stairsDown.assetId);
    for (const kind of DUNGEON_THEME_OBJECT_KINDS) {
      const object = theme.objects?.[kind];
      if (object) result.add(object.assetId);
    }
    for (const rule of theme.decorations) for (const ref of rule.variants) result.add(ref.assetId);
  }
  return result;
}
