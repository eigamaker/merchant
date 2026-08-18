import { describe, expect, it } from "vitest";
import { AUTHORED_SAMPLE_MAPS, validateAuthoredMapConnections } from "./authoredMaps";

describe("authored home/dungeon map connections", () => {
  it("contains only home and dungeon samples", () => {
    expect(AUTHORED_SAMPLE_MAPS.map((map) => map.kind)).toEqual(["home", "dungeon"]);
    expect(validateAuthoredMapConnections()).toEqual([]);
  });

  it("uses 16px coordinates and reciprocal home return", () => {
    expect(AUTHORED_SAMPLE_MAPS.every((map) => map.tileSize === 16)).toBe(true);
    const home = AUTHORED_SAMPLE_MAPS.find((map) => map.id === "home")!;
    const dungeon = AUTHORED_SAMPLE_MAPS.find((map) => map.id === "dungeon")!;
    expect(home.portals.some((portal) => portal.kind === "dungeonEntrance")).toBe(true);
    expect(dungeon.portals.find((portal) => portal.kind === "stairsUp")).toMatchObject({
      targetMapId: "home",
      targetMarkerId: "dungeon-entrance",
    });
  });
});
