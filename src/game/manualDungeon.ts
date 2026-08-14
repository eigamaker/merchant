import { reachableCells } from "./dungeonRules";
import { loadManualTrialMap, manualMapToDungeonMap } from "../review/manualMapModel";
import type { DungeonMap, Vec } from "./types";

/** Compile the editor's selected draft synchronously for the dedicated trial URL. */
export function createManualTrialDungeon(requiresTomb = false): DungeonMap | undefined {
  const manual = loadManualTrialMap();
  if (!manual) return undefined;
  const base = manualMapToDungeonMap(manual);
  let specialRoom: Vec | undefined;
  if (requiresTomb) {
    const reachable = reachableCells(base, base.entrance);
    const farthest = [...reachable]
      .map((key) => key.split(",").map(Number))
      .map(([x, y]) => ({ x: x ?? 0, y: y ?? 0 }))
      .filter((point) => point.x !== base.entrance.x || point.y !== base.entrance.y)
      .sort((a, b) => (Math.abs(b.x - base.entrance.x) + Math.abs(b.y - base.entrance.y)) - (Math.abs(a.x - base.entrance.x) + Math.abs(a.y - base.entrance.y)))[0];
    specialRoom = farthest;
  }
  return manualMapToDungeonMap(manual, specialRoom);
}
