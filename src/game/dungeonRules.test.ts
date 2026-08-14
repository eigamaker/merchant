import { describe, expect, it } from "vitest";
import { canTraverse, canonicalEdge, reachableCells } from "./dungeonRules";
import type { DungeonMap } from "./types";

function map(): DungeonMap {
  return {
    width: 3,
    height: 2,
    tiles: [[0, 0, 0], [0, 0, 1]],
    heights: [[0, 0, 1], [0, 0, 0]],
    hardEdges: [],
    ledgeEdges: [],
    traversalLinks: [],
    entrance: { x: 0, y: 0 },
    stairs: { x: 1, y: 1 },
    returnStairs: { x: 0, y: 0 },
  };
}

describe("semantic dungeon movement", () => {
  it("normalizes borders and applies a hard edge from both sides", () => {
    expect(canonicalEdge({ x: 1, y: 0 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, direction: "east" });
    const dungeon = map();
    dungeon.hardEdges = [{ x: 0, y: 0, direction: "east" }];
    expect(canTraverse(dungeon, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(false);
    expect(canTraverse(dungeon, { x: 1, y: 0 }, { x: 0, y: 0 })).toBe(false);
  });

  it("requires a local stair to cross a height change", () => {
    const dungeon = map();
    expect(canTraverse(dungeon, { x: 1, y: 0 }, { x: 2, y: 0 })).toBe(false);
    dungeon.traversalLinks = [{
      id: "test-stairs",
      kind: "stairs",
      from: { x: 1, y: 0, height: 0 },
      to: { x: 2, y: 0, height: 1 },
      bidirectional: true,
      footprint: [{ x: 1, y: 0 }, { x: 2, y: 0 }],
    }];
    expect(canTraverse(dungeon, { x: 1, y: 0 }, { x: 2, y: 0 })).toBe(true);
    expect(canTraverse(dungeon, { x: 2, y: 0 }, { x: 1, y: 0 })).toBe(true);
  });

  it("keeps a same-height ledge closed unless it has a connector", () => {
    const dungeon = map();
    dungeon.ledgeEdges = [{ x: 0, y: 0, direction: "south" }];
    dungeon.tiles[1]![1] = 1;
    expect(canTraverse(dungeon, { x: 0, y: 0 }, { x: 0, y: 1 })).toBe(false);
    expect(reachableCells(dungeon, dungeon.entrance).has("0,1")).toBe(false);
  });
});
