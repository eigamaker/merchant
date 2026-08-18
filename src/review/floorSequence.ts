export interface DungeonFloorLike {
  id: string;
  kind: "home" | "dungeon";
  floor: number;
}

export interface DungeonFloorUpdate {
  id: string;
  previousFloor: number;
  floor: number;
}

function uniqueDungeonFloors(maps: readonly DungeonFloorLike[]): number[] {
  const floors = maps.filter((map) => map.kind === "dungeon").map((map) => map.floor);
  if (floors.some((floor) => !Number.isInteger(floor) || floor < 1)) throw new Error("ダンジョン階は1以上の整数で指定してください。");
  if (new Set(floors).size !== floors.length) throw new Error("ダンジョン階が重複しています。先に重複を解消してください。");
  return floors;
}

/** Returns the lowest positive gap, keeping creation deterministic. */
export function smallestMissingDungeonFloor(maps: readonly DungeonFloorLike[]): number {
  const occupied = new Set(uniqueDungeonFloors(maps));
  let floor = 1;
  while (occupied.has(floor)) floor += 1;
  return floor;
}

/** Plans a stable renumber by current floor after a deletion. */
export function planDungeonFloorCompaction(maps: readonly DungeonFloorLike[]): DungeonFloorUpdate[] {
  uniqueDungeonFloors(maps);
  return maps
    .filter((map) => map.kind === "dungeon")
    .sort((a, b) => a.floor - b.floor)
    .flatMap((map, index) => map.floor === index + 1 ? [] : [{ id: map.id, previousFloor: map.floor, floor: index + 1 }]);
}

export function applyDungeonFloorUpdates<T extends DungeonFloorLike>(maps: readonly T[], updates: readonly DungeonFloorUpdate[]): void {
  const byId = new Map(updates.map((update) => [update.id, update.floor]));
  for (const map of maps) { const floor = byId.get(map.id); if (floor !== undefined) map.floor = floor; }
}
