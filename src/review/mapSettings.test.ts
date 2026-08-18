import { describe, expect, it } from "vitest";
import { createManualMap } from "../game/mapDocument";
import { applyMapSettingsAtomically } from "./mapSettings";

describe("applyMapSettingsAtomically", () => {
  it("does not leave a successful tile-size mutation behind when resize fails", () => {
    const map = createManualMap("home", "blank", { width: 8, height: 8, tileSize: 16 });
    const result = applyMapSettingsAtomically(map, { width: 3, height: 8, tileSize: 32, kind: "dungeon", maps: [map] });
    expect(result.ok).toBe(false);
    expect(map.tileSize).toBe(16);
    expect(map.width).toBe(8);
    expect(map.kind).toBe("home");
  });

  it("commits both settings together when they are valid", () => {
    const map = createManualMap("home", "blank", { width: 8, height: 8, tileSize: 16 });
    expect(applyMapSettingsAtomically(map, { width: 12, height: 10, tileSize: 32, kind: "dungeon", maps: [map] })).toEqual({ ok: true });
    expect(map).toMatchObject({ width: 12, height: 10, tileSize: 32, kind: "dungeon", floor: 1 });
  });

  it("rejects kind conversion once a map has authored content", () => {
    const map = createManualMap("dungeon", "filled", { width: 8, height: 8, tileSize: 16 });
    map.layers.ground[0] = { assetId: "dungeon.floor", frame: 0 };
    map.terrain[0] = "dungeon.floor";
    expect(applyMapSettingsAtomically(map, { width: 8, height: 8, tileSize: 16, kind: "home", maps: [map] })).toEqual({ ok: false, reason: "マップ種類はタイル・通行設定・マーカーが空のマップだけ変更できます。" });
    expect(map.kind).toBe("dungeon");
  });
});
