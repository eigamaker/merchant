import type { Vec } from "./types";

export const TOWN_TILE = 24;
export const TOWN_WIDTH = 48;
export const TOWN_HEIGHT = 36;
export const TOWN_WORLD_WIDTH = TOWN_WIDTH * TOWN_TILE;
export const TOWN_WORLD_HEIGHT = TOWN_HEIGHT * TOWN_TILE;

export type TownPoiKind = "shop" | "guild" | "tavern" | "entrance" | "customer";
export type TownSurface = "grass" | "road" | "plaza" | "water" | "dock" | "field" | "rock";

export interface TownBuilding {
  id: string;
  name: string;
  kind: TownPoiKind;
  customerId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  entrance: Vec;
  roof: number;
  wall: number;
  accent: number;
}

export interface TownPlot {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  gates: Vec[];
  kind: "farm" | "pen" | "estate";
}

export interface TownPointOfInterest {
  id: string;
  name: string;
  pos: Vec;
  kind: TownPoiKind;
  customerId?: string;
  color: number;
}

const tile = (x: number, y: number): Vec => ({ x, y });
const key = (x: number, y: number): string => `${x},${y}`;

/** 町は固定レイアウト。建物は最低でも4×3セル、主要施設は8×3セルで構成する。 */
export const TOWN_BUILDINGS: TownBuilding[] = [
  { id: "entrance", name: "ダンジョン入口", kind: "entrance", x: 21, y: 2, width: 8, height: 3, entrance: tile(25, 5), roof: 0x58606b, wall: 0x7b7065, accent: 0xe6b758 },
  { id: "tavern", name: "酒場", kind: "tavern", x: 5, y: 6, width: 8, height: 3, entrance: tile(9, 9), roof: 0xa75d46, wall: 0xc49a6e, accent: 0xf3c969 },
  { id: "guild", name: "冒険者ギルド", kind: "guild", x: 34, y: 5, width: 8, height: 3, entrance: tile(38, 8), roof: 0x466b86, wall: 0xc6b593, accent: 0xaed9ec },
  { id: "marketHall", name: "中央珍品市場", kind: "shop", x: 15, y: 17, width: 4, height: 3, entrance: tile(17, 20), roof: 0x9b6346, wall: 0xd9c18b, accent: 0xf3c969 },
  { id: "shop", name: "珍品店", kind: "shop", x: 6, y: 22, width: 4, height: 3, entrance: tile(8, 25), roof: 0x8a563d, wall: 0xd1ad75, accent: 0xf1c36b },
  { id: "duke", name: "ローゼン公爵邸", kind: "customer", customerId: "duke", x: 36, y: 22, width: 8, height: 3, entrance: tile(40, 25), roof: 0x704d68, wall: 0xd7c0a2, accent: 0xd9a8ea },
  { id: "scholar", name: "古代史研究室", kind: "customer", customerId: "scholar", x: 4, y: 29, width: 4, height: 3, entrance: tile(6, 32), roof: 0x6d6d70, wall: 0xb6af9a, accent: 0xe7ca78 },
  { id: "mage", name: "ネレア魔術店", kind: "customer", customerId: "mage", x: 17, y: 28, width: 4, height: 3, entrance: tile(19, 31), roof: 0x584c82, wall: 0xaf9ac5, accent: 0x9cc9f2 },
  { id: "jeweler", name: "サフィー宝石店", kind: "customer", customerId: "jeweler", x: 26, y: 28, width: 4, height: 3, entrance: tile(28, 31), roof: 0x4d6f65, wall: 0xd3c29d, accent: 0xef9bb9 },
];

export const TOWN_PLOTS: TownPlot[] = [
  { id: "farm", x: 2, y: 13, width: 13, height: 8, gates: [tile(11, 20)], kind: "farm" },
  { id: "pen", x: 34, y: 12, width: 12, height: 7, gates: [tile(34, 16)], kind: "pen" },
  { id: "estate", x: 34, y: 20, width: 12, height: 12, gates: [tile(34, 26)], kind: "estate" },
];

