import { describe, expect, it } from "vitest";
import {
  MANUAL_MAP_HEIGHT,
  MANUAL_MAP_WIDTH,
  cloneManualMap,
  copyManualMapFragment,
  createBlankManualMap,
  ensureManualMapPadding,
  manualMapToDungeonMap,
  pasteManualMapFragment,
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

  it("grows around authored content while preserving its TMX world coordinates", () => {
    const map = createBlankManualMap("source");
    map.origin = { x: 100, y: 200 };
    placeManualTile(map, "ground", { x: 0, y: 0, sheet: "dungeon-base-walls-floor", frame: 138 });

    ensureManualMapPadding(map);

    expect(map.origin).toEqual({ x: 99, y: 199 });
    expect(map.width).toBe(MANUAL_MAP_WIDTH + 1);
    expect(map.height).toBe(MANUAL_MAP_HEIGHT + 1);
    expect(map.layers.ground[0]).toMatchObject({ x: 1, y: 1 });
  });

  it("stores town building entrances with a named link to an interior map", () => {
    const town = createBlankManualMap("town", "town");
    const interior = createBlankManualMap("inn", "interior");
    town.floor = 2;
    town.buildingLinks.push({ id: "inn", name: "月見亭", entrance: { x: 8, y: 10 }, interiorMapId: interior.id });

    const copy = cloneManualMap(town);
    expect(copy.floor).toBe(2);
    expect(copy.buildingLinks).toEqual([{ id: "inn", name: "月見亭", entrance: { x: 8, y: 10 }, interiorMapId: interior.id }]);
    copy.buildingLinks[0]!.entrance.x = 9;
    expect(town.buildingLinks[0]!.entrance.x).toBe(8);
    expect(validateManualMap(town).filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("copies a map area and pastes its layers, rules, edges, and markers into another map", () => {
    const source = createBlankManualMap("source");
    placeManualTile(source, "ground", { x: 2, y: 2, sheet: "walls-floor", frame: 138 });
    placeManualTile(source, "structure", { x: 3, y: 2, sheet: "walls-floor", frame: 36 });
    source.collision[2 * source.width + 2] = 0;
    source.collisionLocked[2 * source.width + 2] = true;
    source.hardEdges = ["2,2,east", "4,2,east", "2,3,south"];
    source.entrance = { x: 2, y: 2 };
    source.stairs = { x: 4, y: 3 };

    const fragment = copyManualMapFragment(source, { x: 2, y: 2 }, { x: 4, y: 3 });
    expect(fragment).toMatchObject({ width: 3, height: 2, hardEdges: ["0,0,east"], entrance: { x: 0, y: 0 }, stairs: { x: 2, y: 1 } });

    const destination = createBlankManualMap("destination");
    placeManualTile(destination, "ground", { x: 8, y: 5, sheet: "walls-floor", frame: 36 });
    destination.entrance = { x: 8, y: 5 };
    expect(pasteManualMapFragment(destination, fragment, { x: 8, y: 5 })).toBe(true);
    expect(destination.layers.ground.find((placement) => placement.x === 8 && placement.y === 5)?.frame).toBe(138);
    expect(destination.layers.structure.find((placement) => placement.x === 9 && placement.y === 5)?.frame).toBe(36);
    expect(destination.collision[5 * destination.width + 8]).toBe(0);
    expect(destination.collisionLocked[5 * destination.width + 8]).toBe(true);
    expect(destination.hardEdges).toEqual(["8,5,east"]);
    expect(destination.entrance).toEqual({ x: 8, y: 5 });
    expect(destination.stairs).toEqual({ x: 10, y: 6 });
  });
});
