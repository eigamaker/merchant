import { describe, expect, it } from "vitest";
import {
  BUILDING_KIT_ORIGINS,
  BUILDING_KIT_SLOTS,
  CARDINAL_MASK_BITS,
  DUNGEON_WALL_BANK_ROWS,
  DUNGEON_WALL_FRAMES,
  TOWN_TERRAIN_BANK_ROWS,
  WIDE_BUILDING_KIT_ORIGINS,
  buildingKitFrame,
  dungeonTerrainBankForFloor,
  dungeonWallFrame,
  terrainBankFrame,
  wideBuildingKitFrame,
} from "./assetFrames";

describe("environment sprite-sheet contract", () => {
  it("uses one 16-frame row per terrain bank with the fixed N/E/S/W mask", () => {
    expect(CARDINAL_MASK_BITS).toEqual({ north: 1, east: 2, south: 4, west: 8 });
    expect(terrainBankFrame(TOWN_TERRAIN_BANK_ROWS.grass, 0)).toEqual({ x: 0, y: 0, frame: 0 });
    expect(terrainBankFrame(TOWN_TERRAIN_BANK_ROWS.road, 15)).toEqual({ x: 15, y: 1, frame: 31 });
    expect(terrainBankFrame(TOWN_TERRAIN_BANK_ROWS.dock, 7)).toEqual({ x: 7, y: 4, frame: 71 });
  });

  it("assigns all 15 corrected dungeon wall slots to unique cells in the active 12x4 region", () => {
    const frames = Object.values(DUNGEON_WALL_FRAMES);
    expect(frames).toHaveLength(15);
    expect(new Set(frames.map((entry) => entry.frame)).size).toBe(15);
    expect(frames.every((entry) => entry.x >= 0 && entry.x < 12 && entry.y >= 0 && entry.y < 4)).toBe(true);
    expect(DUNGEON_WALL_FRAMES.innerNorthWest).toEqual({ x: 0, y: 1, frame: 12 });
    expect(DUNGEON_WALL_FRAMES.cracked).toEqual({ x: 2, y: 1, frame: 14 });
  });

  it("maps dungeon floors and wall materials to their generated banks", () => {
    expect(dungeonTerrainBankForFloor(1)).toBe(0);
    expect(dungeonTerrainBankForFloor(8)).toBe(7);
    expect(dungeonWallFrame("normal", "center")).toEqual({ x: 0, y: 0, frame: 0 });
    expect(dungeonWallFrame("tomb", "cracked")).toEqual({ x: 2, y: 5, frame: 62 });
    expect(DUNGEON_WALL_BANK_ROWS).toEqual({ normal: 0, tomb: 4 });
  });

  it("gives every building kit the same complete and non-overlapping 4x3 slot layout", () => {
    const slots = Object.keys(BUILDING_KIT_SLOTS) as Array<keyof typeof BUILDING_KIT_SLOTS>;
    const usedFrames = new Set<number>();
    for (const kit of Object.keys(BUILDING_KIT_ORIGINS) as Array<keyof typeof BUILDING_KIT_ORIGINS>) {
      const frames = slots.map((slot) => buildingKitFrame(kit, slot));
      expect(frames).toHaveLength(12);
      expect(new Set(frames.map((entry) => entry.frame)).size).toBe(12);
      expect(frames.every((entry) => entry.x >= 0 && entry.x < 16 && entry.y >= 0 && entry.y < 12)).toBe(true);
      for (const entry of frames) {
        expect(usedFrames.has(entry.frame)).toBe(false);
        usedFrames.add(entry.frame);
      }
    }
  });

  it("keeps every wide-building pair in a dedicated contiguous 8x3 region", () => {
    const slots = Object.keys(BUILDING_KIT_SLOTS) as Array<keyof typeof BUILDING_KIT_SLOTS>;
    const usedFrames = new Set<number>();
    for (const kit of Object.keys(WIDE_BUILDING_KIT_ORIGINS) as Array<keyof typeof WIDE_BUILDING_KIT_ORIGINS>) {
      const frames = (["left", "right"] as const).flatMap((side) => slots.map((slot) => wideBuildingKitFrame(kit, side, slot)));
      expect(frames).toHaveLength(24);
      expect(new Set(frames.map((entry) => entry.frame)).size).toBe(24);
      expect(frames.every((entry) => entry.x >= 0 && entry.x < 16 && entry.y >= 0 && entry.y < 12)).toBe(true);
      for (const entry of frames) {
        expect(usedFrames.has(entry.frame)).toBe(false);
        usedFrames.add(entry.frame);
      }
    }
  });
});
