import { ADVENTURER_RANKS, MERCHANT_ITEM_DEFINITIONS } from "./merchantContent";
import { adjustGuardProfile, ensureGuardProfile } from "./guardProfiles";
import { hasBond } from "./npcBonds";
import { recordCorpse } from "./dungeonCorpses";
import { ADVENTURER_ROSTER_TARGET, createRosterAdventurer, createTownsperson, thinnestRank } from "./npcRoster";
import { carriedGearItems, gearPower, isRetained, recordGearDeed, settleLentGear, updateRetainer } from "./npcGear";
import { applySurvivalGrowth } from "./adventurerGrowth";
import { DUNGEON_MAX_FLOOR } from "./dungeonDifficulty";
import type { AdventurerRank, GameState, GuardProfile, ItemInstance, NpcRecord } from "./types";

/**
 * 町の一日を回す。
 *
 * 冒険者は商人の都合とは無関係に潜り、帰り、傷つき、死ぬ。商人が居合わせなかった
 * 探索も必ず決着させる —— そうしないと「昨日店で薬を買っていった顔なじみが、今日の
 * 迷宮で遺体になっている」という一場面が永久に起こらない。
 */

/** 回復したと見なす体力の割合。ここを超えたら町へ戻る。 */
const RECOVERED_RATIO = 0.8;

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}

/** 0以上1未満の決定論的な乱数。同じ鍵なら何度引いても同じ。 */
function roll(state: GameState, npcId: string, purpose: string): number {
  return hash(`${state.campaignId}:${state.day}:town:${npcId}:${purpose}`) / 0x100000000;
}

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

export type DelveOutcome = "returned" | "injured" | "died";

export interface DelveInput {
  rank: AdventurerRank;
  floor: number;
  /** 潜り始めた時点の体力の割合。 */
  hpRatio: number;
  courage: number;
  discipline: number;
  roll: number;
  /** 預かった装備の重み。省略時は0で、装備なしの数値は1つも動かない。 */
  gearPower?: number;
}

/**
 * 一日の潜行の結末。
 *
 * 推奨階の範囲内で万全なら、まず生きて帰る。推奨を超えるほど急に危うくなる。
 * 勇気は戦いの腕、規律は退き際の判断として、どちらも生存側に効く。
 * ただし勇気の高い者は `preferredDelveFloor` でより深くを選ぶので、差し引きで危険が増す。
 */
export function resolveDelveOutcome(input: DelveInput): DelveOutcome {
  const recommended = ADVENTURER_RANKS[input.rank].recommendedFloor;
  const excess = Math.max(0, input.floor - recommended);
  // 装備の効きには上限を置く。良い装備だけで最深部が作業になっては、深さが意味を失う。
  const gear = Math.min(0.10, (input.gearPower ?? 0) * 0.012);
  const death = clamp(
    0.05 + excess * 0.09 + (1 - clamp(input.hpRatio, 0, 1)) * 0.25 - input.courage / 1000 - input.discipline / 800 - gear,
    0.01,
    0.6,
  );
  if (input.roll < death) return "died";
  if (input.roll < death + death * 2.2) return "injured";
  return "returned";
}

/** その日どこまで潜るつもりか。勇気が高いほど推奨より深くを選ぶ。 */
export function preferredDelveFloor(npc: NpcRecord, profile: GuardProfile, sample: number, gear = 0): number {
  const recommended = ADVENTURER_RANKS[npc.rank ?? "E"].recommendedFloor;
  const ambition = (profile.personality.courage - 50) / 50;
  // 良い装備を持たされた者は、一段深くを狙う。
  return clamp(Math.round(recommended + ambition * 1.5 + (sample * 3 - 1) + Math.min(1, gear / 8)), 1, DUNGEON_MAX_FLOOR);
}

/** いま主人公の探索に居合わせている人物。画面外で勝手に決着させてはいけない。 */
function partyAndFloorNpcIds(state: GameState): ReadonlySet<string> {
  const run = state.run;
  if (!run) return new Set();
  const ids = new Set<string>();
  if (run.guard) ids.add(run.guard.guardId);
  for (const floor of [run, ...Object.values(run.floorStates)]) {
    for (const adventurer of floor.adventurers) ids.add(adventurer.npcId);
  }
  return ids;
}

