import type { Vec } from "./types";
import layout from "./townLayout.json";

export const TOWN_TILE = layout.tile;
export const TOWN_WIDTH = layout.width;
export const TOWN_HEIGHT = layout.height;
export const TOWN_WORLD_WIDTH = TOWN_WIDTH * TOWN_TILE;
export const TOWN_WORLD_HEIGHT = TOWN_HEIGHT * TOWN_TILE;

export type TownPoiKind = "shop" | "guild" | "tavern" | "entrance" | "customer";

/** 絵に描かれた建物の footprint。描画はしないが当たり判定と入口の基準になる。 */
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
}

export interface TownPointOfInterest {
  id: string;
  name: string;
  pos: Vec;
  kind: TownPoiKind;
  customerId?: string;
}

export const TOWN_BUILDINGS: TownBuilding[] = layout.buildings.map((building) => ({
  id: building.id,
  name: building.name,
  kind: building.kind as TownPoiKind,
  ...("customerId" in building ? { customerId: building.customerId as string } : {}),
  x: building.x,
  y: building.y,
  width: building.width,
  height: building.height,
  entrance: { x: building.entrance.x, y: building.entrance.y },
}));

export const TOWN_POINTS: TownPointOfInterest[] = [
  ...TOWN_BUILDINGS.map((building) => ({
    id: building.id,
    name: building.name,
    pos: building.entrance,
    kind: building.kind,
    ...(building.customerId === undefined ? {} : { customerId: building.customerId }),
  })),
  ...layout.points.map((point) => ({
    id: point.id,
    name: point.name,
    pos: { x: point.x, y: point.y },
    kind: point.kind as TownPoiKind,
    ...("customerId" in point ? { customerId: point.customerId as string } : {}),
  })),
];

/**
 * 町の地面はイラストそのものなので、通行可否は絵に合わせて手で起こした
 * `townLayout.json` の60×45マスク（'#'が侵入不可）だけが正になる。
 */
const collision: boolean[][] = layout.collision.map((row) => Array.from(row, (cell) => cell === "#"));

if (collision.length !== TOWN_HEIGHT || collision.some((row) => row.length !== TOWN_WIDTH)) {
  throw new Error(`町の当たり判定は${TOWN_WIDTH}×${TOWN_HEIGHT}である必要があります`);
}

/**
 * 町マップPNGを24pxで切り出したときのフレーム番号。行優先の恒等写像なので、
 * 特定のセルだけ別のタイルへ差し替えたい場合はこの配列を書き換える。
 */
export const TOWN_TILE_INDICES: number[][] = Array.from({ length: TOWN_HEIGHT }, (_, y) =>
  Array.from({ length: TOWN_WIDTH }, (_, x) => y * TOWN_WIDTH + x),
);

export const TOWN_SPAWN: Vec = {
  x: layout.spawn.x * TOWN_TILE + TOWN_TILE / 2,
  y: layout.spawn.y * TOWN_TILE + TOWN_TILE / 2,
};

export function isTownTileBlocked(x: number, y: number): boolean {
  return x < 0 || y < 0 || x >= TOWN_WIDTH || y >= TOWN_HEIGHT || collision[y]![x]!;
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
  if (position.x - radius < 0 || position.y - radius < 0 || position.x + radius > TOWN_WORLD_WIDTH || position.y + radius > TOWN_WORLD_HEIGHT) return false;
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
