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

/**
 * How many map cells one frame of an asset covers, per side.
 *
 * The world grid is the map's cell size, so a 32px sheet on a 16px map is a
 * single picture spanning 2x2 cells rather than four unrelated tiles. The
 * anchor is the top-left cell.
 */
export function mapAssetFootprint(assetId: string, mapTileSize: number): number {
  const asset = MAP_ASSETS.get(assetId);
  if (!asset || mapTileSize <= 0) return 1;
  return Math.max(1, Math.round(asset.tileSize / mapTileSize));
}

export function mapAssetDefinitions(assetIds: Iterable<string>): Array<typeof MAP_ASSET_CATALOG[number]> {
  const requested = new Set(assetIds);
  return MAP_ASSET_CATALOG.filter((asset) => requested.has(asset.id));
}

export function authoredMapAssetIds(maps: ReadonlyArray<{
  layers?: Partial<Record<"ground" | "structure" | "decoration", readonly ({ assetId: string } | null)[]>>;
  markers?: readonly { visual?: { assetId: string } }[];
}>): Set<string> {
  const result = new Set<string>();
  for (const map of maps) {
    for (const layer of Object.values(map.layers ?? {})) for (const cell of layer ?? []) if (cell) result.add(cell.assetId);
    for (const marker of map.markers ?? []) if (marker.visual) result.add(marker.visual.assetId);
  }
  return result;
}

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