function payoutFor(rank: AdventurerRank, floor: number): number {
  return Math.floor(ADVENTURER_RANKS[rank].escortFee * 0.5 + floor * 20);
}

function finishDelve(state: GameState, npc: NpcRecord, profile: GuardProfile): void {
  const floor = npc.delve?.floor ?? 1;
  const maxHp = npc.maxHp ?? 10;
  const outcome = resolveDelveOutcome({
    rank: npc.rank ?? "E",
    floor,
    hpRatio: (npc.conditionHp ?? maxHp) / maxHp,
    courage: profile.personality.courage,
    discipline: profile.personality.discipline,
    roll: roll(state, npc.id, "delve"),
    gearPower: gearPower(state, npc),
  });
  delete npc.delve;

  recordGearDeed(state, npc, { floor, returned: outcome === "returned" });
  if (outcome === "returned") {
    npc.status = "inTown";
    delete npc.conditionHp;
    npc.budget += payoutFor(npc.rank ?? "E", floor);
    profile.career.soloDelves += 1;
    profile.career.soloDeepest = Math.max(profile.career.soloDeepest, floor);
    adjustGuardProfile(profile, 0, 6);
    applySurvivalGrowth(state, npc, profile, floor);
    return;
  }
  if (outcome === "injured") {
    npc.status = "recovering";
    npc.conditionHp = Math.max(1, Math.floor(maxHp * 0.35));
    profile.career.soloDelves += 1;
    profile.career.soloDeepest = Math.max(profile.career.soloDeepest, floor);
    adjustGuardProfile(profile, 0, 14);
    return;
  }
  npc.status = "dead";
  delete npc.conditionHp;
  profile.career.deathDay = state.day;
  profile.career.deathFloor = floor;
  // 預かった装備だけは、確かにその階に残る。本人の拾い物は今までどおり後で決まる。
  // 在庫まで遺体へ回すと、探索をまたいで生き続けてしまう。
  const carried = carriedGearItems(state, npc);
  recordGearDeed(state, npc, { died: true });
  for (const item of carried) {
    item.location = { kind: "corpse", npcId: npc.id, floor };
    item.historyV2 ??= [];
    item.historyV2.push({ day: state.day, type: "ownerDied", npcId: npc.id, detail: `${npc.name}が地下${floor}階で死亡` });
  }
  delete npc.gear;
  recordCorpse(state, npc.id, floor, carried.map((item) => item.uuid), carried.length > 0);
  recordOffscreenDeath(state, npc, floor, carried);
}

/**
 * 画面外の死。
 *
 * 面識のある相手なら訃報が耳に入る。見知らぬ誰かの死は、遺体に行き当たるまで知りようがない。
 */
function recordOffscreenDeath(state: GameState, npc: NpcRecord, floor: number, carried: readonly ItemInstance[] = []): void {
  if (!hasBond(npc)) return;
  // 預けた品があるなら、それがどこにあるかまで伝える。取りに行くかどうかは商人が決める。
  const keepsake = carried[0];
  const name = keepsake
    ? keepsake.currentName ?? MERCHANT_ITEM_DEFINITIONS[keepsake.definitionId]?.trueName ?? "預けた品"
    : undefined;
  state.events.push({
    id: `death-${npc.id}`,
    dueDay: state.day,
    // この時点で status は既に "dead" なので、囲っていた記録そのものを見る。
    text: npc.retainedSince !== undefined
      ? `${npc.name}が地下${floor}階から戻らなかった。あなたの店の者だった。${name ? `${name}は、まだあの深さにある。` : ""}`
      : `${npc.name}が地下${floor}階から戻らなかったと、ギルドに報せがあった。${name ? `${name}は、まだあの深さにある。` : ""}`,
  });
}

function recoverInTown(npc: NpcRecord): void {
  const maxHp = npc.maxHp ?? 10;
  const healed = Math.min(maxHp, (npc.conditionHp ?? maxHp) + Math.ceil(maxHp * 0.25));
  npc.conditionHp = healed;
  if (healed >= maxHp * RECOVERED_RATIO) {
    npc.status = "inTown";
    delete npc.conditionHp;
  }
}

