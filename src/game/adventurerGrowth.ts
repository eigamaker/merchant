import { ADVENTURER_RANKS, ADVENTURER_RANK_ORDER } from "./merchantContent";
import type { AdventurerRank, GameState, GuardProfile, NpcRecord } from "./types";

/**
 * 冒険者が育つ。
 *
 * 商人が与えられるのは装備だけではない。深いところから何度も生きて帰れば、
 * 本人の素地も伸びる。伸びは次のランクの基準で頭打ちにしてあり、
 * その先へ行くには昇格するしかない —— 昇格に意味を持たせるための蓋である。
 */

/** そのランクを抜けるのに要る「生きて帰った回数」。 */
export const PROMOTION_TALLY: Record<AdventurerRank, number> = { E: 4, D: 8, C: 14, B: 22, A: Number.POSITIVE_INFINITY };

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}

export function nextRank(rank: AdventurerRank): AdventurerRank | undefined {
  const index = ADVENTURER_RANK_ORDER.indexOf(rank);
  return index >= 0 ? ADVENTURER_RANK_ORDER[index + 1] : undefined;
}

/** そのランクで許される上限。次のランクの基準を少しだけ超えられる。 */
export function growthCap(rank: AdventurerRank): { maxHp: number; damage: number } {
  const above = nextRank(rank);
  const bounds = ADVENTURER_RANKS[above ?? rank];
  return { maxHp: bounds.baseHp + 4, damage: bounds.baseDamage + 2 };
}

/** 生きて帰った総数。護衛としても、自分の探索でも数える。 */
export function survivalTally(profile: GuardProfile): number {
  return profile.career.successfulReturns + profile.career.soloDelves;
}

export function readyForPromotion(npc: NpcRecord, profile: GuardProfile): boolean {
  const rank = npc.rank ?? "E";
  if (!nextRank(rank)) return false;
  const deepest = Math.max(profile.career.deepestFloor, profile.career.soloDeepest);
  return survivalTally(profile) >= PROMOTION_TALLY[rank]
    && deepest >= ADVENTURER_RANKS[rank].recommendedFloor + 1;
}

export interface GrowthResult {
  hp: number;
  damage: number;
  promotedTo?: AdventurerRank;
}

/**
 * 推奨階以上から生きて帰った一度分の成長。
 *
 * 浅いところを往復しても伸びない。危ないところから帰ってきたことだけが身になる。
 */
export function applySurvivalGrowth(state: GameState, npc: NpcRecord, profile: GuardProfile, floor: number): GrowthResult {
  const rank = npc.rank ?? "E";
  const result: GrowthResult = { hp: 0, damage: 0 };
  if (floor < ADVENTURER_RANKS[rank].recommendedFloor) return result;

  const cap = growthCap(rank);
  const tally = survivalTally(profile);
  if ((npc.maxHp ?? 0) < cap.maxHp && hash(`${state.campaignId}:${state.day}:${npc.id}:growth`) % 2 === 0) {
    npc.maxHp = (npc.maxHp ?? 0) + 1;
    result.hp = 1;
  }
  if (tally > 0 && tally % 4 === 0 && (npc.damage ?? 0) < cap.damage) {
    npc.damage = (npc.damage ?? 0) + 1;
    result.damage = 1;
  }

  if (readyForPromotion(npc, profile)) {
    const promoted = nextRank(rank)!;
    const bounds = ADVENTURER_RANKS[promoted];
    npc.rank = promoted;
    npc.baseFee = bounds.escortFee;
    npc.maxHp = Math.max(npc.maxHp ?? 0, bounds.baseHp);
    npc.damage = Math.max(npc.damage ?? 0, bounds.baseDamage);
    result.promotedTo = promoted;
    // 昇格は町の出来事として届く。育てた相手の値段が上がる理由でもある。
    state.events.push({
      id: `promoted-${npc.id}-${promoted}`,
      dueDay: state.day,
      text: `${npc.name}が${promoted}ランクへ昇格したと、ギルドの掲示にある。`,
    });
  }
  return result;
}
