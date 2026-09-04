import { actorDefinition } from "./actorCatalog";
import type { AdventurerRank, ItemDefinition, NpcRecord } from "./types";

const item = (
  id: string,
  category: ItemDefinition["category"],
  name: string,
  baseValue: number,
  _legacySize: number,
  rarity: NonNullable<ItemDefinition["rarity"]>,
  description: string,
  stats: Partial<Pick<ItemDefinition, "attack" | "defense" | "healing" | "charges" | "cures" | "capacity" | "stackSize" | "singular">> = {},
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

/**
 * 素材の一束の数。
 *
 * 道具袋の枠は一日の稼ぎの上限そのものなので、**枠を節約できること自体が効果**である。
 * 5個で1枠なら、深層の素材5個（750G）より宝箱の一点（2,200G）のほうが枠あたり高い ——
 * 「宝箱が本命」を数字で保つための値でもある。
 */
export const MATERIAL_STACK_SIZE = 5;

export const MERCHANT_ITEM_DEFINITIONS: Record<string, ItemDefinition> = Object.fromEntries([
  item("iron-sword", "weapon", "鉄の剣", 150, 2, "common", "使い込まれた標準的な鉄剣。", { attack: 2 }),
  item("bronze-spear", "weapon", "青銅の槍", 350, 3, "uncommon", "長い間、儀礼と実戦の両方で使われてきた槍。", { attack: 3 }),
  item("nameless-black-blade", "weapon", "名もなき黒剣", 1800, 3, "legendary", "深層で発見される、名を持たない黒い剣。", { attack: 7, singular: true }),
  item("leather-armor", "armor", "革鎧", 150, 2, "common", "軽量で動きやすい冒険者用の革鎧。", { defense: 1 }),
  item("iron-helmet", "armor", "鉄兜", 350, 2, "uncommon", "額と側頭部を守る頑丈な鉄兜。", { defense: 2 }),
  item("round-shield", "armor", "円盾", 700, 3, "rare", "縁を金属で補強した丸盾。", { defense: 3 }),
  item("minor-healing-potion", "medicine", "小回復薬", 60, 1, "common", "軽い傷を塞ぐ赤い薬。", { healing: 4 }),
  item("major-healing-potion", "medicine", "大回復薬", 280, 1, "rare", "深い傷にも効く濃い回復薬。", { healing: 10 }),
  item("antidote", "medicine", "毒消し", 80, 1, "common", "一般的な毒を中和する緑色の薬。", { cures: "poison" }),
  item("moon-fungus", "material", "月光茸", 30, 1, "common", "暗所で淡く光る調合素材。", { stackSize: MATERIAL_STACK_SIZE }),
  item("slime-core", "material", "スライムの核", 60, 1, "common", "透明な膜に包まれた魔物の核。", { stackSize: MATERIAL_STACK_SIZE }),
  item("beast-claw", "material", "洞窟獣の爪", 120, 1, "uncommon", "岩を削るほど硬い黒い爪。", { stackSize: MATERIAL_STACK_SIZE }),
  item("old-ring", "curio", "古い指輪", 700, 1, "uncommon", "持ち主の分からない古びた銀の指輪。"),
  item("blue-gem", "curio", "青い宝石", 1100, 1, "rare", "深い海の色を閉じ込めたような宝石。"),
  item("rune-tablet", "curio", "ルーン石板", 1600, 2, "rare", "読めない刻印が並ぶ小さな石板。"),
  // 深層の薬。回復量ではなく回数で強い。5回分が1枠に収まることが、そのまま効果になる。
  item("field-flask", "medicine", "携行薬瓶", 400, 1, "uncommon", "小分けにした回復薬。何度かに分けて使える。", { healing: 4, charges: 5 }),
  item("elixir", "medicine", "秘薬", 1000, 1, "rare", "濃く煮詰めた薬。三度ぶんが一本に収まっている。", { healing: 10, charges: 3 }),
  item("grand-elixir", "medicine", "霊薬", 3000, 1, "rare", "深層でしか見つからない薬。一本で八度、傷を塞ぐ。", { healing: 10, charges: 8 }),
  // 素材。床に落ちているのはこれだけで、束ねて運ぶ。
  item("herb", "material", "薬草", 30, 1, "common", "薬師が回復薬を煮出すのに要る草。浅い階に多い。", { stackSize: MATERIAL_STACK_SIZE }),
  // 鉱物。深さがそのまま値になる系列で、鍛冶も錬金術師も欲しがる。
  item("iron-ore", "material", "鉄鉱石", 40, 1, "common", "鍛冶が剣にも鎧にも使う、ありふれた鉱石。", { stackSize: MATERIAL_STACK_SIZE }),
  item("silver-ore", "material", "銀鉱", 90, 1, "uncommon", "触媒にも武器にもなる、白く光る鉱石。", { stackSize: MATERIAL_STACK_SIZE }),
  item("gold-ore", "material", "金鉱", 140, 1, "uncommon", "装飾にも錬金にも使われる、重く柔らかい鉱石。", { stackSize: MATERIAL_STACK_SIZE }),
  item("mithril", "material", "ミスリル", 200, 1, "rare", "軽くて硬い。これで打った鎧は驚くほど軽いという。", { stackSize: MATERIAL_STACK_SIZE }),
  item("orichalcum", "material", "オリハルコン", 320, 1, "rare", "最も深いところにしかない金属。名のある武器はこれで出来ている。", { stackSize: MATERIAL_STACK_SIZE }),
  item("mana-stone", "arcane", "魔石", 160, 1, "uncommon", "魔力を溜め込んだ石。魔法使いと錬金術師が絶えず欲しがる。", { stackSize: MATERIAL_STACK_SIZE }),
  // 宝石。実用ではなく、所有するために買われる。
  item("diamond", "gem", "ダイアモンド", 1800, 1, "rare", "硬く、澄み、値が付く。使い道は無く、だから欲しがる者がいる。"),
  // 道具袋。商人が身に着ける唯一の装備で、持ち帰れる量そのものを決める。
  // 金では買えず、迷宮の底からしか出てこない。
  item("cloth-wrap", "bag", "風呂敷", 30, 1, "common", "一枚の布。結べば荷になり、広げれば店になる。", { capacity: 12 }),
  item("shoulder-sack", "bag", "背負い袋", 300, 1, "uncommon", "肩に掛ける麻の袋。両手が空く。", { capacity: 18 }),
  item("pedlar-case", "bag", "行商箱", 900, 1, "rare", "仕切りの入った木箱。割れ物も運べる。", { capacity: 24 }),
  item("caravan-pack", "bag", "隊商荷駄", 2500, 1, "rare", "隊商が使う大荷物。ひとりで背負うものではない。", { capacity: 32 }),
].map((definition) => [definition.id, definition]));

/**
 * 戦利品の抽選表。
 *
 * **床には素材が落ちている。珍しいものは宝箱にしか入っていない。**
 *
 * 素材は自然にそこにあるが、加工された品や誰かの遺産は箱に納められている。1階に宝箱は
 * ひとつだけなので、良い品の供給は深さに厳密に比例する —— 霊薬も一品物も、10個20個
 * まとめて手に入れることは原理的にできない。
 *
 * 形は敵の出現表（`DungeonSpawnEntry`）に合わせてある。重みで引き、深さで絞る。
 */
export interface LootEntry {
  itemId: string;
  minFloor: number;
  /** 省略すれば「その深さから下はずっと」。 */
  maxFloor?: number;
  weight: number;
}

/** 床に落ちているもの。素材だけ。 */
export const GROUND_LOOT: readonly LootEntry[] = [
  // 浅層は薬草と茸。薬師と錬金術師が絶えず買う、日々の商いの底になる品。
  { itemId: "herb", minFloor: 1, maxFloor: 9, weight: 8 },
  { itemId: "moon-fungus", minFloor: 1, weight: 6 },
  { itemId: "slime-core", minFloor: 2, weight: 5 },
  { itemId: "iron-ore", minFloor: 3, weight: 6 },
  { itemId: "beast-claw", minFloor: 4, weight: 4 },
  { itemId: "silver-ore", minFloor: 8, weight: 5 },
  { itemId: "mana-stone", minFloor: 8, weight: 4 },
  { itemId: "gold-ore", minFloor: 12, weight: 4 },
  { itemId: "mithril", minFloor: 18, weight: 4 },
  { itemId: "orichalcum", minFloor: 24, weight: 3 },
];

/**
 * 宝箱と遺体の中身。
 *
 * 薬は生成物であって地面に落ちているものではないので、ここに、それも控えめに置く。
 * 道具袋は「金では買えず、迷宮の底からしか出てこない」ので、重みを最も低くする。
 */
export const CHEST_LOOT: readonly LootEntry[] = [
  { itemId: "minor-healing-potion", minFloor: 1, weight: 3 },
  { itemId: "antidote", minFloor: 1, weight: 2 },
  { itemId: "major-healing-potion", minFloor: 8, weight: 2 },
  { itemId: "field-flask", minFloor: 6, maxFloor: 14, weight: 3 },
  { itemId: "elixir", minFloor: 12, maxFloor: 22, weight: 3 },
  { itemId: "grand-elixir", minFloor: 20, weight: 3 },
  { itemId: "diamond", minFloor: 22, weight: 2 },
  { itemId: "iron-sword", minFloor: 3, weight: 5 },
  { itemId: "leather-armor", minFloor: 3, weight: 5 },
  { itemId: "bronze-spear", minFloor: 6, weight: 4 },
  { itemId: "iron-helmet", minFloor: 6, weight: 4 },
  { itemId: "old-ring", minFloor: 4, weight: 4 },
  { itemId: "round-shield", minFloor: 10, weight: 3 },
  { itemId: "blue-gem", minFloor: 12, weight: 3 },
  { itemId: "rune-tablet", minFloor: 18, weight: 3 },
  { itemId: "shoulder-sack", minFloor: 3, weight: 1 },
  { itemId: "pedlar-case", minFloor: 5, weight: 1 },
  { itemId: "caravan-pack", minFloor: 7, weight: 1 },
  { itemId: "nameless-black-blade", minFloor: 6, weight: 1 },
];

/** その深さで引ける行。表の順序を保つ。 */
export function lootEntriesFor(table: readonly LootEntry[], floor: number): readonly LootEntry[] {
  return table.filter((entry) => floor >= entry.minFloor && (entry.maxFloor === undefined || floor <= entry.maxFloor));
}

/**
 * 深さの解禁は `GROUND_LOOT` / `CHEST_LOOT` の `minFloor` が持つ。
 *
 * 以前は `CATEGORY_MIN_FLOOR` と `itemMinFloor` が種類ごとの解禁深度を決めていたが、
 * 表が明示的になったので役目を終えた。深さを変えるときは表の行を直す。
 */

/**
 * 残っている使用回数。
 *
 * 定義が回数を持たない品は常に1で、使えば無くなる。回数のある薬だけが、
 * 使ったあとも残量を抱えて鞄に残る。
 */
export function itemCharges(item: { definitionId: string; chargesLeft?: number }): number {
  const total = MERCHANT_ITEM_DEFINITIONS[item.definitionId]?.charges ?? 1;
  return Math.max(0, Math.floor(item.chargesLeft ?? total));
}

/** 満タンに対する残量の割合。使いかけの薬は、そのぶん安い。 */
export function itemChargeRatio(item: { definitionId: string; chargesLeft?: number }): number {
  const total = Math.max(1, MERCHANT_ITEM_DEFINITIONS[item.definitionId]?.charges ?? 1);
  if (total <= 1) return 1;
  return Math.min(1, Math.max(0, itemCharges(item) / total));
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
  E: { rank: "E", escortFee: 150, baseHp: 10, baseDamage: 3, recommendedFloor: 3 },
  D: { rank: "D", escortFee: 400, baseHp: 15, baseDamage: 4, recommendedFloor: 6 },
  C: { rank: "C", escortFee: 1000, baseHp: 21, baseDamage: 6, recommendedFloor: 12 },
  B: { rank: "B", escortFee: 2000, baseHp: 29, baseDamage: 8, recommendedFloor: 20 },
  A: { rank: "A", escortFee: 3500, baseHp: 40, baseDamage: 11, recommendedFloor: 27 },
};

export const ADVENTURER_RANK_ORDER: readonly AdventurerRank[] = ["E", "D", "C", "B", "A"];


export const NPC_SEEDS: readonly NpcSeed[] = [
  { id: "mina", name: "ミナ", profession: "scout", appearanceId: "profession.adventurer.scout.01", adventurer: true, rank: "E", interests: ["medicine", "armor"], budget: 350, baseFee: 150, maxHp: 10, damage: 3, retreatHpRatio: 0.5 },
  { id: "toma", name: "トーマ", profession: "swordsman", appearanceId: "profession.adventurer.swordsman.01", adventurer: true, rank: "E", interests: ["weapon", "armor"], budget: 380, baseFee: 150, maxHp: 13, damage: 4, retreatHpRatio: 0.35 },
  { id: "lise", name: "リーゼ", profession: "scout", appearanceId: "profession.adventurer.scout.01", adventurer: true, rank: "E", interests: ["medicine", "armor"], budget: 420, baseFee: 150, maxHp: 11, damage: 3, retreatHpRatio: 0.45 },
  { id: "rolf", name: "ロルフ", profession: "swordsman", appearanceId: "profession.adventurer.swordsman.01", adventurer: true, rank: "D", interests: ["weapon", "armor"], budget: 900, baseFee: 400, maxHp: 16, damage: 4, retreatHpRatio: 0.3 },
  { id: "juno", name: "ユーノ", profession: "mercenary", appearanceId: "profession.adventurer.mercenary.01", adventurer: true, rank: "D", interests: ["weapon", "medicine"], budget: 950, baseFee: 400, maxHp: 14, damage: 5, retreatHpRatio: 0.4 },
  { id: "bastian", name: "バスティアン", profession: "mercenary", appearanceId: "profession.adventurer.mercenary.01", adventurer: true, rank: "C", interests: ["weapon", "medicine"], budget: 2100, baseFee: 1000, maxHp: 22, damage: 7, retreatHpRatio: 0.2 },
  { id: "kael", name: "カイル", profession: "swordsman", appearanceId: "profession.adventurer.swordsman.01", adventurer: true, rank: "C", interests: ["armor", "weapon"], budget: 2200, baseFee: 1000, maxHp: 25, damage: 6, retreatHpRatio: 0.3 },
  { id: "freya", name: "フレイヤ", profession: "scout", appearanceId: "profession.adventurer.scout.01", adventurer: true, rank: "B", interests: ["medicine", "armor"], budget: 4200, baseFee: 2000, maxHp: 30, damage: 9, retreatHpRatio: 0.35 },
  { id: "doran", name: "ドラン", profession: "swordsman", appearanceId: "profession.adventurer.swordsman.01", adventurer: true, rank: "B", interests: ["weapon", "armor"], budget: 4400, baseFee: 2000, maxHp: 34, damage: 8, retreatHpRatio: 0.25 },
  { id: "astrid", name: "アストリッド", profession: "mercenary", appearanceId: "profession.adventurer.mercenary.01", adventurer: true, rank: "A", interests: ["weapon", "armor"], budget: 7200, baseFee: 3500, maxHp: 44, damage: 12, retreatHpRatio: 0.2 },
  { id: "mira", name: "ミラ", profession: "merchant", appearanceId: "profession.merchant.01", adventurer: false, interests: ["material", "curio"], budget: 8000 },
  { id: "godwin", name: "ゴドウィン", profession: "blacksmith", appearanceId: "profession.blacksmith.01", adventurer: false, interests: ["material"], budget: 3000 },
  { id: "neva", name: "ネヴァ", profession: "apothecary", appearanceId: "profession.apothecary.01", adventurer: false, interests: ["material"], budget: 2000 },
  { id: "roden", name: "ローデン", profession: "noble", appearanceId: "profession.noble.01", adventurer: false, interests: ["gem", "curio"], budget: 12000 },
  { id: "rina", name: "リナ", profession: "townsperson", appearanceId: "profession.townsperson.01", adventurer: false, interests: ["medicine"], budget: 400 },
  // 迷宮へ行けない者たちが、素材と珍しいものの買い手になる。
  { id: "ilva", name: "イルヴァ", profession: "alchemist", appearanceId: "profession.alchemist.01", adventurer: false, interests: ["material", "arcane"], budget: 2600 },
  { id: "sedric", name: "セドリック", profession: "mage", appearanceId: "profession.mage.01", adventurer: false, interests: ["arcane", "book"], budget: 3400 },
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
  // 新しい職業の見た目は、いまは既存の絵を流用している。差し替えるときは
  // この対応表だけを変える —— セーブが持つのは appearanceId であって画像名ではない。
  "profession.alchemist.01": "legacy.npc.mage",
  "profession.mage.01": "legacy.npc.mage",
  "profession.collector.01": "legacy.npc.trader",
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
