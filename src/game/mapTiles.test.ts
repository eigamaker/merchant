import { describe, expect, it } from "vitest";
import { CARDINAL_BITS, cardinalMask, compileTerrain, isMapPositionWalkable, isTileAllowed, moveMapPosition, tileWalkable } from "./mapTiles";

describe("logical map tiles", () => {
  it("uses cardinal N/E/S/W bits", () => expect(CARDINAL_BITS).toEqual({ north: 1, east: 2, south: 4, west: 8 }));
  it("resolves line, corners, T and cross", () => {
    const t = (w: number, h: number, cells: Record<string, "home.wall">) => {
      const a = Array<"home.wall" | null>(w * h).fill(null); for (const [key, id] of Object.entries(cells)) { const [x,y] = key.split(",").map(Number); a[y*w+x]=id; } return a;
    };
    expect(cardinalMask(t(2,1,{"0,0":"home.wall","1,0":"home.wall"}),2,1,0,0)).toBe(2);
    expect(cardinalMask(t(3,1,{"0,0":"home.wall","1,0":"home.wall","2,0":"home.wall"}),3,1,1,0)).toBe(10);
    expect(cardinalMask(t(2,2,{"0,0":"home.wall","1,0":"home.wall","0,1":"home.wall"}),2,2,0,0)).toBe(6);
  });
  it("derives walkability and rejects other map kinds", () => {
    expect(tileWalkable("home.floor")).toBe(true); expect(tileWalkable("home.wall")).toBe(false);
    expect(isTileAllowed("home.floor", "home")).toBe(true); expect(isTileAllowed("home.floor", "dungeon")).toBe(false);
    expect(() => compileTerrain(["home.floor"], 1, 1, "dungeon")).toThrow();
  });
  it("blocks an internal wall while allowing floor movement", () => {
    const terrain = Array(25).fill("home.floor" as const);
    terrain[2 * 5 + 2] = "home.wall";
    const map = { terrain, width: 5, height: 5, tileSize: 16 };
    expect(isMapPositionWalkable(map, { x: 40, y: 40 }, 3)).toBe(false);
    expect(moveMapPosition(map, { x: 24, y: 40 }, { x: 16, y: 0 }, 3)).toEqual({ x: 24, y: 40 });
    expect(moveMapPosition(map, { x: 24, y: 24 }, { x: 16, y: 0 }, 3)).toEqual({ x: 40, y: 24 });
  });
});
