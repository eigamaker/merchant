import source from "../../assets-src/maps/default-map-pack.json";
import { cloneMap, normalizeMap, validateTrialMapPack, type TrialMapPack } from "./mapDocument";

const maps = (source as unknown as { maps: unknown[] }).maps.map(normalizeMap);
const defaultPack: TrialMapPack = {
  home: maps.find((map) => map.kind === "home")!,
  dungeons: maps.filter((map) => map.kind === "dungeon").sort((a, b) => a.floor - b.floor),
};
const issues = validateTrialMapPack(defaultPack);
if (issues.length) throw new Error(`invalid default map pack: ${issues.join(", ")}`);

/** Returns a defensive clone of the authored map pack bundled with the game. */
export function createDefaultMapPack(): TrialMapPack {
  return { home: cloneMap(defaultPack.home), dungeons: defaultPack.dungeons.map(cloneMap) };
}
