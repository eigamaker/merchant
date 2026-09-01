import { ADVENTURER_RANKS, MERCHANT_ITEM_DEFINITIONS } from "./merchantContent";
import { adjustGuardProfile, ensureGuardProfile, recordGuardEvent } from "./guardProfiles";
import { hasBond, npcBonds, recordBond } from "./npcBonds";
import { carriedValue } from "./guardBetrayal";
import type {
  DungeonAdventurer,
  DungeonEvent,
  DungeonHoldup,
  GameState,
  GuardProfile,
  ItemInstance,
  NpcRecord,
} from "./types";

/**
 * 迷宮の往来。
 *
 * 階は閉じていない。商人がそこにいるあいだにも、人は入ってきて、出ていく。
 *
 * **そして入ってきた人影が味方か敵かは、近づくまで分からない。** 縁のある相手なら
 * 追いはぎから庇ってくれるし、居合わせただけの他人でも、見られていること自体が
 * 護衛の裏切りを止める。逆に、入ってきたのが荷を狙う者であることもある ——
 * 迷宮では誰も見ていないので、生きるためなら何でもする者が普通にいる。
 *
 * この両義性が要である。**独りになれば裏切られ、独りでなくなれば救われるか襲われる。**
 * どちらに転ぶかを決めるのは、商人がそれまで誰とどう付き合ってきたかである。
 */

/** 何手番ごとに往来を引くか。 */
export const TRAFFIC_INTERVAL = 6;
/** 同じ階に立てる冒険者の上限。往来で増える分も含む。 */
export const FLOOR_CROWD_MAX = 2;
/** 一人が同じ階に留まる手番。自分の探索があるので長居はしない。 */
export const VISIT_TURNS = 24;
/** 追いはぎが成り立つ最低額。これに満たない持ち合わせなら、荷そのものを狙う。 */
export const HOLDUP_GOLD_FLOOR = 60;
/** これを超えると、その相手は荷を狙う。 */
export const HOLDUP_RISK = 58;
/** 縁のある相手が庇いに入る下限。 */
export const RESCUE_TRUST = 45;

const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}

/** 0以上1未満の決定論的な乱数。同じ鍵なら何度引いても同じ。 */
function roll(state: GameState, key: string): number {
  return hash(`${state.campaignId}:${state.day}:${state.run?.floor ?? 0}:${state.run?.turn ?? 0}:${key}`) / 0x100000000;
}

/**
 * 人の通りの多さ。
 *
 * 浅い階には人がいる。深く行くほど誰も来ない —— **深さとは、助けが来ない距離のこと**である。
 */
export function trafficChance(floor: number): number {
  return clamp(0.55 - (floor - 1) * 0.06, 0.12, 0.55);
}

/**
 * 誰がこの階へ来るか。
 *
 * 縁のある相手ほど選ばれやすい。世界が親切なのではなく、**商人が誰と付き合ってきたかが
 * 迷宮の中にまで効いてくる**ということである。
 */
function pickArrival(state: GameState, exclude: ReadonlySet<string>): NpcRecord | undefined {
  const run = state.run;
  if (!run) return undefined;
  const candidates = state.npcs.filter((npc) =>
    npc.adventurer
    && npc.status === "delving"
    && !exclude.has(npc.id)
    && Math.abs((npc.delve?.floor ?? 0) - run.floor) <= 2);
  if (!candidates.length) return undefined;
  return candidates
    .map((npc) => {
      const profile = ensureGuardProfile(state, npc);
      // 顔なじみは引きが強い。信頼と縁の数のぶんだけ、こちらへ足が向く。
      const familiarity = profile.trust / 120 + Math.min(0.35, npcBonds(npc).length * 0.07);
      return { npc, order: roll(state, `arrival:${npc.id}`) - familiarity };
    })
    .sort((a, b) => a.order - b.order)[0]?.npc;
}

/** その相手が荷を狙うか。護衛の裏切りと同じ軸だが、契約が無いぶん敷居が低い。 */
export function holdupRisk(state: GameState, npc: NpcRecord, profile: GuardProfile): number {
  const run = state.run;
  if (!run) return 0;
  const excess = Math.max(0, run.floor - ADVENTURER_RANKS[npc.rank ?? "E"].recommendedFloor);
  const opportunity = excess * 5
    + Math.min(25, carriedValue(state) / 200)
    + Math.min(12, state.gold / 400)
    + (1 - state.hp / Math.max(1, state.maxHp)) * 12
    // 護衛が前に立っているだけで、たいていの相手は思いとどまる。
    + (run.guard?.mode === "covering" ? -30 : 0);
  const disposition = (profile.personality.greed - 50) * 0.55
    - (profile.personality.integrity - 50) * 0.6
    - profile.trust * 0.4
    // 助けた相手は襲わない。恨みのある相手は襲う。
    - npc.relation * 0.25;
  if (opportunity < 10) return 0;
  return clamp(opportunity + disposition, 0, 100);
}

