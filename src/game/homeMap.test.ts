import { describe, expect, it } from "vitest";
import { createHomeMap, HOME_HEIGHT, HOME_SPAWN, HOME_WIDTH } from "./homeMap";
import { validateMap } from "./mapDocument";
describe("fixed home map", () => { it("uses the authored default home with a valid spawn", () => { const map=createHomeMap(); expect([map.width,map.height]).toEqual([HOME_WIDTH,HOME_HEIGHT]); expect(map.markers.find((marker) => marker.kind === "homeSpawn")).toMatchObject(HOME_SPAWN); expect(map.collision[HOME_SPAWN.y * map.width + HOME_SPAWN.x]).toBe(true); expect(validateMap(map)).toEqual([]); }); });
