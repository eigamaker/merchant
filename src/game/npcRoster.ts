import { ADVENTURER_RANKS, ADVENTURER_RANK_ORDER, NPC_SEEDS } from "./merchantContent";
import { npcActorIds } from "./actorCatalog";
import { ensureGuardProfile } from "./guardProfiles";
import { generateNpcName } from "./npcNames";
import type { AdventurerRank, GameState, NpcProfession, NpcRecord, NpcStatus } from "./types";

/**
 * 冒険者は全員が同じ名簿に載る。町の客であり、迷宮で行き合う相手であり、雇える護衛でもある。
 *
 * 以前は階を作るたびに使い捨ての冒険者を鋳造していた。人物を階の持ち物にすると、
 * 帰還と同時に消えてしまい、二度と会えない。名簿が人を持ち、階はその日の予定を借りる。
 */

/** 生きている冒険者の目標人数。毎日およそ三分の一が潜っても、町に客が残る規模。 */
export const ADVENTURER_ROSTER_TARGET = 30;

/** ギルドの人数構成。低ランクほど多い。 */
export const ROSTER_RANK_SHAPE: Record<AdventurerRank, number> = { E: 10, D: 8, C: 6, B: 4, A: 2 };

const ADVENTURER_PROFESSIONS: readonly NpcProfession[] = ["swordsman", "scout", "mercenary"];

/**
 * The face a generated adventurer wears.
 *
 * It used to be inherited from whichever seed shared the profession, which put
 * roughly twenty people the author never wrote into three borrowed sprites. Now
 * it comes from the sheets marked `adventurer` in the character settings, so
 * everyone met in the dungeon is wearing something that was chosen for the job.
 * With nothing marked, the seed's appearance is still the sensible fallback.
 */
function adventurerAppearanceId(seedAppearanceId: string, key: string): string {
  const pool = npcActorIds("adventurer");
  return pool.length ? pool[hash(key) % pool.length]! : seedAppearanceId;
}

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}

export interface RosterAdventurerOptions {
  rank: AdventurerRank;
  /** 町へ来る前から名の知れた冒険者。実績を先に持ち、護衛料が高い。 */
  famous?: boolean;
  status?: NpcStatus;
}

/**
 * 名簿に一人加える。
 *
 * 能力の導き方は旧 `createGeneratedAdventurer` をそのまま引き継ぐ。違うのは起点だけで、
 * 「何階に出るか」ではなく「どのランクか」から作る。名簿の人物は階に属さないため。
 */
export function createRosterAdventurer(state: GameState, options: RosterAdventurerOptions): NpcRecord {
  const serial = state.nextNpcId++;
  const taken = new Set(state.npcs.map((npc) => npc.name));
  const name = generateNpcName(state.campaignId, serial, taken);
  const profession = ADVENTURER_PROFESSIONS[hash(`${name}:${options.rank}`) % ADVENTURER_PROFESSIONS.length]!;
  const template = NPC_SEEDS.find((npc) => npc.profession === profession)!;
  const rankStats = ADVENTURER_RANKS[options.rank];
  const variation = hash(`${state.campaignId}:${name}:${options.rank}:stats`);
  const npc: NpcRecord = {
    ...template,
    id: `adventurer-${serial}`,
    name,
    appearanceId: adventurerAppearanceId(template.appearanceId, `${state.campaignId}:${name}:appearance`),
    rank: options.rank,
    baseFee: rankStats.escortFee,
    maxHp: rankStats.baseHp + variation % 4,
    damage: rankStats.baseDamage + Math.floor(variation / 7) % 2,
    retreatHpRatio: profession === "scout" ? 0.45 : 0.25 + (variation % 2) * 0.05,
    budget: rankStats.escortFee * 2 + variation % 151,
    status: options.status ?? "inTown",
    relation: 0,
    interests: [...template.interests],
    inventoryIds: [],
  };
  if (options.famous) npc.famous = true;
  const profile = ensureGuardProfile(state, npc);
  npc.guardProfile = profile;
  if (options.famous) {
    // 噂が先に立っている相手。雇う前から実績があり、escortFeeForNpc の実績プレミアムが乗る。
    profile.career.successfulReturns = 4 + variation % 6;
    profile.career.deepestFloor = 6 + variation % 3;
    profile.career.enemiesDefeated = 20 + variation % 40;
    profile.career.soloDelves = profile.career.successfulReturns * 3;
    profile.career.soloDeepest = profile.career.deepestFloor;
  }
  state.npcs.push(npc);
  return npc;
}

/** いま生きている冒険者を、ランクごとに数える。 */
export function livingAdventurersByRank(state: GameState): Record<AdventurerRank, number> {
  const counts: Record<AdventurerRank, number> = { E: 0, D: 0, C: 0, B: 0, A: 0 };
  for (const npc of state.npcs) {
    if (!npc.adventurer || npc.status === "dead") continue;
    counts[npc.rank ?? "E"] += 1;
  }
  return counts;
}

/** 最も手薄なランク。新人の補充先を決めるのに使う。 */
export function thinnestRank(state: GameState): AdventurerRank {
  const counts = livingAdventurersByRank(state);
  return [...ADVENTURER_RANK_ORDER].sort((a, b) =>
    (counts[a] - ROSTER_RANK_SHAPE[a]) - (counts[b] - ROSTER_RANK_SHAPE[b]) || ADVENTURER_RANK_ORDER.indexOf(a) - ADVENTURER_RANK_ORDER.indexOf(b),
  )[0]!;
}

/**
 * 名簿を目標の構成まで満たす。
 *
 * 新規キャンペーンでも、15人しかいなかった旧セーブの読み込みでも同じ関数を通す。
 * 台本のある10人はそのまま数に含め、足りない分だけを生成する。
 */
export function ensureRosterPopulation(state: GameState): void {
  const counts = livingAdventurersByRank(state);
  for (const rank of ADVENTURER_RANK_ORDER) {
    for (let missing = ROSTER_RANK_SHAPE[rank] - counts[rank]; missing > 0; missing -= 1) {
      createRosterAdventurer(state, { rank });
    }
  }
}

/**
 * 初日から町を動かしておく。
 *
 * 全員が店先に並んでいる状態で始まると、迷宮で誰にも会わない一日目になってしまう。
 * ただし台本のある15人は町に残す。最初の護衛選びで顔ぶれが欠けていると戸惑うため。
 */
export function seedOpeningRosterActivity(state: GameState): void {
  const seedIds = new Set(NPC_SEEDS.map((seed) => seed.id));
  const candidates = state.npcs
    .filter((npc) => npc.adventurer && npc.status === "inTown" && !seedIds.has(npc.id))
    .sort((a, b) => hash(`${state.campaignId}:opening:${a.id}`) - hash(`${state.campaignId}:opening:${b.id}`));
  candidates.slice(0, 5).forEach((npc, index) => {
    npc.status = "delving";
    npc.delve = { floor: 1 + (hash(`${state.campaignId}:opening-floor:${npc.id}`) % 3), departedDay: state.day };
    if (index >= 3) {
      npc.status = "recovering";
      npc.conditionHp = Math.max(1, Math.floor((npc.maxHp ?? 10) * 0.4));
      delete npc.delve;
    }
  });
  state.lastSimulatedDay = state.day;
}
