import { canTraverse, isWalkableCell } from "./dungeonRules";
import type { DungeonMap, Vec } from "./types";

const DIRECTIONS: readonly Vec[] = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
];

const positionKey = (position: Vec): string => `${position.x},${position.y}`;

/** Finds the nearest unoccupied cell reachable from an inter-floor landing. */
export function findSafeCompanionArrival(map: DungeonMap, landing: Vec, occupied: readonly Vec[]): Vec | undefined {
  const occupiedKeys = new Set(occupied.map(positionKey));
  const available = (position: Vec): boolean => isWalkableCell(map, position) && !occupiedKeys.has(positionKey(position));

  if (isWalkableCell(map, landing)) {
    const queue: Vec[] = [{ ...landing }];
    const visited = new Set([positionKey(landing)]);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor]!;
      for (const direction of DIRECTIONS) {
        const candidate = { x: current.x + direction.x, y: current.y + direction.y };
        const key = positionKey(candidate);
        if (visited.has(key) || !canTraverse(map, current, candidate)) continue;
        if (available(candidate)) return candidate;
        visited.add(key);
        queue.push(candidate);
      }
    }
  }

  // Corrupt or isolated landing markers still get a deterministic safe cell if one exists.
  for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) {
    const candidate = { x, y };
    if (available(candidate)) return candidate;
  }
  return undefined;
}
