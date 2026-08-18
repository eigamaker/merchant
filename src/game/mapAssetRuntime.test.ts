import { describe, expect, it } from "vitest";
import { MISSING_MAP_ASSET_TEXTURE, resolveMapAssetFrame } from "./mapAssetRuntime";

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
