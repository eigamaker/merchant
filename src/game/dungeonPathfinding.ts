import { canTraverse, samePosition } from "./dungeonRules";
import type { DungeonMap, Vec } from "./types";

const CARDINALS: readonly Vec[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
const key = (pos: Vec) => `${pos.x},${pos.y}`;

/** Distances toward target. Consumers can share one field for many actors chasing the same cell. */
export function createDungeonDistanceField(map: DungeonMap, target: Vec, blocked: readonly Vec[] = []): Map<string, number> {
  const blockedKeys = new Set(blocked.filter((pos) => !samePosition(pos, target)).map(key));
  const distances = new Map<string, number>();
  const queue: Vec[] = [{ ...target }];
  distances.set(key(target), 0);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    const distance = distances.get(key(current))!;
    for (const delta of CARDINALS) {
      const next = { x: current.x + delta.x, y: current.y + delta.y };
      const nextKey = key(next);
      if (distances.has(nextKey) || blockedKeys.has(nextKey) || !canTraverse(map, next, current)) continue;
      distances.set(nextKey, distance + 1);
      queue.push(next);
    }
  }
  return distances;
}

export function nextDungeonStep(map: DungeonMap, from: Vec, target: Vec, blocked: readonly Vec[] = [], tieBreaker = 0): Vec {
  const field = createDungeonDistanceField(map, target, blocked);
  const candidates = CARDINALS.map((delta, index) => ({
    pos: { x: from.x + delta.x, y: from.y + delta.y },
    order: (index + tieBreaker) % CARDINALS.length,
  })).filter(({ pos }) => canTraverse(map, from, pos) && !blocked.some((entry) => samePosition(entry, pos)))
    .map((candidate) => ({ ...candidate, distance: field.get(key(candidate.pos)) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.distance - b.distance || a.order - b.order);
  const best = candidates[0];
  return best && Number.isFinite(best.distance) ? best.pos : { ...from };
}
