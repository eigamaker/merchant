import { isMapPositionWalkable, type TileMapLike } from "./mapTiles";
import type { Vec } from "./types";

export interface HomeVisitorAssignment {
  visitorId: string;
  pos: Vec;
}

const positionKey = (position: Vec): string => `${position.x},${position.y}`;

function isWalkableCell(map: TileMapLike, position: Vec): boolean {
  if (position.x < 0 || position.y < 0 || position.x >= map.width || position.y >= map.height) return false;
  const center = {
    x: position.x * map.tileSize + map.tileSize / 2,
    y: position.y * map.tileSize + map.tileSize / 2,
  };
  return isMapPositionWalkable(map, center, Math.max(2, map.tileSize / 4));
}

/** Finds an orthogonal route so visitors never cut diagonally through the shop. */
export function findHomeVisitorPath(map: TileMapLike, start: Vec, goal: Vec): Vec[] {
  if (!isWalkableCell(map, start) || !isWalkableCell(map, goal)) return [];
  const startKey = positionKey(start);
  const goalKey = positionKey(goal);
  const queue: Vec[] = [{ ...start }];
  const previous = new Map<string, Vec | undefined>([[startKey, undefined]]);
  const directions = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    if (positionKey(current) === goalKey) break;
    for (const direction of directions) {
      const next = { x: current.x + direction.x, y: current.y + direction.y };
      const key = positionKey(next);
      if (previous.has(key) || !isWalkableCell(map, next)) continue;
      previous.set(key, current);
      queue.push(next);
    }
  }

  if (!previous.has(goalKey)) return [];
  const path: Vec[] = [];
  let current: Vec | undefined = { ...goal };
  while (current) {
    path.push(current);
    current = previous.get(positionKey(current));
  }
  return path.reverse();
}

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
