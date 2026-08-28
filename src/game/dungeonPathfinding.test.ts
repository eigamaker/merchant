import { describe, expect, it } from "vitest";
import { nextDungeonStep } from "./dungeonPathfinding";
import type { DungeonMap } from "./types";

function map(rows: string[]): DungeonMap {
  return { width: rows[0]!.length, height: rows.length, tiles: rows.map((row) => [...row].map((cell) => cell === "." ? 0 : 1)), stairsUp: { x: 1, y: 1 } };
}

describe("dungeon BFS movement", () => {
  it("walks through an L-shaped detour instead of stopping at a wall", () => {
    const dungeon = map(["#######", "#..####", "##.####", "##....#", "#######"]);
    let current = { x: 1, y: 1 };
    const target = { x: 5, y: 3 };
    for (let turn = 0; turn < 8 && (current.x !== target.x || current.y !== target.y); turn += 1) current = nextDungeonStep(dungeon, current, target);
    expect(current).toEqual(target);
  });

  it("routes around occupied cells when another route exists", () => {
    const dungeon = map(["#######", "#.....#", "#.....#", "#######"]);
    expect(nextDungeonStep(dungeon, { x: 1, y: 1 }, { x: 5, y: 1 }, [{ x: 2, y: 1 }])).toEqual({ x: 1, y: 2 });
  });
});