/** 縁のある相手が庇いに入るか。 */
export function willRescue(npc: NpcRecord, profile: GuardProfile): boolean {
  if (!hasBond(npc)) return false;
  return profile.trust >= RESCUE_TRUST || profile.personality.empathy >= 70;
}

/** 階へ一人入ってくる。位置は商人から離れたところで、歩いてくるのが見える。 */
function admit(state: GameState, npc: NpcRecord, place: () => { x: number; y: number } | undefined, events: DungeonEvent[]): boolean {
  const run = state.run;
  if (!run) return false;
  const pos = place();
  if (!pos) return false;
  const rank = ADVENTURER_RANKS[npc.rank ?? "E"];
  const maxHp = npc.maxHp ?? rank.baseHp;
  run.adventurers.push({
    npcId: npc.id,
    pos,
    arrivedTurn: run.turn,
    hp: Math.max(1, Math.min(maxHp, npc.conditionHp ?? maxHp)),
    maxHp,
    damage: npc.damage ?? rank.baseDamage,
    gold: Math.max(200, Math.floor(npc.budget * 0.6)),
  });
  const profile = ensureGuardProfile(state, npc);
  const friendly = willRescue(npc, profile);
  events.push({ type: "arrived", npcId: npc.id, friendly });
  state.message = hasBond(npc)
    ? `暗がりから足音がする。${npc.name}だ。`
    : `暗がりから足音がする。見覚えのない冒険者が、こちらを見ている。`;
  return true;
}

/** 長居した者、深手を負った者は自分の探索へ戻る。 */
function releaseVisitors(state: GameState, events: DungeonEvent[]): void {
  const run = state.run;
  if (!run) return;
  const leaving = run.adventurers.filter((entry) =>
    entry.arrivedTurn !== undefined
    && run.turn - entry.arrivedTurn >= VISIT_TURNS
    && distance(entry.pos, run.player) > 2
    && run.holdup?.npcId !== entry.npcId);
  for (const entry of leaving) {
    run.adventurers = run.adventurers.filter((other) => other.npcId !== entry.npcId);
    events.push({ type: "departed", npcId: entry.npcId });
  }
}

/**
 * 追いはぎが声をかける。
 *
 * 護衛の強請りと違って契約が無いので、前置きも短い。断れば斬りかかってくる。
 */
function openHoldup(state: GameState, npc: NpcRecord, events: DungeonEvent[]): DungeonHoldup | undefined {
  const run = state.run;
  if (!run) return undefined;
  const wanted = Math.floor(ADVENTURER_RANKS[npc.rank ?? "E"].escortFee + carriedValue(state) * 0.25);
  const payable = Math.min(state.gold, wanted);
  const takesGoods = payable < HOLDUP_GOLD_FLOOR;
  if (takesGoods && state.inventory.length === 0) return undefined;
  const holdup: DungeonHoldup = {
    npcId: npc.id,
    amount: takesGoods ? 0 : payable,
    takesGoods,
    floor: run.floor,
    turn: run.turn,
  };
  run.holdup = holdup;
  events.push({ type: "holdup", npcId: npc.id, amount: holdup.amount });
  state.message = takesGoods
    ? `${npc.name}が行く手に立った。「その荷を置いていけ。ここで何があったか、誰も知らない」`
    : `${npc.name}が行く手に立った。「${payable}G。出せば通してやる」`;
  return holdup;
}

