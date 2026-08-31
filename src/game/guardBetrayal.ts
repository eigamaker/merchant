import { ADVENTURER_RANKS, MERCHANT_ITEM_DEFINITIONS } from "./merchantContent";
import { adjustGuardProfile, ensureGuardProfile, recordGuardEvent } from "./guardProfiles";
import { recordBond } from "./npcBonds";
import type { DungeonEvent, GameState, GuardDemand, GuardProfile, NpcRecord } from "./types";

/**
 * 迷宮では誰も見ていない。
 *
 * これは臆病の話ではない。深手を負った護衛が逃げるのは `guardStand` の受け持ちで、
 * あれは自分が死なないための判断である。**こちらは無傷の護衛が、周りに誰もいないことと、
 * 商人の鞄が重いことに気づいて足を止める話** —— 恐怖ではなく計算であり、
 * 生きるためなら何でもする人間が普通にいる世界では、これが起こらないほうがおかしい。
 *
 * だから突然は起こらない。**予兆 → 要求 → 実行**の三段を踏み、どの段でも商人には
 * 読む手がかりがある。読めなかったのなら、それは深く潜りすぎたということである。
 */

/** これを超えると、護衛の目つきが変わる。 */
export const OMEN_RISK = 40;
/** これを超えると、護衛は足を止めて取り分を要求する。 */
export const DEMAND_RISK = 55;
/** 要求を断られたあと、これを超えていれば荷を奪う。 */
export const BETRAYAL_RISK = 62;
/**
 * 機会がこれに満たなければ、どんな人物でも何も起きない。
 *
 * **動機のない裏切りは書かない。** 浅い階で空の鞄を担いでいる商人を襲う理由は、
 * どれだけ強欲な相手にも無い。深さか、荷の値打ちか、商人の弱りか —— どれかが要る。
 */
export const OPPORTUNITY_FLOOR = 12;
/** 強請りが成立する最低額。これに満たない持ち合わせなら、吹っかける意味がない。 */
export const DEMAND_FLOOR = 50;
/** 危うい探索を裏切らずに終えた者へ渡す信用。 */
export const LOYALTY_REWARD_RISK = OMEN_RISK;

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/** いま鞄に入っている品の値打ち。狙われるのはこれである。 */
export function carriedValue(state: GameState): number {
  return state.inventory.reduce((total, item) => total + (MERCHANT_ITEM_DEFINITIONS[item.definitionId]?.baseValue ?? 0), 0);
}

export interface BetrayalRisk {
  score: number;
  /** その階に居合わせた他の冒険者。ひとりでもいれば、この話は起きない。 */
  witnesses: number;
  /** 深さ・荷の値打ち・商人の弱りが作る「やれる状況」。 */
  opportunity: number;
  /** 性格と関係が作る「やる人かどうか」。 */
  disposition: number;
}

/**
 * いま護衛の心にどれだけ影が差しているか。
 *
 * **機会と素地の両方が要る。** 深さと荷の重さと商人の弱りが「やれる状況」を作り、
 * 強欲と不実と信頼の薄さが「やる人かどうか」を決める。動機の無いところでは、
 * どれだけ性根が悪くても何も起きない —— 浅い階で空の鞄を襲う理由は誰にも無いからだ。
 *
 * そして**目撃者がいれば、それだけで話は消える。** 迷宮で何でもありなのは、
 * 誰も見ていないからである。
 */
export function betrayalRisk(state: GameState, npc: NpcRecord, profile: GuardProfile): BetrayalRisk {
  const run = state.run;
  if (!run) return { score: 0, witnesses: 0, opportunity: 0, disposition: 0 };
  const witnesses = run.adventurers.length;
  const recommended = ADVENTURER_RANKS[npc.rank ?? "E"].recommendedFloor;
  const excess = Math.max(0, run.floor - recommended);
  const { greed, integrity } = profile.personality;
  const opportunity = excess * 6
    + Math.min(25, carriedValue(state) / 200)
    + (1 - state.hp / Math.max(1, state.maxHp)) * 15;
  const disposition = (greed - 50) * 0.5
    - (integrity - 50) * 0.6
    - profile.trust * 0.35
    + profile.stress * 0.15;
  if (opportunity < OPPORTUNITY_FLOOR) return { score: 0, witnesses, opportunity, disposition };
  return { score: clamp(opportunity + disposition, 0, 100), witnesses, opportunity, disposition };
}

