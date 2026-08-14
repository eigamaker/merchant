import { describe, expect, it } from "vitest";
import layout from "./townLayout.json";

/** 町の見た目と当たり判定はこのJSONだけが正。寸法と施設の欠落をここで止める。 */
describe("town layout", () => {
  it("describes the same 60x45 grid the runtime PNG is cut into", () => {
    expect(layout.tile).toBe(24);
    expect(layout.width).toBe(60);
    expect(layout.height).toBe(45);
    expect(layout.collision).toHaveLength(layout.height);
    for (const [index, row] of layout.collision.entries()) {
      expect(row, `row ${index}`).toHaveLength(layout.width);
      expect(row, `row ${index}`).toMatch(/^[.#]+$/);
    }
  });

  it("seals the border so the player never leaves the illustration", () => {
    const rows = layout.collision;
    expect(rows[0]).toMatch(/^#+$/);
    expect(rows[rows.length - 1]).toMatch(/^#+$/);
    for (const row of rows) {
      expect(row[0]).toBe("#");
      expect(row[row.length - 1]).toBe("#");
    }
  });

  it("keeps one uniquely named entry for every facility the story needs", () => {
    const ids = [...layout.buildings.map((entry) => entry.id), ...layout.points.map((entry) => entry.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["duke", "scholar", "shop", "tavern", "mage", "marketHall", "guild", "jeweler", "entrance", "merchant"]) {
      expect(ids, id).toContain(id);
    }
  });

  it("places every footprint and marker inside the grid", () => {
    for (const building of layout.buildings) {
      expect(building.x, building.id).toBeGreaterThanOrEqual(0);
      expect(building.y, building.id).toBeGreaterThanOrEqual(0);
      expect(building.x + building.width, building.id).toBeLessThanOrEqual(layout.width);
      expect(building.y + building.height, building.id).toBeLessThanOrEqual(layout.height);
      expect(layout.collision[building.entrance.y]![building.entrance.x], building.id).toBe(".");
    }
    for (const point of layout.points) {
      expect(layout.collision[point.y]![point.x], point.id).toBe(".");
    }
    expect(layout.collision[layout.spawn.y]![layout.spawn.x]).toBe(".");
  });
});