const market: TownPointOfInterest = { id: "merchant", name: "旅商人ミラ", kind: "customer", customerId: "merchant", pos: tile(16, 20), color: 0x8fc6a5 };

export const TOWN_POINTS: TownPointOfInterest[] = [
  ...TOWN_BUILDINGS.map((building) => ({
    id: building.id,
    name: building.name,
    pos: building.entrance,
    kind: building.kind,
    customerId: building.customerId,
    color: building.accent,
  })),
  market,
];

const roads = new Set<string>();
const plazas = new Set<string>();
const water = new Set<string>();
const docks = new Set<string>();
const fields = new Set<string>();
const rocks = new Set<string>();

function fill(set: Set<string>, x: number, y: number, width: number, height: number): void {
  for (let yy = y; yy < y + height; yy += 1) for (let xx = x; xx < x + width; xx += 1) set.add(key(xx, yy));
}

function roadPath(...waypoints: Vec[]): void {
  for (let index = 0; index < waypoints.length - 1; index += 1) {
    const from = waypoints[index]!;
    const to = waypoints[index + 1]!;
    let x = from.x;
    let y = from.y;
    roads.add(key(x, y));
    while (x !== to.x || y !== to.y) {
      const horizontal = Math.abs(to.x - x);
      const vertical = Math.abs(to.y - y);
      // Alternate steps while moving diagonally. It produces a narrow, walked
      // path with gentle bends instead of a pair of town-block straight lines.
      const stepHorizontal = horizontal > 0 && (vertical === 0 || horizontal > vertical || ((x + y + index) & 1) === 0);
      if (stepHorizontal) x += Math.sign(to.x - x);
      else y += Math.sign(to.y - y);
      roads.add(key(x, y));
    }
  }
}

// The supplied cobble cells form one coherent 4×4 courtyard composition.
// Keep that composition intact instead of repeating its centre fragment across
// a large rectangle.
fill(plazas, 22, 17, 4, 4);
fill(water, 31, 32, 17, 4);
fill(docks, 39, 29, 4, 7);
fill(fields, 3, 14, 11, 6);
fill(rocks, 20, 1, 10, 6);
roadPath(tile(25, 5), tile(26, 8), tile(24, 12), tile(25, 15));
roadPath(tile(9, 9), tile(11, 11), tile(13, 14), tile(19, 17));
roadPath(tile(38, 8), tile(36, 11), tile(33, 14), tile(29, 17));
roadPath(tile(17, 20), tile(20, 20));
roadPath(tile(8, 25), tile(11, 23), tile(16, 21), tile(20, 20));
roadPath(tile(6, 32), tile(8, 29), tile(8, 26), tile(11, 23));
roadPath(tile(19, 31), tile(20, 27), tile(22, 24), tile(23, 22));
roadPath(tile(28, 31), tile(29, 27), tile(28, 23), tile(27, 22));
roadPath(tile(40, 25), tile(37, 24), tile(33, 22), tile(29, 21));

const collision = Array.from({ length: TOWN_HEIGHT }, () => Array.from({ length: TOWN_WIDTH }, () => false));

function block(x: number, y: number): void {
  if (x >= 0 && y >= 0 && x < TOWN_WIDTH && y < TOWN_HEIGHT) collision[y]![x] = true;
}

function blockRect(x: number, y: number, width: number, height: number): void {
  for (let yy = y; yy < y + height; yy += 1) for (let xx = x; xx < x + width; xx += 1) block(xx, yy);
}

