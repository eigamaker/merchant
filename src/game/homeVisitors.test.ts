import { describe, expect, it } from "vitest";
import { createManualMap } from "./mapDocument";
import { assignHomeVisitorCells } from "./homeVisitors";

describe("home visitor placement", () => {
  it("uses only unique unreserved walkable cells and omits excess visitors", () => {
    const map = createManualMap("home", { width: 4, height: 4, tileSize: 32 });
    map.collision[1 * map.width + 1] = true;
    map.collision[1 * map.width + 2] = true;
    const assignments = assignHomeVisitorCells(map, ["a", "b", "c"], [{ x: 1, y: 1 }]);

    expect(assignments).toEqual([{ visitorId: "a", pos: { x: 2, y: 1 } }]);
    expect(new Set(assignments.map(({ pos }) => `${pos.x},${pos.y}`)).size).toBe(assignments.length);
  });

  it("returns no visitors when every walkable cell is reserved", () => {
    const map = createManualMap("home", { width: 4, height: 4 });
    map.collision.fill(false);
    map.collision[1 * map.width + 1] = true;
    expect(assignHomeVisitorCells(map, ["a", "b"], [{ x: 1, y: 1 }])).toEqual([]);
  });

  it("uses a safe outer cell when it is the map's only open cell", () => {
    const map = createManualMap("home", { width: 4, height: 4, tileSize: 32 });
    map.collision.fill(false);
    map.collision[2 * map.width] = true;

    expect(assignHomeVisitorCells(map, ["outer"], [])).toEqual([
      { visitorId: "outer", pos: { x: 0, y: 2 } },
    ]);
  });
});
