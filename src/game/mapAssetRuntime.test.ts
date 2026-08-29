import { describe, expect, it } from "vitest";
import { MISSING_MAP_ASSET_TEXTURE, mapAssetFootprint, resolveMapAssetFrame } from "./mapAssetRuntime";
import { MAP_ASSET_CATALOG } from "./mapAssetCatalog.generated";

describe("runtime map asset resolution", () => {
  it("resolves a loaded catalog asset and preserves its frame", () => {
    expect(resolveMapAssetFrame("home.wall", 3, (key) => key === "map.asset.home.wall")).toEqual({
      textureKey: "map.asset.home.wall",
      frame: 3,
      warning: false,
    });
  });

  it.each([
    ["missing.asset", 0, true, "unknown-asset"],
    ["home.wall", 16, true, "invalid-frame"],
    ["home.wall", -1, true, "invalid-frame"],
    ["home.floor", 0, false, "texture-unavailable"],
  ] as const)("uses a warning texture for %s frame %s", (assetId, frame, available, reason) => {
    expect(resolveMapAssetFrame(assetId, frame, () => available)).toEqual({
      textureKey: MISSING_MAP_ASSET_TEXTURE,
      frame: 0,
      warning: true,
      reason,
    });
  });
});

describe("asset footprint", () => {
  const fine = MAP_ASSET_CATALOG.find((asset) => asset.tileSize === 16)!;

  it("spans as many cells as the sheet is coarser than the map grid", () => {
    expect(mapAssetFootprint(fine.id, 16)).toBe(1);
    // The ratio is what matters: a sheet twice the map's cell size covers 2x2.
    expect(mapAssetFootprint(fine.id, 8)).toBe(2);
    expect(mapAssetFootprint(fine.id, 4)).toBe(4);
  });

  it("never shrinks below a single cell", () => {
    expect(mapAssetFootprint(fine.id, 32)).toBe(1);
    expect(mapAssetFootprint("no-such-asset", 16)).toBe(1);
    expect(mapAssetFootprint(fine.id, 0)).toBe(1);
  });
});
