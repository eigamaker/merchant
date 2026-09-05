import { describe, expect, it } from "vitest";
import { createDefaultMapPack } from "./defaultMapPack";
import { findHomeVisitorPath } from "./homeVisitors";
import { validateTrialMapPack } from "./mapDocument";

describe("authored default map pack", () => {
  it("is valid and keeps every marker on a walkable cell", () => {
    const pack = createDefaultMapPack();
    expect(validateTrialMapPack(pack)).toEqual([]);
    expect(pack.dungeons.map((map) => map.floor)).toEqual([1]);
    expect(pack.home.markers.some((marker) => marker.kind === "homeStorage")).toBe(false);
    const visitorEntry = pack.home.markers.find((marker) => marker.kind === "homeVisitors")!;
    const customerCounter = pack.home.markers.find((marker) => marker.kind === "customerCounter")!;
    expect(findHomeVisitorPath(pack.home, visitorEntry, customerCounter).length).toBeGreaterThan(1);
    for (const map of [pack.home, ...pack.dungeons]) {
      for (const marker of map.markers) expect(map.collision[marker.y * map.width + marker.x]).toBe(true);
    }
  });

  it("returns defensive clones", () => {
    const first = createDefaultMapPack();
    first.home.collision.fill(false);
    expect(createDefaultMapPack().home.collision.some(Boolean)).toBe(true);
  });

  it("keeps both doors and service positions reachable around solid furniture", () => {
    const { home } = createDefaultMapPack();
    const spawn = home.markers.find((marker) => marker.kind === "homeSpawn")!;
    for (const marker of home.markers) {
      expect(findHomeVisitorPath(home, spawn, marker).length).toBeGreaterThan(0);
    }
    for (const [x, y] of [[1, 3], [7, 4], [7, 5], [3, 6], [12, 4]]) {
      expect(home.collision[y * home.width + x]).toBe(false);
    }
  });
});
