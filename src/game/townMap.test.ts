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
  TOWN_WIDTH,
  townSurfaceAt,
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
  it("uses multi-cell buildings and gives every facility a reachable entrance", () => {
    expect(TOWN_BUILDINGS.every((building) => building.width >= 4 && building.height >= 3)).toBe(true);
    const reached = reachableTiles();
    for (const poi of TOWN_POINTS) {
      expect(isTownTileBlocked(poi.pos.x, poi.pos.y)).toBe(false);
      expect(reached.has(`${poi.pos.x},${poi.pos.y}`)).toBe(true);
    }
  });

  it("blocks continuous movement through a building while retaining a safe fallback", () => {
    const shop = TOWN_BUILDINGS.find((building) => building.id === "shop");
    if (!shop) throw new Error("shop fixture missing");
    const besideShop = { x: shop.x * TOWN_TILE - 12, y: (shop.y + 1) * TOWN_TILE + 12 };
    const intoShop = moveTownPosition(besideShop, { x: 40, y: 0 });
    expect(intoShop).toEqual(besideShop);
    expect(safeTownPosition({ x: -20, y: -20 })).toEqual(TOWN_SPAWN);
  });

  it("exposes the generated field and entrance-rock surfaces to the renderer", () => {
    expect(townSurfaceAt(3, 14)).toBe("field");
    expect(townSurfaceAt(20, 1)).toBe("rock");
    expect(townSurfaceAt(8, 29)).toBe("road");
  });
});
