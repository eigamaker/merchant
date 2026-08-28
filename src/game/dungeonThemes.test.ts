import { describe, expect, it } from "vitest";
import { generateDungeonFloor } from "./dungeonGenerator";
import { createDungeonRenderPlan, dungeonTheme, dungeonThemeIdForFloor } from "./dungeonThemes";

describe("dungeon theme schedule", () => {
  it("keeps three-floor zones and uses every theme once per nine-floor cycle", () => {
    const pool = ["cave", "ruins", "lava"];
    for (let seed = 1; seed <= 40; seed += 1) {
      const floors = Array.from({ length: 18 }, (_, index) => dungeonThemeIdForFloor(seed, index + 1, pool));
      for (let start = 0; start < floors.length; start += 3) expect(new Set(floors.slice(start, start + 3)).size).toBe(1);
      expect(new Set([floors[0], floors[3], floors[6]])).toEqual(new Set(pool));
      expect(new Set([floors[9], floors[12], floors[15]])).toEqual(new Set(pool));
    }
  });

  it("uses a valid explicit theme override", () => {
    expect(dungeonThemeIdForFloor(9, 8, ["cave", "ruins", "lava"], "lava")).toBe("lava");
    expect(dungeonThemeIdForFloor(9, 8, ["cave"], "missing")).toBe("cave");
  });
});

describe("dungeon render plan", () => {
  it("is deterministic and changes physical references without changing logical terrain", () => {
    const cave = generateDungeonFloor(8128, 4, "cave").map;
    const ruins = generateDungeonFloor(8128, 4, "ruins").map;
    expect(ruins.tiles).toEqual(cave.tiles);
    expect(ruins.stairsUp).toEqual(cave.stairsUp);
    expect(ruins.stairsDown).toEqual(cave.stairsDown);
    const first = createDungeonRenderPlan(cave, 8128, 4);
    expect(createDungeonRenderPlan(cave, 8128, 4)).toEqual(first);
    const alternate = createDungeonRenderPlan(ruins, 8128, 4);
    expect(alternate.ground).not.toEqual(first.ground);
    expect(alternate.structure).not.toEqual(first.structure);
  });

  it("ships complete contracts for all three built-in themes", () => {
    for (const id of ["cave", "ruins", "lava"]) {
      const theme = dungeonTheme(id);
      expect(theme.floorVariants.length).toBeGreaterThanOrEqual(3);
      expect(theme.wallFrameByMask).toHaveLength(16);
      expect(theme.decorations.length).toBeGreaterThanOrEqual(6);
      expect(theme.enemyPools.shallow.length).toBeGreaterThan(0);
      expect(theme.enemyPools.middle.length).toBeGreaterThan(0);
      expect(theme.enemyPools.deep.length).toBeGreaterThan(0);
    }
  });
});