/** 差し出す。金で足りなければ、値の張る品から順に渡す。 */
export function handOverToRobber(state: GameState, events: DungeonEvent[]): boolean {
  const run = state.run;
  const holdup = run?.holdup;
  if (!run || !holdup || holdup.refused) return false;
  const npc = state.npcs.find((entry) => entry.id === holdup.npcId);
  if (!npc) return false;

  let goldTaken = 0;
  const taken: ItemInstance[] = [];
  if (holdup.takesGoods) {
    // 値の張る品から順に、半分ほど持っていく。全部は持てないからである。
    const sorted = [...state.inventory]
      .sort((a, b) => (MERCHANT_ITEM_DEFINITIONS[b.definitionId]?.baseValue ?? 0) - (MERCHANT_ITEM_DEFINITIONS[a.definitionId]?.baseValue ?? 0));
    taken.push(...sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2))));
    const takenIds = new Set(taken.map((item) => item.uuid));
    state.inventory = state.inventory.filter((item) => !takenIds.has(item.uuid));
    for (const item of taken) {
      item.owner = npc.id;
      item.location = { kind: "npcInventory", npcId: npc.id };
      item.history.push({ day: state.day, type: "sold", detail: `地下${holdup.floor}階で${npc.name}に差し出した` });
      npc.inventoryIds.push(item.uuid);
    }
  } else {
    goldTaken = Math.min(state.gold, holdup.amount);
    state.gold -= goldTaken;
  }

  const profile = ensureGuardProfile(state, npc);
  profile.career.holdupCount += 1;
  recordGuardEvent(state, npc, "heldUp", `地下${holdup.floor}階で商人から${goldTaken > 0 ? `${goldTaken}G` : `荷${taken.length}点`}を取り上げた`, holdup.floor);
  recordBond(state, npc, "waylaid", `地下${holdup.floor}階で待ち伏せられ、${goldTaken > 0 ? `${goldTaken}G` : `荷${taken.length}点`}を渡した`, holdup.floor);
  npc.relation = Math.max(-100, npc.relation - 30);
  run.holdup = undefined;
  // 「出せば通してやる」と言った以上、同じ相手が二度は呼び止めない。
  run.holdupSettledNpcIds = [...(run.holdupSettledNpcIds ?? []), npc.id];
  events.push({ type: "robbed", npcId: npc.id, gold: goldTaken, items: taken.length });
  state.message = goldTaken > 0
    ? `${goldTaken}Gを渡した。${npc.name}は数えもせずに懐へ入れ、道を空けた。`
    : `荷から${taken.length}点を渡した。${npc.name}は何も言わずに背を向けた。`;
  return true;
}

/** 突っぱねる。次の一手から斬りかかってくる。 */
export function refuseRobber(state: GameState): boolean {
  const run = state.run;
  const holdup = run?.holdup;
  if (!run || !holdup || holdup.refused) return false;
  const npc = state.npcs.find((entry) => entry.id === holdup.npcId);
  if (!npc) return false;
  holdup.refused = true;
  const guarded = run.guard?.mode === "covering";
  state.message = guarded
    ? `「……そうか」${npc.name}は武器を抜いた。護衛が前に出る。`
    : `「……そうか」${npc.name}は武器を抜いた。あなたの前には誰も立っていない。`;
  return true;
}

/**
 * 追いはぎに立ち向かう者たち。
 *
 * 護衛は自分の仕事としてこれをする —— **しなければ、そもそも何のために雇われたのか
 * 分からない。** ただし忠義の薄い護衛は動かず、その場に立って見ている。
 * 縁のある冒険者も、居合わせれば庇いに入る。
 */
function defendersAgainst(state: GameState, robberId: string): string[] {
  const run = state.run;
  if (!run) return [];
  const defenders: string[] = [];
  if (run.guard?.mode === "covering") {
    const guardNpc = state.npcs.find((npc) => npc.id === run.guard?.guardId);
    if (guardNpc) {
      const profile = ensureGuardProfile(state, guardNpc);
      // 護衛料を受け取っている以上、これは仕事である。よほど不実でなければ前に出る。
      if (profile.personality.integrity >= 30 || profile.trust >= 30) defenders.push(guardNpc.id);
    }
  }
  for (const entry of run.adventurers) {
    if (entry.npcId === robberId) continue;
    const npc = state.npcs.find((candidate) => candidate.id === entry.npcId);
    if (npc && willRescue(npc, ensureGuardProfile(state, npc))) defenders.push(npc.id);
  }
  return defenders;
}

