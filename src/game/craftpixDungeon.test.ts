import { describe, expect, it } from "vitest";
import {
  CRAFTPIX_DUNGEON_ENTRY,
  CRAFTPIX_DUNGEON_HEIGHT,
  CRAFTPIX_DUNGEON_STAIRS,
  CRAFTPIX_DUNGEON_TILE,
  CRAFTPIX_DUNGEON_WIDTH,
  createCraftpixDungeonMap,
} from "./craftpixDungeon";

function reachableTiles(map: ReturnType<typeof createCraftpixDungeonMap>): Set<string> {
  const start = map.entrance;
  const reached = new Set([`${start.x},${start.y}`]);
  const queue = [start];
  while (queue.length > 0) {
    const position = queue.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = position.x + dx;
      const y = position.y + dy;
      const key = `${x},${y}`;
      if (x < 0 || x >= map.width || y < 0 || y >= map.height || map.tiles[y]?.[x] !== 0 || reached.has(key)) continue;
      reached.add(key);
      queue.push({ x, y });
    }
  }
  return reached;
}

describe("Craftpix showcase dungeon", () => {
  it("exposes the authored 16px layout and walkable landmarks", () => {
    const map = createCraftpixDungeonMap();
    expect(map.width).toBe(38);
    expect(map.height).toBe(28);
    expect(map.tileSize).toBe(CRAFTPIX_DUNGEON_TILE);
    expect(map.tileSize).toBe(16);
    expect(map.visualTheme).toBe("craftpix-showcase");
    expect(CRAFTPIX_DUNGEON_WIDTH).toBe(map.width);
    expect(CRAFTPIX_DUNGEON_HEIGHT).toBe(map.height);
    expect(CRAFTPIX_DUNGEON_ENTRY).toEqual(map.entrance);
    expect(CRAFTPIX_DUNGEON_STAIRS).toEqual(map.stairs);
    expect(map.tiles[map.entrance.y]?.[map.entrance.x]).toBe(0);
    expect(map.tiles[map.stairs.y]?.[map.stairs.x]).toBe(0);
  });

  it("keeps every walkable cell connected to the entry", () => {
    const map = createCraftpixDungeonMap();
    const reached = reachableTiles(map);
    const walkable = map.tiles.flat().filter((tile) => tile === 0).length;
    expect(reached.has(`${map.stairs.x},${map.stairs.y}`)).toBe(true);
    expect(reached.size).toBe(walkable);
    expect(walkable).toBeGreaterThan(300);
  });

  it("can add the run-specific special room without changing collision", () => {
    const map = createCraftpixDungeonMap(true);
    expect(map.specialRoom).toEqual({ x: 25, y: 4 });
    expect(map.tiles).toEqual(createCraftpixDungeonMap().tiles);
  });
});
