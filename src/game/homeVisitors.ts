import { isMapPositionWalkable, type TileMapLike } from "./mapTiles";
import type { Vec } from "./types";

export interface HomeVisitorAssignment {
  visitorId: string;
  pos: Vec;
}

const positionKey = (position: Vec): string => `${position.x},${position.y}`;

/** Assigns only visitors for which a distinct, unreserved walkable cell exists. */
export function assignHomeVisitorCells(
  map: TileMapLike,
  visitorIds: readonly string[],
  occupied: readonly Vec[],
): HomeVisitorAssignment[] {
  const reserved = new Set(occupied.map(positionKey));
  const candidates: Vec[] = [];
  const radius = Math.max(2, map.tileSize / 4);
  for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) {
    const pos = { x, y };
    const center = { x: x * map.tileSize + map.tileSize / 2, y: y * map.tileSize + map.tileSize / 2 };
    if (!reserved.has(positionKey(pos)) && isMapPositionWalkable(map, center, radius)) candidates.push(pos);
  }

  return visitorIds.slice(0, candidates.length).map((visitorId, index) => ({
    visitorId,
    pos: candidates[index]!,
  }));
}
