import { describe, expect, it } from "vitest";
import {
  isTownTileBlocked,
  moveTownPosition,
  safeTownPosition,
  TOWN_BUILDINGS,
  TOWN_HEIGHT,
  TOWN_POINTS,
  TOWN_SPAWN,
  TOWN_TILE,
  TOWN_TILE_INDICES,
  TOWN_WIDTH,
} from "./townMap";

function reachableTiles(): Set<string> {
  const start = { x: Math.floor(TOWN_SPAWN.x / TOWN_TILE), y: Math.floor(TOWN_SPAWN.y / TOWN_TILE) };
  const queue = [start];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const currentKey = `${current.x},${current.y}`;
    if (visited.has(currentKey) || isTownTileBlocked(current.x, current.y)) continue;
    visited.add(currentKey);
    for (const direction of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
      const next = { x: current.x + direction.x, y: current.y + direction.y };
      if (next.x >= 0 && next.y >= 0 && next.x < TOWN_WIDTH && next.y < TOWN_HEIGHT) queue.push(next);
    }
  }
  return visited;
}

describe("town map", () => {
  it("gives every facility a footprint inside the illustration and a reachable entrance", () => {
    const reached = reachableTiles();
    for (const building of TOWN_BUILDINGS) {
      expect(building.x, building.id).toBeGreaterThanOrEqual(0);
      expect(building.y, building.id).toBeGreaterThanOrEqual(0);
      expect(building.x + building.width, building.id).toBeLessThanOrEqual(TOWN_WIDTH);
      expect(building.y + building.height, building.id).toBeLessThanOrEqual(TOWN_HEIGHT);
    }
    for (const poi of TOWN_POINTS) {
      expect(isTownTileBlocked(poi.pos.x, poi.pos.y), poi.id).toBe(false);
      expect(reached.has(`${poi.pos.x},${poi.pos.y}`), poi.id).toBe(true);
    }
  });

  it("keeps every entrance next to the building it opens", () => {
    for (const building of TOWN_BUILDINGS) {
      const dx = Math.max(building.x - building.entrance.x, 0, building.entrance.x - (building.x + building.width - 1));
      const dy = Math.max(building.y - building.entrance.y, 0, building.entrance.y - (building.y + building.height - 1));
      expect(Math.max(dx, dy), building.id).toBeLessThanOrEqual(1);
    }
  });

  it("allows free-roam movement through authored collision while retaining map bounds", () => {
    const shop = TOWN_BUILDINGS.find((building) => building.id === "shop");
    if (!shop) throw new Error("shop fixture missing");
    const wallY = shop.y + shop.height - 1;
    const outside = { x: (shop.x - 1) * TOWN_TILE + TOWN_TILE / 2, y: wallY * TOWN_TILE + TOWN_TILE / 2 };
    expect(isTownTileBlocked(shop.x, wallY)).toBe(true);
    expect(moveTownPosition(outside, { x: 40, y: 0 }).x).toBe(outside.x + 40);
    expect(safeTownPosition({ x: -20, y: -20 })).toEqual(TOWN_SPAWN);
  });

  it("addresses every 24px cell of the town illustration exactly once", () => {
    const frames = TOWN_TILE_INDICES.flat();
    expect(frames).toHaveLength(TOWN_WIDTH * TOWN_HEIGHT);
    expect(new Set(frames).size).toBe(TOWN_WIDTH * TOWN_HEIGHT);
    expect(Math.min(...frames)).toBe(0);
    expect(Math.max(...frames)).toBe(TOWN_WIDTH * TOWN_HEIGHT - 1);
  });
});
