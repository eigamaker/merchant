import { MERCHANT_ITEM_DEFINITIONS } from "./merchantContent";
import type { GameState, ItemDeeds, ItemInstance, NpcRecord } from "./types";

/**
 * 品が背負った物語から、銘を育てる。
 *
 * 銘は「種類」ではなく「その一本」に宿る。英雄が地下8階まで担いだただの鉄の剣は
 * 「深淵踏みの鉄剣」になる。物を唯一にするのは種類ではなく物語だからだ。
 *
 * `currentName` は `itemName` / `merchantItemName` の両方で最優先に読まれるので、
 * ここで名前を書き換えれば既存のUIはすべてそのまま銘で表示する。
 */

/** 詩的な接頭辞。稀少度が rare 以上の品に付く。 */
export const LEGEND_PREFIXES = [
  "黒風", "宵月", "灰冠", "影喰らい", "冬雷",
  "白牙", "紅蝕", "夜凪", "鉄霞", "遠雷",
] as const;

/** 深さで得る二つ名。 */
export const DEPTH_EPITHETS = ["深淵踏み", "底知らず", "奈落降り"] as const;
/** 数で得る二つ名。 */
export const KILL_EPITHETS = ["百戦", "血錆", "千手斬り"] as const;
/** 持ち主を喪って得る二つ名。 */
export const LOSS_EPITHETS = ["骸戻り", "遺され", "手向け"] as const;

/** 段1で使う「◯◯の—」の名詞。 */
const LEGEND_NOUNS: Record<string, string> = {
  "iron-sword": "剣",
  "bronze-spear": "槍",
  "nameless-black-blade": "剣",
  "leather-armor": "鎧",
  "iron-helmet": "兜",
  "round-shield": "盾",
};

/** 素朴な系統が段2以降で背負う語幹。材質と形をそのまま詰める。 */
const LEGEND_STEMS: Record<string, string> = {
  "iron-sword": "鉄剣",
  "bronze-spear": "青銅槍",
  "leather-armor": "革鎧",
  "iron-helmet": "鉄兜",
  "round-shield": "円盾",
};

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}

const pick = <T>(pool: readonly T[], key: string): T => pool[hash(key) % pool.length]!;

export function emptyDeeds(): ItemDeeds {
  return { deepestFloor: 0, kills: 0, returns: 0, ownersLost: 0, stage: 0 };
}

export function itemDeeds(item: ItemInstance): ItemDeeds {
  item.deeds ??= emptyDeeds();
  return item.deeds;
}

/**
 * 功績が届いている段。
 *
 * 深さと数はどちらでも段を上げる。遺銘は「一度でも銘を得た品が持ち主を喪ったとき」だけ。
 * 無銘のまま誰かと共に失われた品は、ただの遺品であって形見ではない。
 */
export function legendStage(deeds: ItemDeeds): number {
  let stage = 0;
  if (deeds.deepestFloor >= 3 || deeds.kills >= 8) stage = 1;
  if (deeds.deepestFloor >= 6 || deeds.kills >= 25) stage = 2;
  if (stage >= 1 && deeds.ownersLost >= 1) stage = 3;
  return stage;
}

/** 詩的な系統か素朴な系統か。稀少な品ほど固有の語を得る。 */
function isPoetic(item: ItemInstance): boolean {
  const rarity = item.rarity ?? MERCHANT_ITEM_DEFINITIONS[item.definitionId]?.rarity ?? "common";
  return rarity === "rare" || rarity === "legendary" || rarity === "unique";
}

/** 段をまたいで変わらない語幹。段1で選んだ語をそのまま使い続ける。 */
export function legendStem(campaignId: string, item: ItemInstance): string {
  if (isPoetic(item)) return pick(LEGEND_PREFIXES, `${campaignId}:${item.uuid}:prefix`);
  return LEGEND_STEMS[item.definitionId] ?? MERCHANT_ITEM_DEFINITIONS[item.definitionId]?.trueName ?? "得物";
}

