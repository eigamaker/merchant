import { actorDefinition } from "./actorCatalog";
import type { AdventurerRank, ItemCategory, ItemDefinition, NpcRecord } from "./types";

const item = (
  id: string,
  category: ItemDefinition["category"],
  name: string,
  baseValue: number,
  _legacySize: number,
  rarity: NonNullable<ItemDefinition["rarity"]>,
  description: string,
  stats: Partial<Pick<ItemDefinition, "attack" | "defense" | "healing" | "cures" | "capacity" | "minFloor" | "singular">> = {},
): ItemDefinition => ({
  id,
  category,
  unknownName: stats.singular ? "？？？の剣" : name,
  suspectedName: name,
  trueName: name,
  baseValue,
  rarity,
  visualId: `item.${id}`,
  description,
  ...stats,
});

export const MERCHANT_ITEM_DEFINITIONS: Record<string, ItemDefinition> = Object.fromEntries([
  item("iron-sword", "weapon", "鉄の剣", 120, 2, "common", "使い込まれた標準的な鉄剣。", { attack: 2 }),
  item("bronze-spear", "weapon", "青銅の槍", 260, 3, "uncommon", "長い間、儀礼と実戦の両方で使われてきた槍。", { attack: 3 }),
  item("nameless-black-blade", "weapon", "名もなき黒剣", 1800, 3, "legendary", "深層で発見される、名を持たない黒い剣。", { attack: 7, singular: true }),
  item("leather-armor", "armor", "革鎧", 100, 2, "common", "軽量で動きやすい冒険者用の革鎧。", { defense: 1 }),
  item("iron-helmet", "armor", "鉄兜", 180, 2, "uncommon", "額と側頭部を守る頑丈な鉄兜。", { defense: 2 }),
  item("round-shield", "armor", "円盾", 420, 3, "rare", "縁を金属で補強した丸盾。", { defense: 3 }),
  item("minor-healing-potion", "medicine", "小回復薬", 60, 1, "common", "軽い傷を塞ぐ赤い薬。", { healing: 4 }),
  item("major-healing-potion", "medicine", "大回復薬", 280, 1, "rare", "深い傷にも効く濃い回復薬。", { healing: 10 }),
  item("antidote", "medicine", "毒消し", 80, 1, "common", "一般的な毒を中和する緑色の薬。", { cures: "poison" }),
  item("moon-fungus", "material", "月光茸", 40, 1, "common", "暗所で淡く光る調合素材。"),
  item("slime-core", "material", "スライムの核", 70, 1, "common", "透明な膜に包まれた魔物の核。"),
  item("beast-claw", "material", "洞窟獣の爪", 140, 1, "uncommon", "岩を削るほど硬い黒い爪。"),
  item("old-ring", "curio", "古い指輪", 220, 1, "uncommon", "持ち主の分からない古びた銀の指輪。"),
  item("blue-gem", "curio", "青い宝石", 650, 1, "rare", "深い海の色を閉じ込めたような宝石。"),
  item("rune-tablet", "curio", "ルーン石板", 800, 2, "rare", "読めない刻印が並ぶ小さな石板。"),
  // 道具袋。商人が身に着ける唯一の装備で、持ち帰れる量そのものを決める。
  // 金では買えず、迷宮の底からしか出てこない。
  item("cloth-wrap", "bag", "風呂敷", 30, 1, "common", "一枚の布。結べば荷になり、広げれば店になる。", { capacity: 12, minFloor: 99 }),
  item("shoulder-sack", "bag", "背負い袋", 140, 1, "uncommon", "肩に掛ける麻の袋。両手が空く。", { capacity: 18, minFloor: 3 }),
  item("pedlar-case", "bag", "行商箱", 420, 1, "rare", "仕切りの入った木箱。割れ物も運べる。", { capacity: 24, minFloor: 5 }),
  item("caravan-pack", "bag", "隊商荷駄", 950, 1, "rare", "隊商が使う大荷物。ひとりで背負うものではない。", { capacity: 32, minFloor: 7 }),
].map((definition) => [definition.id, definition]));

