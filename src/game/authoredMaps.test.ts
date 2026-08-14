import { describe, expect, it } from "vitest";
import { AUTHORED_SAMPLE_MAPS, validateAuthoredMapConnections } from "./authoredMaps";

describe("authored map sample connections", () => {
  it("contains town, interiors, and dungeon samples", () => {
    expect(AUTHORED_SAMPLE_MAPS.map((map) => map.kind)).toEqual(["town", "interior", "interior", "dungeon"]);
    expect(validateAuthoredMapConnections()).toEqual([]);
  });

  it("uses 16px coordinates and reciprocal interior exits", () => {
    expect(AUTHORED_SAMPLE_MAPS.every((map) => map.tileSize === 16)).toBe(true);
    const town = AUTHORED_SAMPLE_MAPS.find((map) => map.id === "town-main")!;
    expect(town.portals.map((portal) => portal.targetMapId)).toEqual(["guild-hall-1f", "glassblower-workshop", "dungeon-manual-01"]);
  });
});
