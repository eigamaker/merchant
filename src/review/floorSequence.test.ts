import { describe, expect, it } from "vitest";
import { applyDungeonFloorUpdates, planDungeonFloorCompaction, smallestMissingDungeonFloor, type DungeonFloorLike } from "./floorSequence";

const dungeon = (id: string, floor: number): DungeonFloorLike => ({ id, kind: "dungeon", floor });

describe("dungeon floor sequence helpers", () => {
  it("compacts F1,F2,F3 to a contiguous pair after deleting F2", () => {
    const maps = [dungeon("f1", 1), dungeon("f3", 3)];
    const updates = planDungeonFloorCompaction(maps);
    expect(updates).toEqual([{ id: "f3", previousFloor: 3, floor: 2 }]);
    applyDungeonFloorUpdates(maps, updates);
    expect(maps.map((map) => map.floor)).toEqual([1, 2]);
  });

  it("fills the lowest missing floor for new and duplicated maps", () => {
    expect(smallestMissingDungeonFloor([dungeon("f1", 1), dungeon("f3", 3)])).toBe(2);
    expect(smallestMissingDungeonFloor([dungeon("f1", 1), dungeon("f2", 2), dungeon("f3", 3)])).toBe(4);
  });

  it("rejects duplicate floors instead of creating another ambiguous connection", () => {
    const duplicate = [dungeon("a", 1), dungeon("b", 1)];
    expect(() => smallestMissingDungeonFloor(duplicate)).toThrow(/重複/);
    expect(() => planDungeonFloorCompaction(duplicate)).toThrow(/重複/);
  });
});
