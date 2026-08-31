import { NPC_SEEDS } from "./merchantContent";
import type {
  GameState,
  GuardArchetype,
  GuardCareer,
  GuardCareerEvent,
  GuardCareerEventType,
  GuardPersonality,
  GuardProfile,
  NpcRecord,
} from "./types";

/** 台本のある冒険者。生成された名簿の冒険者と配分規則を分ける。 */
const SEED_ADVENTURER_IDS: ReadonlySet<string> = new Set(NPC_SEEDS.filter((seed) => seed.adventurer).map((seed) => seed.id));

const ARCHETYPES: Record<GuardArchetype, Omit<GuardPersonality, "archetype">> = {
  steadfast: { courage: 75, discipline: 80, empathy: 75, integrity: 85, greed: 25 },
  cautious: { courage: 30, discipline: 80, empathy: 60, integrity: 75, greed: 30 },
  bold: { courage: 85, discipline: 45, empathy: 50, integrity: 55, greed: 55 },
  mercenary: { courage: 60, discipline: 65, empathy: 35, integrity: 50, greed: 85 },
  compassionate: { courage: 55, discipline: 55, empathy: 90, integrity: 80, greed: 20 },
};

const BALANCED_ARCHETYPES: GuardArchetype[] = [
  "steadfast", "steadfast",
  "cautious", "cautious",
  "bold", "bold",
  "mercenary", "mercenary",
  "compassionate", "compassionate",
];

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}

const clamp = (value: number, minimum = 0, maximum = 100): number => Math.max(minimum, Math.min(maximum, Math.round(value)));

function emptyCareer(): GuardCareer {
  return {
    hireCount: 0,
    successfulReturns: 0,
    deepestFloor: 0,
    enemiesDefeated: 0,
    damageCovered: 0,
    retreatCount: 0,
    warningsIgnored: 0,
    earlyDepartures: 0,
    abandonCount: 0,
    extortionCount: 0,
    betrayalCount: 0,
    soloDelves: 0,
    soloDeepest: 0,
    events: [],
  };
}

function jitter(campaignId: string, npcId: string, axis: keyof Omit<GuardPersonality, "archetype">): number {
  return hash(`${campaignId}:${npcId}:guard:${axis}`) % 21 - 10;
}

function personality(campaignId: string, npcId: string, archetype: GuardArchetype): GuardPersonality {
  const base = ARCHETYPES[archetype];
  return {
    archetype,
    courage: clamp(base.courage + jitter(campaignId, npcId, "courage")),
    discipline: clamp(base.discipline + jitter(campaignId, npcId, "discipline")),
    empathy: clamp(base.empathy + jitter(campaignId, npcId, "empathy")),
    integrity: clamp(base.integrity + jitter(campaignId, npcId, "integrity")),
    greed: clamp(base.greed + jitter(campaignId, npcId, "greed")),
  };
}

function normalizeProfile(profile: GuardProfile): GuardProfile {
  profile.trust = clamp(profile.trust ?? 20);
  profile.stress = clamp(profile.stress ?? 0);
  profile.career ??= emptyCareer();
  const career = profile.career;
  career.hireCount ??= 0;
  career.successfulReturns ??= 0;
  career.deepestFloor ??= 0;
  career.enemiesDefeated ??= 0;
  career.damageCovered ??= 0;
  career.retreatCount ??= 0;
  career.warningsIgnored ??= 0;
  career.earlyDepartures ??= 0;
  career.abandonCount ??= 0;
  career.extortionCount ??= 0;
  career.betrayalCount ??= 0;
  career.soloDelves ??= 0;
  career.soloDeepest ??= 0;
  career.events = (career.events ?? []).slice(-32);
  return profile;
}

export function createGuardProfile(campaignId: string, npcId: string, archetype?: GuardArchetype): GuardProfile {
  const selected = archetype ?? BALANCED_ARCHETYPES[hash(`${campaignId}:${npcId}:guard-archetype`) % BALANCED_ARCHETYPES.length]!;
  return { personality: personality(campaignId, npcId, selected), trust: 20, stress: 0, career: emptyCareer() };
}

/**
 * 台本のある10人にだけ、原型を均等に配る。
 *
 * 生成された名簿の冒険者まで均等配分に混ぜると、作り込んだ配役の偏りが薄まる。
 * それ以外はハッシュで原型を引く。
 */
export function initializeGuardProfiles(state: GameState): void {
  const townAdventurers = state.npcs
    .filter((npc) => npc.adventurer && SEED_ADVENTURER_IDS.has(npc.id))
    .sort((a, b) => hash(`${state.campaignId}:guard-order:${a.id}`) - hash(`${state.campaignId}:guard-order:${b.id}`));
  townAdventurers.forEach((npc, index) => {
    npc.guardProfile = npc.guardProfile
      ? normalizeProfile(npc.guardProfile)
      : createGuardProfile(state.campaignId, npc.id, BALANCED_ARCHETYPES[index % BALANCED_ARCHETYPES.length]);
  });
  for (const npc of state.npcs.filter((entry) => entry.adventurer && !entry.guardProfile)) {
    npc.guardProfile = createGuardProfile(state.campaignId, npc.id);
  }
}