function shouldDepart(state: GameState, npc: NpcRecord, profile: GuardProfile): boolean {
  // お抱えは自分の依頼で潜らない。呼べばいつでも町にいる —— それが囲うということ。
  if (isRetained(npc)) return false;
  const wealthy = npc.budget > ADVENTURER_RANKS[npc.rank ?? "E"].escortFee * 4;
  const chance = 0.35
    + profile.personality.courage / 400
    + profile.personality.greed / 500
    - profile.stress / 300
    - (wealthy ? 0.15 : 0);
  return roll(state, npc.id, "depart") < clamp(chance, 0.05, 0.75);
}

/**
 * 一日ぶんの町を進める。
 *
 * 同じ日を二度回さない。判断はすべて campaignId と日付と本人のIDから引くので、
 * セーブして読み直しても同じ一日が再現される。
 */
export function simulateTownDay(state: GameState): void {
  if (state.lastSimulatedDay >= state.day) return;
  state.lastSimulatedDay = state.day;
  const busy = partyAndFloorNpcIds(state);

  for (const npc of [...state.npcs].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!npc.adventurer || busy.has(npc.id)) continue;
    if (npc.status === "dead" || npc.status === "escorting" || npc.status === "contracted" || npc.status === "traveling") continue;
    const profile = ensureGuardProfile(state, npc);
    // 町で顔を合わせたときが精算の機会。護衛帰還・単独帰還・療養明けを一箇所で賄う。
    if (npc.status === "inTown" || npc.status === "recovering") {
      settleLentGear(state, npc);
      updateRetainer(state, npc);
    }
    if (npc.status === "recovering") { recoverInTown(npc); continue; }
    if (npc.status === "delving") { finishDelve(state, npc, profile); continue; }
    if (npc.status !== "inTown") continue;
    if (!shouldDepart(state, npc, profile)) continue;
    npc.status = "delving";
    npc.delve = { floor: preferredDelveFloor(npc, profile, roll(state, npc.id, "floor"), gearPower(state, npc)), departedDay: state.day };
  }

  scheduleArrival(state);
}

/**
 * 欠けた分を埋める新人。
 *
 * 死者が出るほど到着しやすくなる。名簿が満ちていれば誰も来ない。
 * まれに、既に名の知れた冒険者が流れてくる —— 噂が本人より先に町へ届く。
 */
function scheduleArrival(state: GameState): void {
  // 道中の新人も名簿の一員として数える。二重に招かないための唯一の砦。
  const committed = state.npcs.filter((npc) => npc.adventurer && npc.status !== "dead").length;
  const gap = ADVENTURER_ROSTER_TARGET - committed;
  if (gap <= 0) return;
  const draw = hash(`${state.campaignId}:${state.day}:arrival`) % 100;
  if (draw >= Math.min(60, 8 + gap * 8)) return;

  const famous = hash(`${state.campaignId}:${state.day}:famous`) % 100 < 12;
  const rank = famous ? (hash(`${state.campaignId}:${state.day}:famous-rank`) % 2 === 0 ? "A" : "B") : thinnestRank(state);
  const newcomer = createRosterAdventurer(state, { rank, famous, status: "traveling" });
  const dueDay = state.day + 2 + (hash(`${state.campaignId}:${state.day}:arrival-delay`) % 3);

  if (famous) {
    const career = newcomer.guardProfile!.career;
    state.events.push({
      id: `rumour-${newcomer.id}`,
      dueDay: state.day,
      text: `${newcomer.name}という${rank}ランクの冒険者が、地下${career.deepestFloor}階から生還した話が酒場で流れている。`,
    });
  }
  state.events.push({
    id: `arrival-${newcomer.id}`,
    dueDay,
    text: famous
      ? `噂の${newcomer.name}が町へ着いた。護衛の口を探しているらしい。`
      : `${newcomer.name}という${rank}ランクの冒険者が町へ移ってきた。`,
    effect: { kind: "arrival", npcId: newcomer.id },
  });
}