/** 護衛が吹っかけてくる額。持ち合わせの範囲でしか言わない —— 払えない額を言っても意味がない。 */
export function demandAmount(state: GameState, npc: NpcRecord): number {
  const fee = ADVENTURER_RANKS[npc.rank ?? "E"].escortFee;
  const wanted = Math.floor(fee * 2 + carriedValue(state) * 0.2);
  return Math.min(state.gold, wanted);
}

/** 予兆の一行。誰が相手でも同じ文にはしない。 */
function omenLine(name: string, profile: GuardProfile): string {
  if (profile.personality.greed >= 75) return `${name}が、あなたの鞄をちらりと見た。目が合うと、何でもないように前を向いた。`;
  if (profile.personality.integrity <= 35) return `${name}が足を緩めた。「ここまで来ると、誰も見ていませんね」`;
  return `${name}が黙り込んでいる。さっきから一度もこちらを見ない。`;
}

/**
 * 荷を奪って去る。
 *
 * 命までは取らない。取る必要がないからで、所持金と鞄の中身と帰還石を持って行けば、
 * 地下の深いところに商人がひとり残る。**親が死んだのは、たぶんこうしてである。**
 * 道具袋だけは置いていく —— 空の袋は売れない。
 */
function executeBetrayal(state: GameState, npc: NpcRecord, profile: GuardProfile, events: DungeonEvent[]): void {
  const run = state.run;
  if (!run) return;
  const floor = run.floor;
  const stolenGold = state.gold;
  const stolen = [...state.inventory];

  for (const item of stolen) {
    item.owner = npc.id;
    item.location = { kind: "npcInventory", npcId: npc.id };
    item.history.push({ day: state.day, type: "sold", detail: `地下${floor}階で${npc.name}に奪われた` });
    npc.inventoryIds.push(item.uuid);
  }
  state.inventory = [];
  state.gold = 0;
  // 帰還石まで持っていく。歩いて出るしかなくなる。
  state.returnStones = 0;

  npc.status = "inTown";
  profile.career.betrayalCount += 1;
  profile.trust = 0;
  adjustGuardProfile(profile, 0, 20);
  recordGuardEvent(state, npc, "betrayed", `地下${floor}階で荷を奪って去った`, floor);
  recordBond(state, npc, "betrayed", `地下${floor}階で所持金${stolenGold}Gと荷${stolen.length}点を奪われた`, floor);
  npc.relation = Math.max(-100, npc.relation - 60);

  run.guard = undefined;
  run.demand = undefined;
  state.hiredGuardId = undefined;
  state.hiredGuardFee = undefined;
  state.escortCommission = undefined;
  events.push({ type: "guardBetrayed", guardId: npc.id, gold: stolenGold, items: stolen.length });
  state.message = `${npc.name}はあなたの荷と帰還石を担ぎ、階段へ歩いていった。地下${floor}階に、ひとり残された。`;
}

/**
 * 護衛の一手番ぶんの計算。
 *
 * 返り値は、この手番で新たに突きつけられた要求。画面はこれを見て問いを出す。
 */