export function ensureGuardProfile(state: GameState, npc: NpcRecord): GuardProfile {
  npc.guardProfile ??= createGuardProfile(state.campaignId, npc.id);
  return normalizeProfile(npc.guardProfile);
}

export function adjustGuardProfile(profile: GuardProfile, trustDelta = 0, stressDelta = 0): void {
  profile.trust = clamp(profile.trust + trustDelta);
  profile.stress = clamp(profile.stress + stressDelta);
}

export function recordGuardEvent(
  state: GameState,
  npc: NpcRecord,
  type: GuardCareerEventType,
  detail: string,
  floor?: number,
): GuardCareerEvent {
  const profile = ensureGuardProfile(state, npc);
  const event: GuardCareerEvent = { day: state.day, type, detail, ...(floor === undefined ? {} : { floor }) };
  profile.career.events.push(event);
  if (profile.career.events.length > 32) profile.career.events.splice(0, profile.career.events.length - 32);
  return event;
}

/**
 * 深手を負ったとき、その人が何を選ぶか。
 *
 * 逃げるのが正しい。護衛が退かなければ、次に死ぬのはその護衛自身である。
 * だから踏みとどまるのは合理ではなく人柄で、置いて逃げるのも人柄である。
 *
 * 二つの軸で決める。**献身**は「退くべき場面で残るか」、**忠義**は「契約を破って
 * 迷宮を出るか」。性格が主で、信頼はどちらの軸も押すが、原型の天井は越えない ——
 * 強欲な傭兵は信頼を尽くしても死んではくれず、共感の深い者は信頼が無くても置き去りにしない。
 */
export type GuardStand = "hold" | "retreat" | "flee";

/** これ以上なら、自分の傷を無視して主人の前に立ち続ける。 */
export const DEVOTION_HOLD = 58;
/** これを下回ると、契約を捨てて迷宮を出る。 */
export const LOYALTY_FLEE = 22;

export function guardDevotion(profile: GuardProfile): number {
  const { empathy, courage } = profile.personality;
  return empathy * 0.55 + courage * 0.2 + profile.trust * 0.25 - profile.stress * 0.25;
}

export function guardLoyalty(profile: GuardProfile): number {
  const { integrity, discipline, greed } = profile.personality;
  return integrity * 0.5 + discipline * 0.2 + profile.trust * 0.3 - greed * 0.35 - profile.stress * 0.2;
}

export function guardStand(profile: GuardProfile): GuardStand {
  if (guardDevotion(profile) >= DEVOTION_HOLD) return "hold";
  if (guardLoyalty(profile) < LOYALTY_FLEE) return "flee";
  return "retreat";
}

export function guardTrustLabel(trust: number): string {
  if (trust < 20) return "よそよそしい";
  if (trust < 40) return "仕事仲間";
  if (trust < 60) return "慣れている";
  if (trust < 80) return "信頼している";
  return "固い絆";
}

export function guardConditionLabel(stress: number): string {
  if (stress < 20) return "落ち着いている";
  if (stress < 45) return "少し緊張している";
  if (stress < 70) return "神経を尖らせている";
  return "ひどく消耗している";
}

const band = (value: number, low: string, middle: string, high: string): string => value <= 35 ? low : value >= 65 ? high : middle;

export function guardObservationLines(npc: NpcRecord): string[] {
  const profile = npc.guardProfile;
  if (!profile) return [];
  const { hireCount } = profile.career;
  const lines: string[] = [];
  if (hireCount >= 1) lines.push(band(profile.personality.courage, "危険にはかなり慎重だ。", "危険と報酬を見比べる。", "危険を前にしても踏みとどまる。"));
  if (hireCount >= 3) {
    lines.push(band(profile.personality.discipline, "戦い方は直感的だ。", "状況に応じて標的を変える。", "脅威の高い敵を冷静に見極める。"));
    lines.push(band(profile.personality.empathy, "まず自分の生還を優先する。", "契約どおりに主人を守る。", "主人の危機には無理をしがちだ。"));
  }
  if (hireCount >= 5) {
    lines.push(band(profile.personality.integrity, "約束には用心が必要そうだ。", "契約内容には忠実だ。", "交わした約束を重く見る。"));
    lines.push(band(profile.personality.greed, "報酬より仕事を重く見る。", "相応の報酬を求める。", "実入りにはかなり敏感だ。"));
    // 深手を負ったときに何を選ぶかは、5回いっしょに潜って初めて見当がつく。
    const stand = guardStand(profile);
    lines.push(stand === "hold"
      ? "追い詰められても、あなたの前から動かないだろう。"
      : stand === "flee"
        ? "危うくなれば、ひとりで出口へ向かうかもしれない。"
        : "退き際はわきまえている。下がっても、また前に出る。");
  }
  return lines;
}

