import { describe, expect, it } from "vitest";
import { createDefaultMapPack } from "./defaultMapPack";
import { validateTrialMapPack } from "./mapDocument";

describe("authored default map pack", () => {
  it("is valid and keeps every marker on a walkable cell", () => {
    const pack = createDefaultMapPack();
    expect(validateTrialMapPack(pack)).toEqual([]);
    expect(pack.dungeons.map((map) => map.floor)).toEqual([1]);
    for (const map of [pack.home, ...pack.dungeons]) {
      for (const marker of map.markers) expect(map.collision[marker.y * map.width + marker.x]).toBe(true);
    }
  });

  it("returns defensive clones", () => {
    const first = createDefaultMapPack();
    first.home.collision.fill(false);
    expect(createDefaultMapPack().home.collision.some(Boolean)).toBe(true);
  });
});
