/** スプライトシート内のセル座標。frame は行優先の Phaser フレーム番号。 */
export interface FrameAddress {
  x: number;
  y: number;
  frame: number;
}

const frame = (columns: number, x: number, y: number): FrameAddress => ({ x, y, frame: y * columns + x });

/**
 * dungeon_walls.png のアクティブ領域は 12×4 セル。
 * 元仕様は「14種」と記載していたが、列挙は15種だったため15スロットへ補正した。
 */
export const DUNGEON_WALL_FRAMES = {
  center: frame(12, 0, 0),
  edgeNorth: frame(12, 1, 0),
  edgeEast: frame(12, 2, 0),
  edgeSouth: frame(12, 3, 0),
  edgeWest: frame(12, 4, 0),
  outerNorthEast: frame(12, 5, 0),
  outerSouthEast: frame(12, 6, 0),
  outerSouthWest: frame(12, 7, 0),
  outerNorthWest: frame(12, 8, 0),
  innerNorthEast: frame(12, 9, 0),
  innerSouthEast: frame(12, 10, 0),
  innerSouthWest: frame(12, 11, 0),
  innerNorthWest: frame(12, 0, 1),
  pillar: frame(12, 1, 1),
  cracked: frame(12, 2, 1),
} as const;

export type DungeonWallFrameId = keyof typeof DUNGEON_WALL_FRAMES;

/** town_buildings.png は 16×12 セル。各建物キットは重ならない4×3セル領域。 */
export const BUILDING_KIT_ORIGINS = {
  woodShop: frame(16, 0, 0),
  stonePublic: frame(16, 4, 0),
  warmInn: frame(16, 8, 0),
  nobleHouse: frame(16, 12, 0),
  arcaneShop: frame(16, 0, 3),
  marketProps: frame(16, 4, 3),
  dungeonEntrance: frame(16, 8, 3),
  sharedProps: frame(16, 12, 3),
} as const;

export type BuildingKitId = keyof typeof BUILDING_KIT_ORIGINS;

/** 各4×3キット内の必須セル。kit ごとに同じ位置・同じ役割を守る。 */
export const BUILDING_KIT_SLOTS = {
  roofLeft: { x: 0, y: 0 },
  roofMidLeft: { x: 1, y: 0 },
  roofMidRight: { x: 2, y: 0 },
  roofRight: { x: 3, y: 0 },
  facadeLeft: { x: 0, y: 1 },
  featureLeft: { x: 1, y: 1 },
  featureRight: { x: 2, y: 1 },
  facadeRight: { x: 3, y: 1 },
  baseLeft: { x: 0, y: 2 },
  entrance: { x: 1, y: 2 },
  thresholdOrProp: { x: 2, y: 2 },
  baseRight: { x: 3, y: 2 },
} as const;

export type BuildingKitSlotId = keyof typeof BUILDING_KIT_SLOTS;

export function buildingKitFrame(kit: BuildingKitId, slot: BuildingKitSlotId): FrameAddress {
  const origin = BUILDING_KIT_ORIGINS[kit];
  const offset = BUILDING_KIT_SLOTS[slot];
  return frame(16, origin.x + offset.x, origin.y + offset.y);
}

/**
 * 8×3セル施設用。各エントリは連続した192×72pxの建物を、左・右の4×3セルへ分けたもの。
 * 左右を別々に生成して継ぎ目を合わせるのではなく、必ず1枚の連続絵から切り出す。
 */
export const WIDE_BUILDING_KIT_ORIGINS = {
  warmInn: { left: frame(16, 0, 0), right: frame(16, 4, 0) },
  stonePublic: { left: frame(16, 8, 0), right: frame(16, 12, 0) },
  nobleHouse: { left: frame(16, 0, 3), right: frame(16, 4, 3) },
  dungeonEntrance: { left: frame(16, 8, 3), right: frame(16, 12, 3) },
} as const;

export type WideBuildingKitId = keyof typeof WIDE_BUILDING_KIT_ORIGINS;
export type WideBuildingSide = "left" | "right";

export function wideBuildingKitFrame(kit: WideBuildingKitId, side: WideBuildingSide, slot: BuildingKitSlotId): FrameAddress {
  const origin = WIDE_BUILDING_KIT_ORIGINS[kit][side];
  const offset = BUILDING_KIT_SLOTS[slot];
  return frame(16, origin.x + offset.x, origin.y + offset.y);
}
