import { describe, expect, it } from "vitest";
import { BLOB47_FRAME_BY_MASK, E, N, NE, NW, S, SE, SW, W } from "./autotile";
import { generateDungeonFloor } from "./dungeonGenerator";
import { DUNGEON_THEME_OBJECT_KINDS, createDungeonRenderPlan, dungeonPieceHalves, dungeonTheme, dungeonThemeAssetIds, dungeonThemeIdForFloor, dungeonThemeObject, dungeonWallAutotile, dungeonWallFaceHalves, dungeonWallFrame, dungeonWallNeighbourMask, type DungeonThemeDefinition } from "./dungeonThemes";
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
    // Two themes are free to name the same sheets, so repaint one here: what
    // this pins down is that the plan follows the theme, not that the shipped
    // themes currently disagree with each other.
    const repainted = {
      ...dungeonTheme("cave"),
      floorVariants: [{ assetId: "legacy-floor", frame: 0, weight: 1 }],
      wall: undefined,
      wallFrameByMask: Array.from({ length: 16 }, (_, mask) => ({ assetId: "legacy-wall", frame: mask })),
    } as DungeonThemeDefinition;
    const alternate = createDungeonRenderPlan(cave, 8128, 4, repainted);
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

/** A theme wearing a two-cell face, whatever the shipped themes carry today. */
function facedTheme(): DungeonThemeDefinition {
  const cave = dungeonTheme("cave");
  return { ...cave, wall: { assetId: cave.wall!.assetId, face: { assetId: "mapchip2-mapchip-base-s17", frame: 56 }, faceHeight: 2 } } as DungeonThemeDefinition;
}

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
    const theme = facedTheme();
    const face = dungeonWallFaceHalves(theme.wall)!;
    // (2,1) is wall with floor to the south, so it shows the face's lower half.
    expect(dungeonWallFrame(theme, map, 2, 1)).toEqual(face.lower);
    // (0,0) is an edge cell whose south neighbour is also floor in this fixture,
    // so compare against a cell enclosed from the south instead.
    const enclosed = { ...map, tiles: map.tiles.map((row, y) => row.map((value, x) => (y >= 1 && x >= 1 && x <= 3 ? 1 : value))) };
    expect(dungeonWallFrame(theme, enclosed, 2, 1).assetId).toBe(theme.wall!.assetId);
  });

  it("carries the upper half in the overhang layer, one cell above its wall", () => {
    const theme = facedTheme();
    const floor = generateDungeonFloor(20260829, 3, "cave");
    const plan = createDungeonRenderPlan(floor.map, 20260829, 3, theme);
    const face = dungeonWallFaceHalves(theme.wall)!;
    // The up-stairs uses the same layer, so it is not one of the wall cells.
    const stairs = floor.map.stairsUp.y * floor.map.width + floor.map.stairsUp.x;
    const cells = plan.overhang.map((ref, index) => ({ ref, index })).filter((entry) => entry.ref && entry.index !== stairs);
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

  it("leaves the overhang to the stairs when a theme's wall is flat", () => {
    const theme = { ...dungeonTheme("cave"), wall: { assetId: dungeonTheme("cave").wall!.assetId } } as DungeonThemeDefinition;
    const floor = generateDungeonFloor(20260829, 3, "cave");
    const plan = createDungeonRenderPlan(floor.map, 20260829, 3, theme);
    const carried = plan.overhang.map((ref, index) => ({ ref, index })).filter((entry) => entry.ref);
    expect(carried.map((entry) => entry.index)).toEqual([floor.map.stairsUp.y * floor.map.width + floor.map.stairsUp.x]);
  });
});

