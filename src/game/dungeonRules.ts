import type { CanonicalEdge, DungeonHeight, DungeonMap, TraversalLink, Vec } from "./types";

export const DUNGEON_FLOOR = 0;

export function samePosition(a: Vec, b: Vec): boolean {
  return a.x === b.x && a.y === b.y;
}

export function inDungeonBounds(map: DungeonMap, pos: Vec): boolean {
  return pos.x >= 0 && pos.y >= 0 && pos.x < map.width && pos.y < map.height;
}

/** Cell occupancy only. Use canTraverse for a move between two cells. */
export function isWalkableCell(map: DungeonMap, pos: Vec): boolean {
  return inDungeonBounds(map, pos) && map.tiles[pos.y]?.[pos.x] === DUNGEON_FLOOR;
}

export function heightAt(map: DungeonMap, pos: Vec): DungeonHeight {
  return map.heights?.[pos.y]?.[pos.x] ?? 0;
}

export function canonicalEdge(from: Vec, to: Vec): CanonicalEdge | undefined {
  if (from.y === to.y && Math.abs(from.x - to.x) === 1) {
    return { x: Math.min(from.x, to.x), y: from.y, direction: "east" };
  }
  if (from.x === to.x && Math.abs(from.y - to.y) === 1) {
    return { x: from.x, y: Math.min(from.y, to.y), direction: "south" };
  }
  return undefined;
}

export function canonicalEdgeKey(edge: CanonicalEdge): string {
  return `${edge.x},${edge.y},${edge.direction}`;
}

function hasEdge(edges: CanonicalEdge[] | undefined, from: Vec, to: Vec): boolean {
  const edge = canonicalEdge(from, to);
  if (!edge) return false;
  const key = canonicalEdgeKey(edge);
  return (edges ?? []).some((candidate) => canonicalEdgeKey(candidate) === key);
}

function linkAllows(link: TraversalLink, from: Vec, to: Vec): boolean {
  if (samePosition(link.from, from) && samePosition(link.to, to)) return true;
  return link.bidirectional && samePosition(link.to, from) && samePosition(link.from, to);
}

/**
 * The only rule for crossing a cell border.  A missing semantic field means a
 * legacy, flat map, so old saves stay playable without regeneration.
 */
export function canTraverse(map: DungeonMap, from: Vec, to: Vec): boolean {
  const edge = canonicalEdge(from, to);
  if (!edge || !isWalkableCell(map, from) || !isWalkableCell(map, to)) return false;
  if (hasEdge(map.hardEdges, from, to)) return false;

  const fromHeight = heightAt(map, from);
  const toHeight = heightAt(map, to);
  const link = (map.traversalLinks ?? []).find((candidate) => linkAllows(candidate, from, to));

  if (fromHeight === toHeight) return !hasEdge(map.ledgeEdges, from, to) || Boolean(link);
  if (Math.abs(fromHeight - toHeight) !== 1) return false;
  return Boolean(link);
}

export function reachableCells(map: DungeonMap, start: Vec): Set<string> {
  const reached = new Set<string>();
  if (!isWalkableCell(map, start)) return reached;
  const queue = [{ ...start }];
  reached.add(`${start.x},${start.y}`);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const direction of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
      const next = { x: current.x + direction.x, y: current.y + direction.y };
      const key = `${next.x},${next.y}`;
      if (!reached.has(key) && canTraverse(map, current, next)) {
        reached.add(key);
        queue.push(next);
      }
    }
  }
  return reached;
}
