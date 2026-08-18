import { MAP_ASSET_CATALOG } from "./mapAssetCatalog.generated";

export const MISSING_MAP_ASSET_TEXTURE = "map.asset.missing";

export type MapAssetWarningReason = "unknown-asset" | "texture-unavailable" | "invalid-frame";

export interface ResolvedMapAssetFrame {
  textureKey: string;
  frame: number;
  warning: boolean;
  reason?: MapAssetWarningReason;
}

const MAP_ASSETS = new Map<string, typeof MAP_ASSET_CATALOG[number]>(
  MAP_ASSET_CATALOG.map((asset) => [asset.id, asset]),
);

const warningFrame = (reason: MapAssetWarningReason): ResolvedMapAssetFrame => ({
  textureKey: MISSING_MAP_ASSET_TEXTURE,
  frame: 0,
  warning: true,
  reason,
});

/**
 * Resolves an authored map cell without silently replacing broken references with a normal tile.
 * Legacy maps without authored cells bypass this resolver and keep their historical fallbacks.
 */
export function resolveMapAssetFrame(
  assetId: string,
  frame: number,
  textureAvailable: (textureKey: string) => boolean,
): ResolvedMapAssetFrame {
  const asset = MAP_ASSETS.get(assetId);
  if (!asset) return warningFrame("unknown-asset");
  if (!Number.isInteger(frame) || frame < 0 || frame >= asset.frameCount) return warningFrame("invalid-frame");

  const textureKey = `map.asset.${asset.id}`;
  if (!textureAvailable(textureKey)) return warningFrame("texture-unavailable");
  return { textureKey, frame, warning: false };
}