describe("two-cell stairs", () => {
  it("takes the upper half from the row above the reference, and only when asked", () => {
    // mapchip2-mapchip-base-s08 is eight tiles wide, so frame 14 sits below 6.
    const stair = { assetId: "mapchip2-mapchip-base-s08", frame: 14 } as const;
    expect(dungeonPieceHalves({ ...stair, height: 2 })).toEqual({
      lower: { ...stair },
      upper: { assetId: "mapchip2-mapchip-base-s08", frame: 6 },
    });
    expect(dungeonPieceHalves(stair)).toEqual({ lower: { ...stair } });
    expect(dungeonPieceHalves({ ...stair, height: 1 })).toEqual({ lower: { ...stair } });
    // The top row of a sheet has nothing above it to borrow.
    expect(dungeonPieceHalves({ assetId: "mapchip2-mapchip-base-s08", frame: 6, height: 2 })).toEqual({ lower: { assetId: "mapchip2-mapchip-base-s08", frame: 6 } });
    // An unknown asset has no known width, so it cannot be split.
    expect(dungeonPieceHalves({ assetId: "missing-sheet", frame: 14, height: 2 })).toEqual({ lower: { assetId: "missing-sheet", frame: 14 } });
  });

  it("stands the up-stairs in its cell and reaches one cell further up", () => {
    const floor = generateDungeonFloor(20260829, 3, "cave");
    const theme = dungeonTheme("cave");
    const plan = createDungeonRenderPlan(floor.map, 20260829, 3, theme);
    const index = floor.map.stairsUp.y * floor.map.width + floor.map.stairsUp.x;
    const halves = dungeonPieceHalves(theme.stairsUp);
    expect(halves.upper).toBeDefined();
    expect(plan.decoration[index]).toEqual(halves.lower);
    expect(plan.overhang[index]).toEqual(halves.upper);
    expect(floor.map.stairsUp.y).toBeGreaterThan(0);
  });

  it("keeps the down-stairs inside its own cell", () => {
    const floor = generateDungeonFloor(20260829, 3, "cave");
    const theme = dungeonTheme("cave");
    const plan = createDungeonRenderPlan(floor.map, 20260829, 3, theme);
    const index = floor.map.stairsDown!.y * floor.map.width + floor.map.stairsDown!.x;
    expect(plan.decoration[index]).toEqual({ assetId: theme.stairsDown.assetId, frame: theme.stairsDown.frame });
    expect(plan.overhang[index]).toBeNull();
  });

  it("carries the detected heights for every built-in theme", () => {
    for (const id of ["cave", "ruins", "lava"]) {
      const theme = dungeonTheme(id);
      // The build reads these from the sheet's alpha: the ladder is two cells
      // tall and the hole it leads down to is one.
      expect(theme.stairsUp.height).toBe(2);
      expect(theme.stairsDown.height).toBeUndefined();
    }
  });
});

describe("themed game objects", () => {
  it("gives every built-in theme its own chest and body tiles", () => {
    for (const id of ["cave", "ruins", "lava"]) {
      const theme = dungeonTheme(id);
      for (const kind of DUNGEON_THEME_OBJECT_KINDS) {
        const ref = dungeonThemeObject(theme, kind);
        expect(ref).toBeDefined();
        expect(ref!.assetId).toBeTruthy();
        expect(ref!.frame).toBeGreaterThanOrEqual(0);
      }
    }
    // Each theme picks its own body so it reads against that floor.
    const corpses = ["cave", "ruins", "lava"].map((id) => dungeonThemeObject(dungeonTheme(id), "corpse")!.frame);
    expect(new Set(corpses).size).toBe(corpses.length);
  });

  it("returns nothing for a theme that names no object, so the caller can fall back", () => {
    const bare = { ...dungeonTheme("cave"), objects: undefined } as DungeonThemeDefinition;
    expect(dungeonThemeObject(bare, "chest")).toBeUndefined();
    expect(dungeonThemeObject({ ...bare, objects: { chest: { assetId: "s", frame: 3 } } } as DungeonThemeDefinition, "corpse")).toBeUndefined();
  });

  it("hands back a copy, so a caller cannot edit the catalogue in place", () => {
    const ref = dungeonThemeObject(dungeonTheme("cave"), "chest")!;
    ref.frame = 999;
    expect(dungeonThemeObject(dungeonTheme("cave"), "chest")!.frame).not.toBe(999);
  });

  it("loads the object sheets with the rest of a theme's art", () => {
    const ids = dungeonThemeAssetIds(["cave"]);
    expect(ids.has(dungeonThemeObject(dungeonTheme("cave"), "corpse")!.assetId)).toBe(true);
    expect(ids.has(dungeonThemeObject(dungeonTheme("cave"), "chest")!.assetId)).toBe(true);
  });
});

