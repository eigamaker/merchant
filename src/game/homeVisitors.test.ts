import { describe, expect, it } from "vitest";
import { createManualMap } from "./mapDocument";
import { assignHomeVisitorCells, findHomeVisitorPath } from "./homeVisitors";

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

  it("routes visitors around blocked cells without diagonal steps", () => {
    const map = createManualMap("home", { width: 6, height: 5, tileSize: 16 });
    map.collision.fill(true);
    map.collision[1 * map.width + 2] = false;
    map.collision[2 * map.width + 2] = false;
    map.collision[3 * map.width + 2] = false;

    const path = findHomeVisitorPath(map, { x: 1, y: 2 }, { x: 4, y: 2 });

    expect(path[0]).toEqual({ x: 1, y: 2 });
    expect(path.at(-1)).toEqual({ x: 4, y: 2 });
    expect(path.every((cell) => map.collision[cell.y * map.width + cell.x])).toBe(true);
    expect(path.slice(1).every((cell, index) => {
      const prior = path[index]!;
      return Math.abs(cell.x - prior.x) + Math.abs(cell.y - prior.y) === 1;
    })).toBe(true);
  });

  it("returns no route when the destination is unreachable", () => {
    const map = createManualMap("home", { width: 4, height: 4, tileSize: 16 });
    map.collision.fill(false);
    map.collision[map.width + 1] = true;
    map.collision[2 * map.width + 2] = true;
    expect(findHomeVisitorPath(map, { x: 1, y: 1 }, { x: 2, y: 2 })).toEqual([]);
  });
});
