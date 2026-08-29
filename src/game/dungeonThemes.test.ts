import { describe, expect, it } from "vitest";
import { BLOB47_FRAME_BY_MASK, E, N, NE, NW, S, SE, SW, W } from "./autotile";
import { generateDungeonFloor } from "./dungeonGenerator";
import { createDungeonRenderPlan, dungeonTheme, dungeonThemeIdForFloor, dungeonWallAutotile, dungeonWallFaceHalves, dungeonWallFrame, dungeonWallNeighbourMask, type DungeonThemeDefinition } from "./dungeonThemes";
import type { DungeonMap } from "./types";

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
      expect(theme.wall ?? theme.wallFrameByMask).toBeDefined();
      if (!theme.wall) expect(theme.wallFrameByMask).toHaveLength(16);
      expect(theme.decorations.length).toBeGreaterThanOrEqual(6);
      expect(theme.spawns?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

/** A three-wide wall band with open floor above and below. */
function wallStrip(): DungeonMap {
  const width = 5, height = 3;
  const tiles = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => (y === 1 && x >= 1 && x <= 3 ? 1 : 0)));
  return { width, height, tileSize: 16, tiles, stairsUp: { x: 0, y: 0 } } as unknown as DungeonMap;
}

describe("dungeon walls", () => {
  const map = wallStrip();

  it("reads all eight neighbours, treating off-map cells as wall", () => {
    // Middle of the band: walls to the east and west, floor above and below.
    expect(dungeonWallNeighbourMask(map, 2, 1)).toBe(E | W);
    // Left end: the map edge counts as wall, so north-west and west are set.
    expect(dungeonWallNeighbourMask(map, 1, 1) & E).toBe(E);
    expect(dungeonWallNeighbourMask(map, 1, 1) & W).toBe(0);
    // Corner cell: five off-map neighbours plus the band's north-west corner.
    expect(dungeonWallNeighbourMask(map, 0, 0)).toBe(N | NE | SE | SW | W | NW);
  });

  it("derives the wall frame from the blob table when the theme names an autotile", () => {
    const theme = { ...dungeonTheme("cave"), wall: { assetId: "expanded-wall" } } as DungeonThemeDefinition;
    const resolve = () => ({ assetId: "expanded-wall", animationFrames: 3 });
    const frame = dungeonWallFrame(theme, map, 2, 1, 0, resolve);
    expect(frame).toEqual({ assetId: "expanded-wall", frame: BLOB47_FRAME_BY_MASK[E | W] });
    // Animation frames are whole rows of 47 tiles.
    expect(dungeonWallFrame(theme, map, 2, 1, 2, resolve).frame).toBe(2 * 47 + BLOB47_FRAME_BY_MASK[E | W]!);
  });

  it("resolves the built-in themes' walls through the catalogue", () => {
    // A cell walled in from the south shows the top, not the camera-facing face.
    const enclosed = { ...map, tiles: map.tiles.map((row, y) => row.map((value, x) => (y >= 1 && x >= 1 && x <= 3 ? 1 : value))) };
    for (const id of ["cave", "ruins", "lava"]) {
      const theme = dungeonTheme(id);
      const autotile = dungeonWallAutotile(theme);
      expect(autotile).toMatchObject({ assetId: theme.wall!.assetId });
      expect(autotile!.animationFrames).toBeGreaterThanOrEqual(1);
      expect(dungeonWallFrame(theme, enclosed, 2, 1)).toEqual({ assetId: theme.wall!.assetId, frame: BLOB47_FRAME_BY_MASK[E | W | SE | S | SW] });
    }
  });

  it("keeps using the authored sixteen frames when no autotile resolves", () => {
    const authored = Array.from({ length: 16 }, (_, mask) => ({ assetId: "legacy-wall", frame: mask }));
    const theme = { ...dungeonTheme("cave"), wall: undefined, wallFrameByMask: authored } as DungeonThemeDefinition;
    expect(dungeonWallAutotile(theme)).toBeUndefined();
    // mask 0b1010 = east | west in the cardinal encoding.
    expect(dungeonWallFrame(theme, map, 2, 1)).toEqual({ assetId: "legacy-wall", frame: 0b1010 });
  });
});

describe("two-cell wall faces", () => {
  const map = wallStrip();

  it("reads the lower half one row below the reference on the sheet", () => {
    // mapchip2-mapchip-base-s17 is eight tiles wide.
    const wall = { assetId: "w", face: { assetId: "mapchip2-mapchip-base-s17", frame: 56 }, faceHeight: 2 } as const;
    expect(dungeonWallFaceHalves(wall)).toEqual({
      upper: { assetId: "mapchip2-mapchip-base-s17", frame: 56 },
      lower: { assetId: "mapchip2-mapchip-base-s17", frame: 64 },
    });
    // A one-cell face occupies its own cell only.
    expect(dungeonWallFaceHalves({ assetId: "w", face: { assetId: "mapchip2-mapchip-base-s17", frame: 56 } }))
      .toEqual({ upper: { assetId: "mapchip2-mapchip-base-s17", frame: 56 }, lower: { assetId: "mapchip2-mapchip-base-s17", frame: 56 } });
    expect(dungeonWallFaceHalves(undefined)).toBeUndefined();
  });

  it("puts the face on wall cells that front onto floor, and the top elsewhere", () => {
    const theme = dungeonTheme("cave");
    const face = dungeonWallFaceHalves(theme.wall)!;
    // (2,1) is wall with floor to the south, so it shows the face's lower half.
    expect(dungeonWallFrame(theme, map, 2, 1)).toEqual(face.lower);
    // (0,0) is an edge cell whose south neighbour is also floor in this fixture,
    // so compare against a cell enclosed from the south instead.
    const enclosed = { ...map, tiles: map.tiles.map((row, y) => row.map((value, x) => (y >= 1 && x >= 1 && x <= 3 ? 1 : value))) };
    expect(dungeonWallFrame(theme, enclosed, 2, 1).assetId).toBe(theme.wall!.assetId);
  });

  it("carries the upper half in the overhang layer, one cell above its wall", () => {
    const floor = generateDungeonFloor(20260829, 3, "cave");
    const plan = createDungeonRenderPlan(floor.map, 20260829, 3, dungeonTheme("cave"));
    const face = dungeonWallFaceHalves(dungeonTheme("cave").wall)!;
    const cells = plan.overhang.map((ref, index) => ({ ref, index })).filter((entry) => entry.ref);
    expect(cells.length).toBeGreaterThan(0);
    for (const { ref, index } of cells) {
      expect(ref).toEqual(face.upper);
      // Every overhang belongs to a wall cell that fronts onto floor.
      const x = index % floor.map.width;
      const y = Math.floor(index / floor.map.width);
      expect(floor.map.tiles[y]![x]).not.toBe(0);
      expect(floor.map.tiles[y + 1]?.[x]).toBe(0);
      expect(y).toBeGreaterThan(0);
    }
  });

  it("leaves the overhang empty for a theme with a flat wall", () => {
    const theme = { ...dungeonTheme("cave"), wall: { assetId: dungeonTheme("cave").wall!.assetId } } as DungeonThemeDefinition;
    const floor = generateDungeonFloor(20260829, 3, "cave");
    const plan = createDungeonRenderPlan(floor.map, 20260829, 3, theme);
    expect(plan.overhang.every((ref) => ref === null)).toBe(true);
  });
});
