import { describe, expect, it } from "vitest";
import { createHomeMap, HOME_HEIGHT, HOME_WIDTH } from "./homeMap";
import { validateMap } from "./mapDocument";
describe("fixed home map", () => { it("is a 32x20 walkable house surrounded by walls", () => { const map=createHomeMap(); expect([map.width,map.height]).toEqual([HOME_WIDTH,HOME_HEIGHT]); expect(map.terrain[0]).toBe("home.wall"); expect(map.terrain[1+map.width]).toBe("home.floor"); expect(validateMap(map)).toEqual([]); }); });