/** 断られた追いはぎの一手番。庇う者がいれば止まり、いなければ商人を斬る。 */
function resolveRefusedHoldup(state: GameState, events: DungeonEvent[]): void {
  const run = state.run;
  const holdup = run?.holdup;
  if (!run || !holdup?.refused) return;
  const robber = run.adventurers.find((entry) => entry.npcId === holdup.npcId);
  const npc = state.npcs.find((entry) => entry.id === holdup.npcId);
  if (!robber || !npc) { run.holdup = undefined; return; }
  if (distance(robber.pos, run.player) > 1) return;

  const defenders = defendersAgainst(state, npc.id);
  if (defenders.length > 0) {
    const defenderId = defenders[0]!;
    const defender = state.npcs.find((entry) => entry.id === defenderId);
    const damage = run.guard?.guardId === defenderId
      ? run.guard.damage
      : run.adventurers.find((entry) => entry.npcId === defenderId)?.damage ?? 3;
    robber.hp -= damage;
    events.push({ type: "attack", attackerId: defenderId, targetId: npc.id, damage });
    if (defender) {
      const profile = ensureGuardProfile(state, defender);
      profile.career.rescueCount += 1;
      recordGuardEvent(state, defender, "rescued", `地下${run.floor}階で${npc.name}から商人をかばった`, run.floor);
      // 護衛でない相手が庇ってくれたなら、それは縁である。
      if (run.guard?.guardId !== defenderId) recordBond(state, defender, "rescued", `地下${run.floor}階で${npc.name}から守ってくれた`, run.floor);
      adjustGuardProfile(profile, 6, 6);
      events.push({ type: "rescued", npcId: defenderId, fromNpcId: npc.id });
    }
    if (robber.hp <= 0) {
      run.adventurers = run.adventurers.filter((entry) => entry.npcId !== npc.id);
      run.holdup = undefined;
      run.holdupSettledNpcIds = [...(run.holdupSettledNpcIds ?? []), npc.id];
      state.message = `${defender?.name ?? "誰か"}が${npc.name}を退けた。`;
      return;
    }
    state.message = `${defender?.name ?? "誰か"}が${npc.name}へ${damage}ダメージ。追いはぎは怯んだ。`;
    return;
  }

  // 誰も庇わない。護衛がいて動かなかったのなら、それも記録に残る。
  if (run.guard?.mode === "covering") {
    const idle = state.npcs.find((entry) => entry.id === run.guard?.guardId);
    if (idle) recordGuardEvent(state, idle, "stoodBy", `地下${run.floor}階で商人が襲われるのを見ていた`, run.floor);
  }
  state.hp -= robber.damage;
  events.push({ type: "attack", attackerId: npc.id, targetId: "player", damage: robber.damage });
  state.message = run.guard
    ? `${npc.name}の一撃。${robber.damage}ダメージ。護衛は動かなかった。`
    : `${npc.name}の一撃。${robber.damage}ダメージ。`;
}

/**
 * 迷宮の往来を一手番ぶん進める。
 *
 * 返り値は、この手番で新たに突きつけられた追いはぎ。画面はこれを見て問いを出す。
 */
export function trafficPhase(state: GameState, events: DungeonEvent[], place: () => { x: number; y: number } | undefined): DungeonHoldup | undefined {
  const run = state.run;
  if (!run || state.status !== "active") return undefined;

  if (run.holdup?.refused) {
    resolveRefusedHoldup(state, events);
    return undefined;
  }
  if (run.holdup) return undefined;

  releaseVisitors(state, events);

  // 誰かがこの階へ入ってくる。
  if (run.turn >= (run.nextTrafficTurn ?? TRAFFIC_INTERVAL) && run.adventurers.length < FLOOR_CROWD_MAX) {
    run.nextTrafficTurn = run.turn + TRAFFIC_INTERVAL;
    if (roll(state, "traffic") < trafficChance(run.floor)) {
      const present = new Set([
        ...run.adventurers.map((entry) => entry.npcId),
        ...(run.guard ? [run.guard.guardId] : []),
      ]);
      const arrival = pickArrival(state, present);
      if (arrival) admit(state, arrival, place, events);
    }
  }

  // すでにこの階にいる誰かが、荷に目をつける。
  for (const entry of run.adventurers) {
    if (distance(entry.pos, run.player) > 1) continue;
    if (run.holdupSettledNpcIds?.includes(entry.npcId)) continue;
    const npc = state.npcs.find((candidate) => candidate.id === entry.npcId);
    if (!npc) continue;
    const profile = ensureGuardProfile(state, npc);
    if (holdupRisk(state, npc, profile) < HOLDUP_RISK) continue;
    const opened = openHoldup(state, npc, events);
    if (opened) return opened;
  }
  return undefined;
}

/** いま商人の隣に立っている追いはぎ。画面の描き分けに使う。 */
export function activeRobber(state: GameState): DungeonAdventurer | undefined {
  const run = state.run;
  if (!run?.holdup) return undefined;
  return run.adventurers.find((entry) => entry.npcId === run.holdup?.npcId);
}
