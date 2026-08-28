import { MERCHANT_ITEM_DEFINITIONS } from "./merchantContent";
import type { GuardPersonality, ItemInstance, NpcRecord } from "./types";

/**
 * 値付け。
 *
 * 店と迷宮では商いの意味がまるで違う。
 *
 * **店**では高値は通らない。客はよそでも買えるからで、相場を大きく超えれば
 * 恨まれるのではなく、ただ「よそで買う」と言って帰る。店で稼ぐのは幅ではなく数である。
 *
 * **迷宮**では他に店がない。傷ついた冒険者の前で回復薬を握っているのは商人だけで、
 * 定価の5倍でも10倍でも提案が成り立つ。ただし成り立つのは相手が本当に困っているときだけで、
 * 要らない物は何倍でも要らない。そして足元を見たことは、相手の性格しだいで恨みにも敬意にもなる。
 */

/** 店頭でこれを超えると客は「よそで買う」と言う。その客の上限に対する倍率。 */
export const SHOP_WALKAWAY = 1.15;
/**
 * 値切られたときに客が出す額。上限より下を言うのは、主導権が客にあるからである。
 * 吹っかけて値切らせるより、初めから通る値を付けたほうが得になる。
 */
export const HAGGLE_RATE = 0.85;
/** 迷宮で提案できる上限。定価に対する倍率。 */
export const DUNGEON_PRICE_CEILING = 10;
/** これを超える上乗せから「足元を見た」商いになる。 */
export const GOUGE_THRESHOLD = 1.5;

/** 品そのものの相場。由来のある品はそのぶん高い。客ごとの事情は含まない。 */
export function marketPrice(item: ItemInstance): number {
  const definition = MERCHANT_ITEM_DEFINITIONS[item.definitionId];
  if (!definition) return 1;
  const notable = (item.historyV2 ?? [])
    .filter((event) => event.type === "ownerDied" || event.type === "named" || event.type === "lootedFromCorpse").length;
  const cap = (item.deeds?.ownersLost ?? 0) > 0 ? 1 : 0.5;
  return Math.max(1, Math.round(definition.baseValue * (1 + Math.min(cap, notable * 0.05))));
}

/** 店頭に並べる値の候補。相場を中心に、下は捌くため、上は欲張るため。 */
export const SHOP_PRICE_TIERS = [
  { label: "捨て値", rate: 0.6 },
  { label: "安値", rate: 0.8 },
  { label: "相場", rate: 1 },
  { label: "強気", rate: 1.15 },
  { label: "吹っかけ", rate: 1.4 },
] as const;

/** 迷宮で提案できる値。他に店がないので、上は桁で変わる。 */
export const DUNGEON_PRICE_TIERS = [
  { label: "相場どおり", rate: 1 },
  { label: "運び賃を乗せる", rate: 2 },
  { label: "足元を見る", rate: 3 },
  { label: "命の値段", rate: 5 },
  { label: "強欲", rate: DUNGEON_PRICE_CEILING },
] as const;

export type ShopReaction = "buy" | "haggle" | "refuse";

export interface ShopVerdict {
  reaction: ShopReaction;
  /** 実際に動く金額。値切りならこちらが客の言い値。 */
  price: number;
  line: string;
}

/**
 * 客が付け値をどう受け取るか。
 *
 * `limit` はその客がその品に出せる上限（興味・関係・由来・所持金を織り込んだもの）。
 * 上限の内側なら買い、少し超えるなら値切り、大きく超えれば帰る。
 */
export function shopVerdict(npc: NpcRecord, asking: number, limit: number): ShopVerdict {
  const name = npc.name;
  if (asking <= limit) {
    const bargain = asking <= limit * 0.75;
    return { reaction: "buy", price: asking, line: bargain ? `${name}「これはありがたい。もらっていこう」` : `${name}「その値なら、いただこう」` };
  }
  if (asking <= limit * SHOP_WALKAWAY) {
    // 高いと分かっている品の前では、客のほうが強い。上限をそのまま出しはしない。
    const counter = Math.max(1, Math.floor(limit * HAGGLE_RATE));
    return { reaction: "haggle", price: counter, line: `${name}「高いな。${counter}Gなら出す」` };
  }
  return { reaction: "refuse", price: 0, line: `${name}「その値では買えない。よそをあたる」` };
}

export type DungeonSentiment = "grateful" | "fair" | "indifferent" | "resented";

export interface DungeonVerdict {
  reaction: "buy" | "refuse";
  sentiment: DungeonSentiment;
  line: string;
}

/**
 * 足元を見た商いを、相手がどう飲み込むか。
 *
 * 命の重さを知っている冒険者ほど、高値を当然として受け取る —— 危ないところまで
 * 品を担いできた者がいなければ、自分は死んでいたからである。
 * 逆に自分が強欲な者は、出し抜かれたと感じて恨む。どちらでもない者は、ただ払って忘れる。
 */
export function gougeSentiment(personality: GuardPersonality | undefined, markup: number, desperate: boolean): DungeonSentiment {
  if (markup < GOUGE_THRESHOLD) return "fair";
  if (!personality) return "indifferent";
  const professional = personality.discipline * 0.5 + personality.integrity * 0.5;
  if (desperate && professional >= 60) return "grateful";
  if (personality.greed >= 60 || personality.integrity <= 35) return "resented";
  return "indifferent";
}

/**
 * 迷宮での提案に冒険者が応じるか。
 *
 * 要らない品は何倍だろうと要らない。倍率がものを言うのは、本当に困っているときだけである。
 */
export function dungeonVerdict(
  npc: NpcRecord,
  asking: number,
  baseline: number,
  gold: number,
  desperate: boolean,
  personality?: GuardPersonality,
): DungeonVerdict {
  const markup = asking / Math.max(1, baseline);
  const sentiment = gougeSentiment(personality, markup, desperate);
  if (asking > gold) {
    return { reaction: "refuse", sentiment: "fair", line: `${npc.name}「その額は持っていない」` };
  }
  // 困っていない相手は、上乗せに付き合わない。
  const tolerance = desperate ? DUNGEON_PRICE_CEILING : 1.2 + (personality ? (100 - personality.greed) / 100 : 0.3);
  if (markup > tolerance) {
    return {
      reaction: "refuse",
      sentiment: "fair",
      line: desperate ? `${npc.name}「足元を見るにも程がある」` : `${npc.name}「その値を出すほど困ってはいない」`,
    };
  }
  const line = sentiment === "grateful"
    ? `${npc.name}「高い。だがここまで担いできたのはあんただ」`
    : sentiment === "resented"
      ? `${npc.name}「……覚えておく」`
      : sentiment === "indifferent"
        ? `${npc.name}「足元を見たな。まあいい、払おう」`
        : `${npc.name}「助かる。もらっていこう」`;
  return { reaction: "buy", sentiment, line };
}
