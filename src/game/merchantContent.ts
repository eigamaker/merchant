import type { ItemDefinition, NpcRecord } from "./types";

const item = (
  id: string,
  category: ItemDefinition["category"],
  name: string,
  baseValue: number,
  bulk: ItemDefinition["bulk"],
  rarity: NonNullable<ItemDefinition["rarity"]>,
  description: string,
  stats: Partial<Pick<ItemDefinition, "attack" | "defense" | "healing" | "cures" | "singular">> = {},
): ItemDefinition => ({
  id,
  category,
  unknownName: stats.singular ? "？？？の剣" : name,
  suspectedName: name,
  trueName: name,
  baseValue,
  bulk,
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
].map((definition) => [definition.id, definition]));

export const ITEM_VISUALS: Record<string, string> = Object.fromEntries(
  Object.values(MERCHANT_ITEM_DEFINITIONS).map((definition) => [definition.visualId!, `assets/items/${definition.id}.png`]),
);

type NpcSeed = Omit<NpcRecord, "status" | "relation" | "inventoryIds">;

export const NPC_SEEDS: readonly NpcSeed[] = [
  { id: "rolf", name: "ロルフ", profession: "swordsman", appearanceId: "profession.adventurer.swordsman.01", adventurer: true, interests: ["weapon", "armor"], budget: 450, baseFee: 100, maxHp: 8, damage: 2, trait: "standard", retreatHpRatio: 0.3 },
  { id: "mina", name: "ミナ", profession: "scout", appearanceId: "profession.adventurer.scout.01", adventurer: true, interests: ["medicine", "material"], budget: 350, baseFee: 140, maxHp: 6, damage: 1, trait: "scout", retreatHpRatio: 0.5 },
  { id: "bastian", name: "バスティアン", profession: "mercenary", appearanceId: "profession.adventurer.mercenary.01", adventurer: true, interests: ["weapon", "medicine"], budget: 700, baseFee: 180, maxHp: 10, damage: 3, trait: "standard", retreatHpRatio: 0.2 },
  { id: "mira", name: "ミラ", profession: "merchant", appearanceId: "profession.merchant.01", adventurer: false, interests: ["material", "curio"], budget: 700 },
  { id: "godwin", name: "ゴドウィン", profession: "blacksmith", appearanceId: "profession.blacksmith.01", adventurer: false, interests: ["weapon", "armor"], budget: 1400 },
  { id: "neva", name: "ネヴァ", profession: "apothecary", appearanceId: "profession.apothecary.01", adventurer: false, interests: ["medicine", "material"], budget: 900 },
  { id: "roden", name: "ローデン", profession: "noble", appearanceId: "profession.noble.01", adventurer: false, interests: ["armor", "curio"], budget: 3000 },
  { id: "rina", name: "リナ", profession: "townsperson", appearanceId: "profession.townsperson.01", adventurer: false, interests: ["medicine", "curio"], budget: 350 },
] as const;

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

export function createInitialNpcs(): NpcRecord[] {
  return NPC_SEEDS.map((seed) => ({ ...seed, interests: [...seed.interests], status: "inTown", relation: 0, inventoryIds: [] }));
}

export const GENERATED_ADVENTURER_NAMES = [
  "アロン・ヴェイル", "セリア・ハート", "デイン・クロウ", "エルナ・フォード",
  "フェン・グレイ", "ギルダ・ルーン", "ヒューゴ・マーシュ", "イリス・ヴェイル",
  "ヨラン・パイク", "カラ・ムーン", "レオン・アッシュ", "ノラ・フリント",
] as const;

export const LEGENDARY_NAME_PREFIXES = ["黒風", "宵月", "灰冠", "影喰らい", "冬雷"] as const;