for (let x = 0; x < TOWN_WIDTH; x += 1) { block(x, 0); block(x, TOWN_HEIGHT - 1); }
for (let y = 0; y < TOWN_HEIGHT; y += 1) { block(0, y); block(TOWN_WIDTH - 1, y); }
for (const building of TOWN_BUILDINGS) blockRect(building.x, building.y, building.width, building.height);
for (let y = 32; y < 36; y += 1) for (let x = 31; x < 48; x += 1) block(x, y);
for (let y = 29; y < 36; y += 1) for (let x = 39; x < 43; x += 1) collision[y]![x] = false;
for (const plot of TOWN_PLOTS) {
  const gates = new Set(plot.gates.map((gate) => key(gate.x, gate.y)));
  for (let x = plot.x; x < plot.x + plot.width; x += 1) {
    if (!gates.has(key(x, plot.y))) block(x, plot.y);
    if (!gates.has(key(x, plot.y + plot.height - 1))) block(x, plot.y + plot.height - 1);
  }
  for (let y = plot.y; y < plot.y + plot.height; y += 1) {
    if (!gates.has(key(plot.x, y))) block(plot.x, y);
    if (!gates.has(key(plot.x + plot.width - 1, y))) block(plot.x + plot.width - 1, y);
  }
}

// 外周の樹木・岩。見た目と当たり判定を一致させる。
for (const [x, y] of [[2, 3], [4, 3], [14, 4], [31, 3], [45, 4], [2, 27], [12, 33], [46, 25], [30, 30]] as Array<[number, number]>) blockRect(x, y, 2, 2);

export const TOWN_SPAWN: Vec = { x: 24 * TOWN_TILE + TOWN_TILE / 2, y: 19 * TOWN_TILE + TOWN_TILE / 2 };

export function townSurfaceAt(x: number, y: number): TownSurface {
  if (docks.has(key(x, y))) return "dock";
  if (water.has(key(x, y))) return "water";
  if (plazas.has(key(x, y))) return "plaza";
  if (roads.has(key(x, y))) return "road";
  if (fields.has(key(x, y))) return "field";
  if (rocks.has(key(x, y))) return "rock";
  return "grass";
}

export function isTownTileBlocked(x: number, y: number): boolean {
  return x < 0 || y < 0 || x >= TOWN_WIDTH || y >= TOWN_HEIGHT || collision[y]![x];
}

function circleHitsCell(position: Vec, radius: number, cellX: number, cellY: number): boolean {
  const left = cellX * TOWN_TILE;
  const top = cellY * TOWN_TILE;
  const closestX = Math.max(left, Math.min(position.x, left + TOWN_TILE));
  const closestY = Math.max(top, Math.min(position.y, top + TOWN_TILE));
  const dx = position.x - closestX;
  const dy = position.y - closestY;
  return dx * dx + dy * dy < radius * radius;
}

export function isTownPositionWalkable(position: Vec, radius = 10): boolean {
  if (position.x - radius < TOWN_TILE || position.y - radius < TOWN_TILE || position.x + radius > TOWN_WORLD_WIDTH - TOWN_TILE || position.y + radius > TOWN_WORLD_HEIGHT - TOWN_TILE) return false;
  const minX = Math.floor((position.x - radius) / TOWN_TILE);
  const maxX = Math.floor((position.x + radius) / TOWN_TILE);
  const minY = Math.floor((position.y - radius) / TOWN_TILE);
  const maxY = Math.floor((position.y + radius) / TOWN_TILE);
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) if (isTownTileBlocked(x, y) && circleHitsCell(position, radius, x, y)) return false;
  return true;
}

/** X/Yを別に解決し、柵や建物の縁を滑る連続移動にする。 */
export function moveTownPosition(current: Vec, delta: Vec, radius = 10): Vec {
  const horizontal = { x: current.x + delta.x, y: current.y };
  const afterHorizontal = isTownPositionWalkable(horizontal, radius) ? horizontal : current;
  const vertical = { x: afterHorizontal.x, y: afterHorizontal.y + delta.y };
  return isTownPositionWalkable(vertical, radius) ? vertical : afterHorizontal;
}

export function safeTownPosition(position: Vec): Vec {
  return isTownPositionWalkable(position) ? position : { ...TOWN_SPAWN };
}
