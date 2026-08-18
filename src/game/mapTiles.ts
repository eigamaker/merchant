import type { DungeonMap, MapKind } from "./types";

export const CARDINAL_BITS = { north: 1, east: 2, south: 4, west: 8 } as const;
/** Asset IDs are authored by the generated sheet catalog.  These four are the
 * legacy built-ins retained for old maps and procedural fallback rendering. */
export type LegacyMapTileId = "home.floor" | "home.wall" | "dungeon.floor" | "dungeon.wall";
export type MapTileId = string;
export type TileVisual = SingleVisual | CardinalVisual;
export type SingleVisual = { kind: "single"; path: string };
export type CardinalVisual = { kind: "cardinal"; path: string; connectGroup: string; frameByMask: readonly [number,number,number,number,number,number,number,number,number,number,number,number,number,number,number,number] };
export interface MapTileDefinition { id: MapTileId; label: string; mapKinds: readonly MapKind[]; layer: "ground" | "structure"; walkable: boolean; visual: TileVisual; }

const identity = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] as const;
export const MAP_TILES: Readonly<Record<LegacyMapTileId, MapTileDefinition>> = {
  "home.floor": { id: "home.floor", label: "家の床", mapKinds: ["home"], layer: "ground", walkable: true, visual: { kind: "single", path: "/assets/map-tiles/home-floor.png" } },
  "home.wall": { id: "home.wall", label: "家の壁", mapKinds: ["home"], layer: "structure", walkable: false, visual: { kind: "cardinal", path: "/assets/map-tiles/home-wall.png", connectGroup: "home.wall", frameByMask: identity } },
  "dungeon.floor": { id: "dungeon.floor", label: "ダンジョンの床", mapKinds: ["dungeon"], layer: "ground", walkable: true, visual: { kind: "single", path: "/assets/map-tiles/dungeon-floor.png" } },
  "dungeon.wall": { id: "dungeon.wall", label: "ダンジョンの壁", mapKinds: ["dungeon"], layer: "structure", walkable: false, visual: { kind: "cardinal", path: "/assets/map-tiles/dungeon-wall.png", connectGroup: "dungeon.wall", frameByMask: identity } },
};
export const MAP_TILE_IDS = Object.keys(MAP_TILES) as LegacyMapTileId[];
export function tileDefinition(id: MapTileId | null | undefined): MapTileDefinition | undefined { return id ? MAP_TILES[id as LegacyMapTileId] : undefined; }
export function isTileAllowed(id: MapTileId, kind: MapKind): boolean { return MAP_TILES[id as LegacyMapTileId]?.mapKinds.includes(kind) ?? false; }
export function tileWalkable(id: MapTileId | null | undefined): boolean { return Boolean(tileDefinition(id)?.walkable); }
export interface TileMapLike { terrain: readonly (MapTileId | null)[]; width: number; height: number; tileSize: number; /** Optional explicit manual collision layer. */ collision?: readonly boolean[]; }
export function isMapPositionWalkable(map: TileMapLike, position: { x: number; y: number }, radius = 0): boolean {
  const left = Math.floor((position.x - radius) / map.tileSize);
  const right = Math.floor((position.x + radius) / map.tileSize);
  const top = Math.floor((position.y - radius) / map.tileSize);
  const bottom = Math.floor((position.y + radius) / map.tileSize);
  for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height || (map.collision ? map.collision[y * map.width + x] !== true : !tileWalkable(map.terrain[y * map.width + x]))) return false;
  }
  return true;
}
export function moveMapPosition(map: TileMapLike, position: { x: number; y: number }, delta: { x: number; y: number }, radius = 0): { x: number; y: number } {
  const diagonal = { x: position.x + delta.x, y: position.y + delta.y };
  if (isMapPositionWalkable(map, diagonal, radius)) return diagonal;
  const horizontal = { x: diagonal.x, y: position.y };
  if (delta.x !== 0 && isMapPositionWalkable(map, horizontal, radius)) return horizontal;
  const vertical = { x: position.x, y: diagonal.y };
  if (delta.y !== 0 && isMapPositionWalkable(map, vertical, radius)) return vertical;
  return position;
}
export function moveOnHomeMap(position: {x:number;y:number}, delta: {x:number;y:number}, map?: TileMapLike): {x:number;y:number} {
  const fallback: TileMapLike = { width: 32, height: 20, tileSize: 16, terrain: Array(32 * 20).fill(null).map((_, i) => (i % 32 === 0 || i % 32 === 31 || i < 32 || i >= 608) ? "home.wall" : "home.floor") };
  return moveMapPosition(map ?? fallback, position, delta, 5);
}
export function cardinalMask(terrain: readonly (MapTileId | null)[], width: number, height: number, x: number, y: number): number {
  const id = terrain[y * width + x]; const visual = tileDefinition(id)?.visual;
  if (!visual || visual.kind !== "cardinal") return 0;
  const connected = (nx: number, ny: number) => nx >= 0 && ny >= 0 && nx < width && ny < height && tileDefinition(terrain[ny * width + nx])?.visual.kind === "cardinal" && (tileDefinition(terrain[ny * width + nx])?.visual as CardinalVisual).connectGroup === visual.connectGroup;
  return (connected(x, y - 1) ? 1 : 0) | (connected(x + 1, y) ? 2 : 0) | (connected(x, y + 1) ? 4 : 0) | (connected(x - 1, y) ? 8 : 0);
}
/** Legacy helper kept for old callers/tests. Manual map rendering must use the
 * saved `tileFrames`/layer frame and must not call this neighbour resolver. */
export function resolveTileFrame(terrain: readonly (MapTileId | null)[], width: number, height: number, x: number, y: number): number {
  const id = terrain[y * width + x]; const visual = tileDefinition(id)?.visual;
  return visual?.kind === "cardinal" ? visual.frameByMask[cardinalMask(terrain, width, height, x, y)] : 0;
}
export function compileTerrain(terrain: readonly (MapTileId | null)[], width: number, height: number, kind: MapKind): DungeonMap {
  if (terrain.length !== width * height) throw new Error("terrain size mismatch");
  for (const id of terrain) if (id && !isTileAllowed(id, kind)) throw new Error(`tile ${id} is not valid for ${kind}`);
  const tiles = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => tileWalkable(terrain[y * width + x]) ? 0 : 1));
  return { width, height, tileSize: 16, tiles, stairsUp: {x: 1,y: 1}, stairsDown: {x: 1,y: 1} };
}
