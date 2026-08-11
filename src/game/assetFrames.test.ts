import { describe, expect, it } from "vitest";
import {
  BUILDING_KIT_ORIGINS,
  BUILDING_KIT_SLOTS,
  DUNGEON_WALL_FRAMES,
  WIDE_BUILDING_KIT_ORIGINS,
  buildingKitFrame,
  wideBuildingKitFrame,
} from "./assetFrames";

describe("environment sprite-sheet contract", () => {
  it("assigns all 15 corrected dungeon wall slots to unique cells in the active 12x4 region", () => {
    const frames = Object.values(DUNGEON_WALL_FRAMES);
    expect(frames).toHaveLength(15);
    expect(new Set(frames.map((entry) => entry.frame)).size).toBe(15);
    expect(frames.every((entry) => entry.x >= 0 && entry.x < 12 && entry.y >= 0 && entry.y < 4)).toBe(true);
    expect(DUNGEON_WALL_FRAMES.innerNorthWest).toEqual({ x: 0, y: 1, frame: 12 });
    expect(DUNGEON_WALL_FRAMES.cracked).toEqual({ x: 2, y: 1, frame: 14 });
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
