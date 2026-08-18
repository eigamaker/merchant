import { cloneMap, resizeMap, setMapTileSize, type MapDocument, type MapMutationResult, type TileSize } from "../game/mapDocument";
import type { MapKind } from "../game/types";
import { smallestMissingDungeonFloor } from "./floorSequence";

export interface MapSettingsInput {
  width: number;
  height: number;
  tileSize: TileSize;
  kind: MapKind;
  maps: readonly MapDocument[];
}

function isEmptyMap(map: MapDocument): boolean {
  return map.terrain.every((cell) => cell === null)
    && map.collision.every((walkable) => !walkable)
    && Object.values(map.layers).every((cells) => cells.every((cell) => cell === null))
    && map.markers.length === 0
    && map.enemyRoster.length === 0;
}

function changeKindOnEmptyDraft(draft: MapDocument, requestedKind: MapKind, maps: readonly MapDocument[]): MapMutationResult {
  if (draft.kind === requestedKind) return { ok: true };
  if (!isEmptyMap(draft)) return { ok: false, reason: "マップ種類はタイル・通行設定・マーカーが空のマップだけ変更できます。" };
  if (requestedKind === "home" && maps.some((map) => map.id !== draft.id && map.kind === "home")) return { ok: false, reason: "家マップは1枚だけにしてください。" };
  draft.kind = requestedKind;
  try { draft.floor = requestedKind === "home" ? 0 : smallestMissingDungeonFloor(maps.filter((map) => map.id !== draft.id)); }
  catch (error) { return { ok: false, reason: error instanceof Error ? error.message : "階番号を割り当てられません。" }; }
  return { ok: true };
}

/** Applies kind, dimensions and tile size as one authoring transaction. */
export function applyMapSettingsAtomically(map: MapDocument, input: MapSettingsInput): MapMutationResult {
  const draft = cloneMap(map);
  const kindResult = changeKindOnEmptyDraft(draft, input.kind, input.maps);
  if (!kindResult.ok) return kindResult;
  const sizeResult = setMapTileSize(draft, input.tileSize);
  if (!sizeResult.ok) return sizeResult;
  const resizeResult = resizeMap(draft, input.width, input.height);
  if (!resizeResult.ok) return resizeResult;
  Object.assign(map, draft);
  return { ok: true };
}
