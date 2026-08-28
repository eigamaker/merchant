import { describe, expect, it } from "vitest";
import { reachableCells } from "./dungeonRules";
import { generateDungeonFloor } from "./dungeonGenerator";

describe("room-graph dungeon generator", () => {
  it("is deterministic, reachable, and satisfies the room contract across 1,000 seeds", () => {
    let fallbackCount = 0;
    for (let seed = 1; seed <= 1000; seed += 1) {
      const floor = [1, 4, 8][seed % 3]!;
      const first = generateDungeonFloor(seed, floor, "cave");
      if (first.usedFallback) fallbackCount += 1;
      expect(first.rooms.length).toBeGreaterThanOrEqual(8);
      expect(first.rooms.length).toBeLessThanOrEqual(12);
      expect(first.map.procedural?.mainPathRoomIds.length).toBeGreaterThanOrEqual(5);
      const reached = reachableCells(first.map, first.map.stairsUp);
      expect(reached.has(`${first.map.stairsDown!.x},${first.map.stairsDown!.y}`)).toBe(true);
      for (const room of first.rooms) for (const cell of room.cells) expect(reached.has(`${cell.x},${cell.y}`)).toBe(true);
      for (const cells of Object.values(first.placementRegions)) for (const cell of cells) expect(reached.has(`${cell.x},${cell.y}`)).toBe(true);
    }
    expect(fallbackCount).toBeLessThan(100);
  }, 60_000);

  it("repeats the same floor exactly", () => {
    for (const [seed, floor] of [[1, 1], [71, 4], [404, 8], [9999, 6]]) {
      const first = generateDungeonFloor(seed!, floor!, "cave");
      const second = generateDungeonFloor(seed!, floor!, "cave");
      expect(second).toEqual(first);
    }
  });

  it("keeps layout independent from theme", () => {
    for (const seed of [1, 71, 404, 9999]) {
      const cave = generateDungeonFloor(seed, 6, "cave").map;
      const lava = generateDungeonFloor(seed, 6, "lava").map;
      expect(lava.tiles).toEqual(cave.tiles);
      expect(lava.procedural?.rooms).toEqual(cave.procedural?.rooms);
      expect(lava.enemyRoster).not.toEqual(cave.enemyRoster);
    }
  });
});
