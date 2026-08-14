import { describe, expect, it } from "vitest";
import {
  MANUAL_MAP_HEIGHT,
  MANUAL_MAP_WIDTH,
  createBlankManualMap,
  manualMapToDungeonMap,
  placeManualTile,
  validateManualMap,
} from "./manualMapModel";

function playableMap() {
  const map = createBlankManualMap("test");
  for (let y = 2; y < 7; y += 1) for (let x = 2; x < 12; x += 1) {
    placeManualTile(map, "ground", { x, y, sheet: "walls-floor", frame: 138 });
  }
  map.entrance = { x: 2, y: 2 };
  map.stairs = { x: 11, y: 6 };
  return map;
}

describe("manual dungeon map model", () => {
  it("starts as a fixed 48x36 manual blueprint", () => {
    const map = createBlankManualMap();
    expect(map.width).toBe(MANUAL_MAP_WIDTH);
    expect(map.height).toBe(MANUAL_MAP_HEIGHT);
    expect(map.collision.every((cell) => cell === 1)).toBe(true);
    expect(validateManualMap(map).some((issue) => issue.code === "entrance")).toBe(true);
  });

  it("keeps collision authoritative after it has been manually locked", () => {
    const map = createBlankManualMap();
    const index = 3 * MANUAL_MAP_WIDTH + 3;
    map.collision[index] = 0;
    map.collisionLocked[index] = true;
    placeManualTile(map, "structure", { x: 3, y: 3, sheet: "walls-floor", frame: 36 });
    expect(map.collision[index]).toBe(0);
  });

  it("compiles a connected authored map into a flat playable dungeon", () => {
    const map = playableMap();
    const issues = validateManualMap(map);
    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
    const dungeon = manualMapToDungeonMap(map);
    expect(dungeon.visualTheme).toBe("craftpix-manual");
    expect(dungeon.heights?.flat().every((height) => height === 0)).toBe(true);
    expect(dungeon.renderLayers?.ground).toHaveLength(50);
    expect(dungeon.entrance).toEqual(map.entrance);
  });

  it("supports the town and interior presets on the same document model", () => {
    const town = createBlankManualMap("town", "town");
    const interior = createBlankManualMap("interior", "interior");
    expect([town.width, town.height]).toEqual([60, 45]);
    expect([interior.width, interior.height]).toEqual([32, 24]);
    expect(manualMapToDungeonMap(interior).width).toBe(32);
  });
});
