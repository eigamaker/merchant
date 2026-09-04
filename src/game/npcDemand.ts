import { MERCHANT_ITEM_DEFINITIONS } from "./merchantContent";
import type { ItemInstance, NpcProfession, NpcRecord } from "./types";

/**
 * 誰が、なぜ買うのか。
 *
 * 以前は `interests`（欲しい種類の一覧）と `budget`（財布）の二つだけで需要を表していた。
 * その結果、町人が迷宮の武器を欲しがり、鍛冶が自分で打つはずの剣を買い、薬師が薬を買う
 * ことになっていた。**値段を決める前に、欲しがる理由を決める。**
 *
 * 理由は五つある。そして二つは種類では表せない —— **転売は「全部」買うし、蒐集が見ている
 * のは種類ではなく「その一点であること」**（一品物か、銘を得たか）だからである。だから
 * `ItemCategory` に需要を混ぜず、別の軸として置く。
 */
export type DemandKind =
  /** 実用。自分が使う。冒険者。 */
  | "use"
  /** 転売。仕入れて売る。安くしか買わないが、種類を選ばず、いくらでも買う。 */
  | "resale"
  /** 材料。素材だけを、継続して。職人はむしろ売る側でもある。 */
  | "material"
  /** 蒐集。一品物と由来のある品。性能は問わない。同じものは二つ要らない。 */
  | "collection"
  /** 生活。薬だけ。迷宮の品は買わない。 */
  | "daily";

/** 職業が決まれば、買う理由も決まる。個別に上書きしたいときだけ `NpcRecord.demand` を持たせる。 */
export const DEMAND_BY_PROFESSION: Record<NpcProfession, DemandKind> = {
  swordsman: "use",
  scout: "use",
  mercenary: "use",
  merchant: "resale",
  blacksmith: "material",
  apothecary: "material",
  alchemist: "material",
  mage: "material",
  noble: "collection",
  collector: "collection",
  townsperson: "daily",
};

export function demandFor(npc: NpcRecord): DemandKind {
  return npc.demand ?? DEMAND_BY_PROFESSION[npc.profession] ?? "daily";
}

/** 実用の対象。冒険者が迷宮へ担いでいくもの。 */
const USABLE = new Set(["weapon", "armor", "medicine"]);
/** 材料の対象。職人が仕入れて何かに変えるもの。 */
const RAW = new Set(["material", "arcane", "book"]);

/**
 * 蒐集の対象。
 *
 * **種類ではなく、その一点であることが値になる。** 英雄が担いだ鉄の剣は、鉄の剣ではなく
 * 「深淵踏みの鉄剣」として買われる。
 */
export function isCollectable(item: ItemInstance): boolean {
  if (item.singular) return true;
  if (item.currentName) return true;
  if ((item.deeds?.stage ?? 0) > 0) return true;
  const category = MERCHANT_ITEM_DEFINITIONS[item.definitionId]?.category;
  return category === "gem" || category === "art" || category === "relic" || category === "curio";
}

/** 転売業が出せる上限。仕入れて売る以上、相場より上は決して出さない。 */
export const RESALE_RATE = 0.6;

/**
 * その人がその品に出す額の、定価に対する倍率。**0なら買わない。**
 *
 * 蒐集だけ倍率が跳ねるのは、他に買い手がいないからである。実用の相手は代わりを
 * よそでも買えるが、一品物には代わりが無い。
 */
export function demandMultiplier(npc: NpcRecord, item: ItemInstance): number {
  const definition = MERCHANT_ITEM_DEFINITIONS[item.definitionId];
  if (!definition) return 0;
  const category = definition.category;
  const interested = npc.interests.includes(category);
  switch (demandFor(npc)) {
    case "use":
      // 迷宮へ担いでいくものだけ。しかも探している種類だけ ——
      // **要らない品は何倍だろうと要らない。**
      return USABLE.has(category) && interested ? 1.3 : 0;
    case "resale":
      // 何でも買う。ただし相場の6割より上は出さない。
      return RESALE_RATE;
    case "material":
      return RAW.has(category) && interested ? 1 : 0;
    case "collection":
      if (!isCollectable(item)) return 0;
      if (item.singular) return 4;
      if (item.currentName || (item.deeds?.stage ?? 0) > 0) return 2.5;
      return 1.6;
    case "daily":
      // 迷宮の品は買わない。町で使うものだけ。
      return category === "medicine" ? 0.9 : 0;
  }
}

/** その人がその品を買う気があるか。 */
export function wantsItem(npc: NpcRecord, item: ItemInstance): boolean {
  return demandMultiplier(npc, item) > 0;
}

/** 画面に一行で出す、その人が何を求めているか。 */
export function demandLabel(kind: DemandKind): string {
  switch (kind) {
    case "use": return "使うために買う";
    case "resale": return "仕入れて売る";
    case "material": return "素材を仕入れる";
    case "collection": return "珍しいものを集める";
    case "daily": return "暮らしに要るものだけ";
  }
}