/**
 * その種類が落ち始める深さ。
 *
 * 浅い階で高価な品が出ると、深く潜る意味が消える。地下1〜2階は素材と薬だけの
 * 仕入れの階で、武器が転がっているのは「そこまで担いで死んだ者がいた」深さからである。
 */
export const CATEGORY_MIN_FLOOR: Partial<Record<ItemCategory, number>> = {
  weapon: 3,
  armor: 3,
  curio: 4,
};

export function itemMinFloor(definition: ItemDefinition): number {
  if (definition.minFloor !== undefined) return definition.minFloor;
  if (definition.rarity === "legendary") return 6;
  return CATEGORY_MIN_FLOOR[definition.category] ?? 1;
}

/** 商人が最初から持っている道具袋。 */
export const STARTING_BAG_ID = "cloth-wrap";
/** 道具袋を失った場合に立ち返る枠数。 */
export const FALLBACK_BAG_CAPACITY = 12;

export function bagCapacityOf(definitionId: string | undefined): number {
  const definition = definitionId ? MERCHANT_ITEM_DEFINITIONS[definitionId] : undefined;
  return definition?.capacity ?? FALLBACK_BAG_CAPACITY;
}

export const ITEM_VISUALS: Record<string, string> = Object.fromEntries(
  Object.values(MERCHANT_ITEM_DEFINITIONS).map((definition) => [definition.visualId!, `assets/items/${definition.id}.png`]),
);

type NpcSeed = Omit<NpcRecord, "status" | "relation" | "inventoryIds">;

export interface AdventurerRankDefinition {
  rank: AdventurerRank;
  escortFee: number;
  baseHp: number;
  baseDamage: number;
  recommendedFloor: number;
}

export const ADVENTURER_RANKS: Record<AdventurerRank, AdventurerRankDefinition> = {
  E: { rank: "E", escortFee: 100, baseHp: 10, baseDamage: 3, recommendedFloor: 2 },
  D: { rank: "D", escortFee: 180, baseHp: 15, baseDamage: 4, recommendedFloor: 3 },
  C: { rank: "C", escortFee: 320, baseHp: 21, baseDamage: 6, recommendedFloor: 5 },
  B: { rank: "B", escortFee: 550, baseHp: 29, baseDamage: 8, recommendedFloor: 6 },
  A: { rank: "A", escortFee: 900, baseHp: 40, baseDamage: 11, recommendedFloor: 8 },
};

export const ADVENTURER_RANK_ORDER: readonly AdventurerRank[] = ["E", "D", "C", "B", "A"];


