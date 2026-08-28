import { DUNGEON_THEME_CATALOG } from "./dungeonThemeCatalog.generated";
import type { DungeonMap, Vec } from "./types";

export type DungeonThemeId = typeof DUNGEON_THEME_CATALOG[number]["id"];
export type DungeonThemeDepth = "shallow" | "middle" | "deep";
export type DungeonDecorationPlacement = "floor" | "wall" | "corner" | "deadEnd";

export interface AssetFrameRef {
  assetId: string;
  frame: number;
}

export interface WeightedFrameRef extends AssetFrameRef {
  weight: number;
}

export interface DungeonDecorationRule {
  id: string;
  placement: DungeonDecorationPlacement;
  variants: readonly WeightedFrameRef[];
  weight: number;
  maxPerFloor: number;
}

export interface DungeonThemeDefinition {
  version: 1;
  id: string;
  label: string;
  enabled: boolean;
  tileSize: 16;
  floorVariants: readonly WeightedFrameRef[];
  wallFrameByMask: readonly AssetFrameRef[];
  stairsUp: AssetFrameRef;
  stairsDown: AssetFrameRef;
  decorations: readonly DungeonDecorationRule[];
  enemyPools: Record<DungeonThemeDepth, readonly string[]>;
}

export interface DungeonRenderPlan {
  themeId: string;
  ground: Array<AssetFrameRef | null>;
  structure: Array<AssetFrameRef | null>;
  decoration: Array<AssetFrameRef | null>;
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
  if (floor >= 6) return "deep";
  if (floor >= 3) return "middle";
  return "shallow";
}

export function dungeonThemeEnemyRoster(themeId: string, floor: number): readonly string[] {
  return dungeonTheme(themeId).enemyPools[dungeonThemeDepth(floor)];
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

/** N=1, E=2, S=4, W=8. A bit is set when the neighbouring cell is also a wall. */
export function dungeonWallMask(map: DungeonMap, x: number, y: number): number {
  const wall = (xx: number, yy: number) => xx < 0 || yy < 0 || xx >= map.width || yy >= map.height || map.tiles[yy]?.[xx] !== 0;
  return Number(wall(x, y - 1)) | (Number(wall(x + 1, y)) << 1) | (Number(wall(x, y + 1)) << 2) | (Number(wall(x - 1, y)) << 3);
}

function walkableNeighbours(map: DungeonMap, x: number, y: number): number {
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => map.tiles[y + dy!]?.[x + dx!] === 0).length;
}

function placementMatches(map: DungeonMap, placement: DungeonDecorationPlacement, x: number, y: number): boolean {
  const floor = map.tiles[y]?.[x] === 0;
  const neighbours = walkableNeighbours(map, x, y);
  if (placement === "floor") return floor;
  if (placement === "wall") return !floor && neighbours > 0;
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
  const visualSeed = deriveDungeonSeed(runSeed, "visual", floor);
  for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) {
    const index = y * map.width + x;
    if (map.tiles[y]?.[x] === 0) ground[index] = weightedFrame(theme.floorVariants, coordinateHash(visualSeed, x, y, 0x13));
    else structure[index] = { ...theme.wallFrameByMask[dungeonWallMask(map, x, y)]! };
  }
  for (const [ruleIndex, rule] of theme.decorations.entries()) {
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
  decoration[map.stairsUp.y * map.width + map.stairsUp.x] = { ...theme.stairsUp };
  if (map.stairsDown) decoration[map.stairsDown.y * map.width + map.stairsDown.x] = { ...theme.stairsDown };
  return { themeId: theme.id, ground, structure, decoration };
}

export function dungeonThemeAssetIds(themeIds: readonly string[] = enabledDungeonThemeIds()): Set<string> {
  const result = new Set<string>();
  for (const id of themeIds) {
    const theme = dungeonTheme(id);
    for (const ref of theme.floorVariants) result.add(ref.assetId);
    for (const ref of theme.wallFrameByMask) result.add(ref.assetId);
    result.add(theme.stairsUp.assetId);
    result.add(theme.stairsDown.assetId);
    for (const rule of theme.decorations) for (const ref of rule.variants) result.add(ref.assetId);
  }
  return result;
}