export function betrayalPhase(state: GameState, events: DungeonEvent[]): GuardDemand | undefined {
  const run = state.run;
  const guard = run?.guard;
  if (!run || !guard || guard.mode !== "covering") return undefined;
  const npc = state.npcs.find((entry) => entry.id === guard.guardId);
  if (!npc) return undefined;
  const profile = ensureGuardProfile(state, npc);
  const { score, witnesses } = betrayalRisk(state, npc, profile);
  run.betrayalPeak = Math.max(run.betrayalPeak ?? 0, score);

  // 誰かが見ている階では、この話は起きない。突きつけた要求も引っ込む。
  if (witnesses > 0) {
    if (run.demand) {
      run.demand = undefined;
      state.message = `${npc.name}は近づいてくる人影に気づき、何も言わずに前を向いた。`;
    }
    return undefined;
  }

  // 断られた要求が宙に浮いている。腹を決めるのは、答えを聞いた次の一手である ——
  // 商人にはその一手だけ、逃げる隙がある。
  if (run.demand?.refused) {
    if (run.turn <= (run.demand.refusedTurn ?? -1)) return undefined;
    if (score >= BETRAYAL_RISK) {
      executeBetrayal(state, npc, profile, events);
      return undefined;
    }
    // 気が変わった。要求そのものを引っ込める。
    run.demand = undefined;
    state.message = `${npc.name}は舌打ちをして、また前を向いた。`;
    return undefined;
  }
  if (run.demand) return undefined;

  if (score >= DEMAND_RISK) {
    const amount = demandAmount(state, npc);
    // 払える持ち合わせが無いなら吹っかけても仕方がない。そのぶん、話は早い。
    if (amount < DEMAND_FLOOR) {
      if (score >= BETRAYAL_RISK) executeBetrayal(state, npc, profile, events);
      return undefined;
    }
    const demand: GuardDemand = { guardId: npc.id, amount, floor: run.floor, turn: run.turn };
    run.demand = demand;
    events.push({ type: "guardDemand", guardId: npc.id, amount });
    state.message = `${npc.name}が行く手を塞いだ。「ここまでの分は、聞いていた額では足りません。${amount}G、いただけますか」`;
    return demand;
  }

  if (score >= OMEN_RISK && !run.betrayalOmenShown) {
    run.betrayalOmenShown = true;
    state.message = omenLine(npc.name, profile);
  }
  return undefined;
}

/** 要求に応じる。金は渡るが、この人物が何をする人かは分かってしまった。 */
export function payDemand(state: GameState): boolean {
  const run = state.run;
  const demand = run?.demand;
  if (!run || !demand || demand.refused) return false;
  const npc = state.npcs.find((entry) => entry.id === demand.guardId);
  if (!npc) return false;
  const amount = Math.min(state.gold, demand.amount);
  state.gold -= amount;
  const profile = ensureGuardProfile(state, npc);
  profile.career.extortionCount += 1;
  // 払えば矛は収まる。ただし、次に同じ深さへ来たときのことは分からない。
  adjustGuardProfile(profile, -12, -10);
  recordGuardEvent(state, npc, "extorted", `地下${demand.floor}階で${amount}Gを要求し、受け取った`, demand.floor);
  recordBond(state, npc, "extorted", `地下${demand.floor}階で${amount}Gを要求された`, demand.floor);
  run.demand = undefined;
  state.message = `${amount}Gを渡した。${npc.name}は何も言わずに受け取り、また前に立った。`;
  return true;
}

/** 要求をはねつける。相手が引き下がるかどうかは、次の一手で分かる。 */
export function refuseDemand(state: GameState): boolean {
  const run = state.run;
  const demand = run?.demand;
  if (!run || !demand || demand.refused) return false;
  const npc = state.npcs.find((entry) => entry.id === demand.guardId);
  if (!npc) return false;
  demand.refused = true;
  demand.refusedTurn = run.turn;
  adjustGuardProfile(ensureGuardProfile(state, npc), -6, 12);
  state.message = `${npc.name}は返事を聞くと、しばらく黙っていた。「……そうですか」`;
  return true;
}

/**
 * 裏切らずに帰った者への信用。
 *
 * 深く、荷が重く、誰も見ていない探索を最後まで務めたのなら、それは疑われずに済んだ
 * のではなく、**疑う理由があってなお何もしなかった**ということである。
 */
export function rewardLoyalty(state: GameState, npc: NpcRecord, peak: number | undefined, refusedDemand = false): void {
  // 要求を突きつけた相手は、逃げ切られただけである。信用にはならない。
  if (refusedDemand) return;
  if ((peak ?? 0) < LOYALTY_REWARD_RISK) return;
  const profile = ensureGuardProfile(state, npc);
  adjustGuardProfile(profile, 12);
  recordGuardEvent(state, npc, "returned", `誰も見ていない深さで荷を預けたまま生還した`, profile.career.deepestFloor);
}