export const NPC_SEEDS: readonly NpcSeed[] = [
  { id: "mina", name: "ミナ", profession: "scout", appearanceId: "profession.adventurer.scout.01", adventurer: true, rank: "E", interests: ["medicine", "material"], budget: 350, baseFee: 100, maxHp: 10, damage: 3, retreatHpRatio: 0.5 },
  { id: "toma", name: "トーマ", profession: "swordsman", appearanceId: "profession.adventurer.swordsman.01", adventurer: true, rank: "E", interests: ["weapon", "armor"], budget: 380, baseFee: 100, maxHp: 13, damage: 4, retreatHpRatio: 0.35 },
  { id: "lise", name: "リーゼ", profession: "scout", appearanceId: "profession.adventurer.scout.01", adventurer: true, rank: "E", interests: ["medicine", "curio"], budget: 420, baseFee: 100, maxHp: 11, damage: 3, retreatHpRatio: 0.45 },
  { id: "rolf", name: "ロルフ", profession: "swordsman", appearanceId: "profession.adventurer.swordsman.01", adventurer: true, rank: "D", interests: ["weapon", "armor"], budget: 520, baseFee: 180, maxHp: 16, damage: 4, retreatHpRatio: 0.3 },
  { id: "juno", name: "ユーノ", profession: "mercenary", appearanceId: "profession.adventurer.mercenary.01", adventurer: true, rank: "D", interests: ["weapon", "medicine"], budget: 600, baseFee: 180, maxHp: 14, damage: 5, retreatHpRatio: 0.4 },
  { id: "bastian", name: "バスティアン", profession: "mercenary", appearanceId: "profession.adventurer.mercenary.01", adventurer: true, rank: "C", interests: ["weapon", "medicine"], budget: 800, baseFee: 320, maxHp: 22, damage: 7, retreatHpRatio: 0.2 },
  { id: "kael", name: "カイル", profession: "swordsman", appearanceId: "profession.adventurer.swordsman.01", adventurer: true, rank: "C", interests: ["armor", "curio"], budget: 900, baseFee: 320, maxHp: 25, damage: 6, retreatHpRatio: 0.3 },
  { id: "freya", name: "フレイヤ", profession: "scout", appearanceId: "profession.adventurer.scout.01", adventurer: true, rank: "B", interests: ["medicine", "material"], budget: 1200, baseFee: 550, maxHp: 30, damage: 9, retreatHpRatio: 0.35 },
  { id: "doran", name: "ドラン", profession: "swordsman", appearanceId: "profession.adventurer.swordsman.01", adventurer: true, rank: "B", interests: ["weapon", "armor"], budget: 1400, baseFee: 550, maxHp: 34, damage: 8, retreatHpRatio: 0.25 },
  { id: "astrid", name: "アストリッド", profession: "mercenary", appearanceId: "profession.adventurer.mercenary.01", adventurer: true, rank: "A", interests: ["weapon", "curio"], budget: 2200, baseFee: 900, maxHp: 44, damage: 12, retreatHpRatio: 0.2 },
  { id: "mira", name: "ミラ", profession: "merchant", appearanceId: "profession.merchant.01", adventurer: false, interests: ["material", "curio"], budget: 700 },
  { id: "godwin", name: "ゴドウィン", profession: "blacksmith", appearanceId: "profession.blacksmith.01", adventurer: false, interests: ["weapon", "armor"], budget: 1400 },
  { id: "neva", name: "ネヴァ", profession: "apothecary", appearanceId: "profession.apothecary.01", adventurer: false, interests: ["medicine", "material"], budget: 900 },
  { id: "roden", name: "ローデン", profession: "noble", appearanceId: "profession.noble.01", adventurer: false, interests: ["armor", "curio"], budget: 3000 },
  { id: "rina", name: "リナ", profession: "townsperson", appearanceId: "profession.townsperson.01", adventurer: false, interests: ["medicine", "curio"], budget: 350 },
] as const;

/**
 * The authored cast: an appearance id per hand-written person, mapped to the
 * sprite it wears. A generated adventurer does not appear here - the roster
 * names an actor directly, from the sheets marked as adventurers.
 */
export const NPC_APPEARANCES: Record<string, string> = {
  "profession.adventurer.swordsman.01": "swordsman_lvl1",
  "profession.adventurer.scout.01": "legacy.guard.mina",
  "profession.adventurer.mercenary.01": "swordsman_lvl3",
  "profession.merchant.01": "legacy.npc.trader",
  "profession.blacksmith.01": "legacy.guard.rolf",
  "profession.apothecary.01": "legacy.npc.mage",
  "profession.noble.01": "legacy.npc.innkeeper",
  "profession.townsperson.01": "legacy.npc.scout",
};

/**
 * The sprite for an appearance id. Authored people name one of the entries
 * above; anyone the roster generated names an actor, so an id that is already
 * a registered actor stands for itself.
 */
export function npcAppearanceSprite(appearanceId: string | undefined): string | undefined {
  if (!appearanceId) return undefined;
  return NPC_APPEARANCES[appearanceId] ?? (actorDefinition(appearanceId) ? appearanceId : undefined);
}

export function createInitialNpcs(): NpcRecord[] {
  return NPC_SEEDS.map((seed) => ({ ...seed, interests: [...seed.interests], status: "inTown", relation: 0, inventoryIds: [] }));
}