/**
 * 一品物を初めて持ち帰った日、噂が立つ。
 *
 * 蒐集家は店の格では現れない。**深く潜って一品物を見つけたことが、そのまま客層を開く。**
 * 噂が本人より先に町へ届き、聞きつけた一人が数日後に訪ねてくる。
 *
 * 一度きりである。二人目の蒐集家は、いまのところ町へ来ない。
 */
export function announceSingularFind(state: GameState, item: ItemInstance): boolean {
  if (!item.singular) return false;
  if (state.npcs.some((npc) => npc.profession === "collector")) return false;
  const name = item.currentName ?? MERCHANT_ITEM_DEFINITIONS[item.definitionId]?.trueName ?? "見たこともない品";
  const collector = createTownsperson(state, "collector", {
    interests: ["gem", "art", "relic", "curio"],
    budget: 40_000,
    status: "traveling",
  });
  state.events.push({
    id: `singular-rumour-${item.uuid}`,
    dueDay: state.day,
    text: `${name}を持ち帰ったという話が、その日のうちに町を回った。`,
  });
  state.events.push({
    id: `collector-${collector.id}`,
    dueDay: state.day + 2 + (hash(`${state.campaignId}:${item.uuid}:collector`) % 2),
    text: `${collector.name}という蒐集家が、噂を聞きつけて店を訪ねてきた。珍しいものにしか興味がないという。`,
    effect: { kind: "arrival", npcId: collector.id },
  });
  return true;
}

/** 1つの階に置く冒険者の上限。 */
export const FLOOR_ADVENTURER_MAX = 1;
/** 商人と行き合わせるために、その日のうちに繰り上げ出発させてよい人数。 */
const RETROACTIVE_DEPARTURES_PER_DAY = 1;

/**
 * その階で行き合う冒険者を名簿から選ぶ。
 *
 * 鋳造はしない。今日その深さへ潜っている人がいれば、その人が立っている。
 * 誰もいなければ町から繰り上げて出発させる —— 「その人も今日出発していて、
 * あなたが出くわした」という筋は通るし、記録を増やさずに済む。
 */
export function selectFloorDelvers(
  state: GameState,
  floor: number,
  placedNpcIds: ReadonlySet<string>,
): NpcRecord[] {
  const escortId = state.hiredGuardId ?? state.escortCommission?.npcId;
  const order = (npc: NpcRecord): number => hash(`${state.campaignId}:${state.day}:floor:${floor}:${npc.id}`);
  const eligible = (npc: NpcRecord): boolean =>
    npc.adventurer && npc.id !== escortId && !placedNpcIds.has(npc.id);

  const picked: NpcRecord[] = [];
  const take = (candidates: NpcRecord[]): void => {
    for (const npc of candidates.sort((a, b) => order(a) - order(b))) {
      if (picked.length >= FLOOR_ADVENTURER_MAX) return;
      if (picked.some((entry) => entry.id === npc.id)) continue;
      picked.push(npc);
    }
  };

  for (const band of [1, 2]) {
    if (picked.length >= FLOOR_ADVENTURER_MAX) break;
    take(state.npcs.filter((npc) =>
      eligible(npc) && npc.status === "delving" && Math.abs((npc.delve?.floor ?? 0) - floor) <= band));
  }

  // まだ足りず、深すぎない階なら、町にいる適任者を今日の出発者に繰り上げる。
  if (picked.length < FLOOR_ADVENTURER_MAX && floor <= 5) {
    const recruits = state.npcs
      .filter((npc) => eligible(npc) && npc.status === "inTown" && !isRetained(npc)
        && Math.abs(ADVENTURER_RANKS[npc.rank ?? "E"].recommendedFloor - floor) <= 2)
      .sort((a, b) => order(a) - order(b))
      .slice(0, Math.min(RETROACTIVE_DEPARTURES_PER_DAY, FLOOR_ADVENTURER_MAX - picked.length));
    for (const npc of recruits) {
      npc.status = "delving";
      npc.delve = { floor, departedDay: state.day };
      picked.push(npc);
    }
  }

  return picked.slice(0, FLOOR_ADVENTURER_MAX);
}