describe("wall-mounted decorations", () => {
  it("keeps a wallFace prop on the side the camera sees, unlike plain wall", () => {
    const base = dungeonTheme("cave");
    const survey = (placement: "wall" | "wallFace") => {
      const theme = {
        ...base,
        decorations: base.decorations.map((rule) => (rule.placement === "wall" ? { ...rule, placement, enabled: true } : rule)),
      } as DungeonThemeDefinition;
      let total = 0, facing = 0;
      for (let seed = 1; seed <= 30; seed += 1) {
        const map = generateDungeonFloor(seed, 3, "cave").map;
        const plan = createDungeonRenderPlan(map, seed, 3, theme);
        for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) {
          const index = y * map.width + x;
          if (!plan.decoration[index] || map.tiles[y]![x] === 0) continue;
          total += 1;
          if (map.tiles[y + 1]?.[x] === 0) facing += 1;
        }
      }
      return { total, facing };
    };
    const face = survey("wallFace");
    expect(face.total).toBeGreaterThan(0);
    // Everything a wallFace rule places is on a wall the player can see, which is
    // what a torch or a lever needs. Plain wall also uses the hidden far side.
    expect(face.facing).toBe(face.total);
    expect(survey("wall").facing).toBeLessThan(survey("wall").total);
  });
});

describe("switched-off decorations", () => {
  const floors = () => Array.from({ length: 12 }, (_, index) => generateDungeonFloor(index + 1, 3, "cave").map);
  const placedIds = (theme: DungeonThemeDefinition) => {
    const found = new Set<string>();
    floors().forEach((map, index) => {
      const plan = createDungeonRenderPlan(map, index + 1, 3, theme);
      for (const [cell, ref] of plan.decoration.entries()) {
        if (!ref || cell === map.stairsUp.y * map.width + map.stairsUp.x) continue;
        for (const rule of theme.decorations) if (rule.variants.some((variant) => variant.assetId === ref.assetId && variant.frame === ref.frame)) found.add(rule.id);
      }
    });
    return found;
  };

  it("places nothing for a rule marked enabled: false", () => {
    const theme = dungeonTheme("cave");
    const target = theme.decorations.find((rule) => rule.placement === "floor")!;
    const base = {
      ...theme,
      decorations: theme.decorations.map((rule) => (rule.id === target.id ? { ...rule, enabled: true } : rule)),
    } as DungeonThemeDefinition;
    expect(placedIds(base).has(target.id)).toBe(true);
    const off = { ...base, decorations: base.decorations.map((rule) => (rule.id === target.id ? { ...rule, enabled: false } : rule)) } as DungeonThemeDefinition;
    expect(placedIds(off).has(target.id)).toBe(false);
  });

  it("leaves every other rule exactly where it was", () => {
    const theme = dungeonTheme("cave");
    const target = theme.decorations.find((rule) => rule.placement === "floor")!;
    const base = {
      ...theme,
      decorations: theme.decorations.map((rule) => (rule.id === target.id ? { ...rule, enabled: true } : rule)),
    } as DungeonThemeDefinition;
    const off = { ...base, decorations: base.decorations.map((rule) => (rule.id === target.id ? { ...rule, enabled: false } : rule)) } as DungeonThemeDefinition;
    const targetFrames = new Set(target.variants.map((variant) => `${variant.assetId}#${variant.frame}`));
    floors().forEach((map, index) => {
      const before = createDungeonRenderPlan(map, index + 1, 3, base).decoration;
      const after = createDungeonRenderPlan(map, index + 1, 3, off).decoration;
      for (const [cell, ref] of before.entries()) {
        // Only the switched-off rule's own cells change; a rule's index salts its
        // placement hash, so the rest must not shift.
        if (ref && targetFrames.has(`${ref.assetId}#${ref.frame}`)) continue;
        expect(after[cell]).toEqual(ref);
      }
    });
  });

  it("keeps the ambient bones off, so a skeleton always means a body to search", () => {
    for (const id of ["cave", "lava"]) {
      const theme = dungeonTheme(id);
      const bones = theme.decorations.find((rule) => rule.id === `${id}-bones`);
      expect(bones?.enabled).toBe(false);
    }
  });
});
