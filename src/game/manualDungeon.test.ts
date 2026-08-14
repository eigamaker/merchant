import { describe, expect, it } from "vitest";
import { createBlankManualMap, placeManualTile, storeManualTrialMap } from "../review/manualMapModel";
import { createManualTrialDungeon } from "./manualDungeon";

describe("manual dungeon trial", () => {
  it("loads the editor-selected map and preserves authored collision", () => {
    const map = createBlankManualMap("trial");
    for (let y = 2; y < 7; y += 1) for (let x = 2; x < 12; x += 1) placeManualTile(map, "ground", { x, y, sheet: "walls-floor", frame: 138 });
    map.entrance = { x: 2, y: 2 };
    map.stairs = { x: 11, y: 6 };
    storeManualTrialMap(map);
    const dungeon = createManualTrialDungeon();
    expect(dungeon?.visualTheme).toBe("craftpix-manual");
    expect(dungeon?.tiles[2]?.[2]).toBe(0);
    expect(dungeon?.stairs).toEqual({ x: 11, y: 6 });
  });
});