function epithetFor(campaignId: string, item: ItemInstance, deeds: ItemDeeds, stage: number): string {
  if (stage >= 3) return pick(LOSS_EPITHETS, `${campaignId}:${item.uuid}:loss`);
  const byDepth = deeds.deepestFloor >= 6;
  const pool = byDepth ? DEPTH_EPITHETS : KILL_EPITHETS;
  return pick(pool, `${campaignId}:${item.uuid}:epithet`);
}

/**
 * その段での名前。段0は定義の名前のままなので undefined を返す。
 *
 * 素朴な系統の段1は「鉄の剣」= 定義名と同じになるので、これも undefined。
 * ありふれた剣が最初の銘を得るのは、数ではなく深さにおいてである。
 */
export function legendName(campaignId: string, item: ItemInstance, deeds: ItemDeeds, stage: number): string | undefined {
  if (stage <= 0) return undefined;
  const stem = legendStem(campaignId, item);
  if (stage === 1) {
    if (!isPoetic(item)) return undefined;
    const noun = LEGEND_NOUNS[item.definitionId] ?? "得物";
    return `${stem}の${noun}`;
  }
  return `${epithetFor(campaignId, item, deeds, stage)}の${stem}`;
}

/**
 * 銘を打ち直す唯一の場所。
 *
 * 段が上がり、かつ実際に名前が変わるときだけ書き換え、履歴に一件積む。
 * `ItemHistoryEvent` は既に `name` を持つので、全段階がそのまま記録に残る。
 */
export function refreshItemLegend(state: GameState, item: ItemInstance, npc?: NpcRecord): boolean {
  const deeds = itemDeeds(item);
  const stage = legendStage(deeds);
  if (stage <= deeds.stage) return false;
  const name = legendName(state.campaignId, item, deeds, stage);
  deeds.stage = stage;
  if (!name || name === item.currentName) return false;
  item.currentName = name;
  item.namedByNpcId ??= npc?.id;
  // 銘が入った時点で、それが何であるかは誰の目にも分かる。
  item.knowledge = "identified";
  item.historyV2 ??= [];
  item.historyV2.push({
    day: state.day,
    type: "named",
    npcId: npc?.id ?? item.namedByNpcId ?? "",
    name,
    detail: npc ? `${npc.name}の手で銘を得た` : "銘を得た",
  });
  return true;
}

/** 店頭で買い手が名付ける、旧来の一点物の命名。段1を強いる。 */
export function assignCounterName(state: GameState, item: ItemInstance, npc: NpcRecord): void {
  if (!item.singular || item.currentName) return;
  const deeds = itemDeeds(item);
  const name = legendName(state.campaignId, item, deeds, 1);
  if (!name) return;
  deeds.stage = Math.max(deeds.stage, 1);
  item.currentName = name;
  item.namedByNpcId = npc.id;
  item.historyV2 ??= [];
  item.historyV2.push({ day: state.day, type: "named", npcId: npc.id, name, detail: `${npc.name}が命名` });
}

/**
 * 商人が預けた装備か。
 *
 * 功績は `recordGearDeed` でしか付かず、それは預かった装備にしか走らない。
 * だから功績の有無が、そのまま「これは自分が託した品だ」の印になる。
 */
export function wasEntrusted(item: ItemInstance): boolean {
  return item.deeds !== undefined;
}

/** インベントリ詳細に出す由来。最大3行。 */
export function itemLegendLines(state: GameState, item: ItemInstance): string[] {
  const deeds = item.deeds;
  if (!deeds || (deeds.stage === 0 && deeds.deepestFloor === 0 && deeds.kills === 0)) return [];
  const lines: string[] = [];
  if (item.currentName) lines.push(`銘: ${item.currentName}`);
  const carried: string[] = [];
  if (deeds.deepestFloor > 0) carried.push(`地下${deeds.deepestFloor}階まで担がれ`);
  if (deeds.kills > 0) carried.push(`${deeds.kills}体を退けた`);
  if (carried.length) lines.push(`${carried.join("、")}。`);
  const lost = (item.historyV2 ?? []).filter((event) => event.type === "ownerDied").at(-1);
  if (lost && "npcId" in lost) {
    const owner = state.npcs.find((npc) => npc.id === lost.npcId);
    lines.push(`第${lost.day}日、${owner ? owner.name : "持ち主"}と共に失われた。`);
  }
  return lines.slice(0, 3);
}
