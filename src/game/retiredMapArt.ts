import retired from "../../assets-src/unified/retired-map-ids.json";
const oldAssets = new Map(retired.map(asset => [asset.id, asset]));

/** Only known retired packs migrate; malformed/unknown author references still fail. */
export function replacementMapArt(id: string, layer?: string, tileSize?: number): string | undefined {
  const old = oldAssets.get(id);
  if (!old) return undefined;
  const kind = layer ?? old.defaultLayer;
  const type = kind === "ground" ? "floor" : kind === "structure" ? "wall" : "prop";
  if ((tileSize ?? old.tileSize) === 32) return `unified.compat-${type}32`;
  return type === "floor" ? "unified.cave-floor" : type === "wall" ? "unified.cave-wall" : "unified.rubble";
}
