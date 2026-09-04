import { isWalkableCell, samePosition } from "./dungeonRules";
import { MERCHANT_ITEM_DEFINITIONS } from "./merchantContent";
import { adjustGuardProfile, ensureGuardProfile } from "./guardProfiles";
import { recordBond } from "./npcBonds";
import { wantsItem } from "./npcDemand";
import { bagCapacity } from "./merchantSystems";
import { dungeonVerdict } from "./pricing";
import type {
  DungeonAdventurer,
  DungeonEvent,
  DungeonStall,
  GameState,
  ItemInstance,
  NpcRecord,
  StallSlot,
  Vec,
} from "./types";

/**
 * 迷宮の露店。
 *
 * 深い階には他に店がない。傷ついた冒険者の前で回復薬を広げているのが自分だけなら、
 * 値は町の相場とは別のところで決まる —— それが商人が深く潜る理由である。戦利品を
 * 拾うためではなく、**そこでしか開けない売り場を開くため**に降りていく。
 *
 * 代償は時間である。広げているあいだ商人は一歩も動けない。敵は寄り、食料は減り、
 * 護衛は消耗する。そして護衛がそばを離れた瞬間、露店は成り立たなくなる ——
 * 商人ひとりが品物を抱えて深層に座っているだけになるからだ。
 */

/** 露店を広げるのに必要な、商人の周りの空き升。 */
const STALL_RING_OFFSETS: readonly Vec[] = [
  { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
  { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 },
  { x: 0, y: -2 }, { x: 2, y: 0 }, { x: 0, y: 2 }, { x: -2, y: 0 },
  { x: 1, y: -2 }, { x: 2, y: -1 }, { x: 2, y: 1 }, { x: 1, y: 2 },
  { x: -1, y: 2 }, { x: -2, y: 1 }, { x: -2, y: -1 }, { x: -1, y: -2 },
];

/** 露店を開くのに最低限これだけの品は並べたい。 */
export const STALL_MIN_SLOTS = 2;
/** 噂を聞いて寄ってくる客の上限。呼び込みは無限ではない。 */
export const STALL_DRAW_MAX = 3;
/** 何ターンに一度、噂が届くか。 */
export const STALL_DRAW_INTERVAL = 4;
/** 客が品を見に来る距離。これより遠い相手は露店に気づかない。 */
export const STALL_NOTICE_RANGE = 7;
/** 広げているあいだ、護衛が1ターンごとに溜める消耗。 */
export const STALL_GUARD_STRESS_PER_TURN = 2;

const distance = (a: Vec, b: Vec): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/**
 * 何枠まで床に広げられるか。
 *
 * 道具袋の三分の一。風呂敷なら4枠しか置けない —— **何を並べるかが商いになる。**
 */
export function stallCapacity(state: GameState): number {
  return Math.max(STALL_MIN_SLOTS, Math.floor(bagCapacity(state) / 3));
}

export type StallRefusal =
  | "notInDungeon"
  | "alreadyOpen"
  | "noGuard"
  | "enemiesNear"
  | "noGoods"
  | "noRoom";

export interface StallReadiness {
  allowed: boolean;
  reason?: StallRefusal;
  message: string;
  /** 実際に広げられる升。開店前の下見にも使う。 */
  cells: Vec[];
}

/** 商人の足元から外へ、広げられる升を数える。 */
export function stallCells(state: GameState, limit = stallCapacity(state)): Vec[] {
  const run = state.run;
  if (!run) return [];
  const taken: Vec[] = [
    run.player,
    run.map.stairsUp,
    ...(run.map.stairsDown ? [run.map.stairsDown] : []),
    ...run.enemies.map((enemy) => enemy.pos),
    ...run.chests.map((chest) => chest.pos),
    ...run.bodies.map((body) => body.pos),
    ...run.items.map((entry) => entry.pos),
    ...run.adventurers.map((entry) => entry.pos),
  ];
  const cells: Vec[] = [];
  for (const offset of STALL_RING_OFFSETS) {
    if (cells.length >= limit) break;
    const cell = { x: run.player.x + offset.x, y: run.player.y + offset.y };
    if (!isWalkableCell(run.map, cell)) continue;
    if (taken.some((pos) => samePosition(pos, cell))) continue;
    cells.push(cell);
  }
  return cells;
}

/**
 * いま風呂敷を広げられるか。
 *
 * **護衛がそばに立っていなければ開けない。** 商品を床に並べて座り込むというのは、
 * 誰も見ていない場所で無防備になるということで、それを許すのは護衛だけである。
 */
export function stallReadiness(state: GameState): StallReadiness {
  const run = state.run;
  if (!run || state.location !== "dungeon") {
    return { allowed: false, reason: "notInDungeon", message: "露店は迷宮でしか開けない。", cells: [] };
  }
  if (run.stall) return { allowed: false, reason: "alreadyOpen", message: "もう風呂敷を広げている。", cells: [] };
  if (run.guard?.mode !== "covering") {
    return {
      allowed: false,
      reason: "noGuard",
      message: run.guard ? "護衛が前にいないうちは広げられない。" : "護衛なしで無防備に座り込むことはできない。",
      cells: [],
    };
  }
  if (run.enemies.some((enemy) => distance(enemy.pos, run.player) <= 4)) {
    return { allowed: false, reason: "enemiesNear", message: "近くに敵がいる。ここでは広げられない。", cells: [] };
  }
  if (state.inventory.length === 0) {
    return { allowed: false, reason: "noGoods", message: "並べる品がない。", cells: [] };
  }
  const cells = stallCells(state);
  if (cells.length < STALL_MIN_SLOTS) {
    return { allowed: false, reason: "noRoom", message: "床が狭すぎる。もっと開けた場所を探そう。", cells };
  }
  return { allowed: true, message: `${cells.length}枠まで並べられる。`, cells };
}

/**
 * 風呂敷を広げる。
 *
 * 並べても品は鞄の中にある。露店は在庫を移すのではなく、鞄の中身を床に見せているだけで、
 * だから畳めばそのまま持って帰れる。失うのは時間だけである —— その時間が高くつく。
 */
export function openStall(
  state: GameState,
  goods: ReadonlyArray<{ itemId: string; price: number }>,
  events: DungeonEvent[],
): boolean {
  const run = state.run;
  const readiness = stallReadiness(state);
  if (!run || !readiness.allowed) {
    state.message = readiness.message;
    return false;
  }
  const cells = readiness.cells;
  const slots: StallSlot[] = [];
  for (const entry of goods) {
    if (slots.length >= cells.length) break;
    const item = state.inventory.find((candidate) => candidate.uuid === entry.itemId);
    if (!item || slots.some((slot) => slot.itemId === item.uuid)) continue;
    slots.push({ itemId: item.uuid, pos: { ...cells[slots.length]! }, price: Math.max(1, Math.round(entry.price)) });
  }
  if (slots.length < STALL_MIN_SLOTS) {
    state.message = `並べる品が足りない。${STALL_MIN_SLOTS}点は要る。`;
    return false;
  }
  run.stall = { openedTurn: run.turn, slots, passedNpcIds: [], drawnCount: 0, earned: 0, soldCount: 0 };
  events.push({ type: "stallOpened", slots: slots.length });
  state.message = `風呂敷を広げ、${slots.length}点を並べた。地下${run.floor}階に、他に店はない。`;
  return true;
}

/**
 * 風呂敷を畳む。
 *
 * 品はもともと鞄にあるので、畳んでも何も失わない。
 * `forced` は護衛が離れたことによる強制で、そのときだけ言い回しが変わる。
 */
export function closeStall(state: GameState, events: DungeonEvent[], forced = false): DungeonStall | undefined {
  const run = state.run;
  const stall = run?.stall;
  if (!run || !stall) return undefined;
  run.stall = undefined;
  events.push({ type: "stallClosed", earned: stall.earned });
  state.message = forced
    ? `守る者がいなくなった。品をかき集めて風呂敷を畳む。${stall.soldCount > 0 ? `売り上げは${stall.earned}G。` : ""}`
    : stall.soldCount > 0
      ? `風呂敷を畳んだ。${stall.soldCount}点が売れ、${stall.earned}Gになった。`
      : "風呂敷を畳んだ。今日は誰も買わなかった。";
  return stall;
}

/** 露店に並んでいる品。鞄から消えていれば枠も落とす。 */
export function stallGoods(state: GameState): Array<{ slot: StallSlot; item: ItemInstance }> {
  const stall = state.run?.stall;
  if (!stall) return [];
  const goods: Array<{ slot: StallSlot; item: ItemInstance }> = [];
  for (const slot of stall.slots) {
    const item = state.inventory.find((entry) => entry.uuid === slot.itemId);
    if (item) goods.push({ slot, item });
  }
  return goods;
}

/**
 * 冒険者が露店へ向かうか。
 *
 * 敵が隣にいる相手は買い物どころではない。一度見て何も買わなかった相手も戻ってこない。
 */
export function stallAttraction(state: GameState, adventurer: DungeonAdventurer): Vec | undefined {
  const run = state.run;
  const stall = run?.stall;
  if (!run || !stall) return undefined;
  if (stall.passedNpcIds.includes(adventurer.npcId)) return undefined;
  if (run.enemies.some((enemy) => distance(enemy.pos, adventurer.pos) <= 1)) return undefined;
  if (distance(adventurer.pos, run.player) > STALL_NOTICE_RANGE) return undefined;
  return { ...run.player };
}

/** その冒険者が露店に手を伸ばせる位置にいるか。 */
function atCounter(state: GameState, adventurer: DungeonAdventurer): boolean {
  const run = state.run;
  const stall = run?.stall;
  if (!run || !stall) return false;
  if (distance(adventurer.pos, run.player) <= 1) return true;
  return stall.slots.some((slot) => distance(adventurer.pos, slot.pos) <= 1);
}

/** 傷が深いほど、回復品は言い値で通る。 */
function desperateFor(adventurer: DungeonAdventurer, item: ItemInstance): boolean {
  return adventurer.hp < adventurer.maxHp * 0.7 && (MERCHANT_ITEM_DEFINITIONS[item.definitionId]?.healing ?? 0) > 0;
}

function baselineFor(item: ItemInstance): number {
  return Math.max(1, Math.floor((MERCHANT_ITEM_DEFINITIONS[item.definitionId]?.baseValue ?? 1) * 0.6));
}

/**
 * 露店に立ち寄った冒険者の商い。
 *
 * 買うのは一度に一点だけ。要る品が無ければ何も買わずに去り、並べ替えるまで戻らない。
 */
function serveCustomer(state: GameState, adventurer: DungeonAdventurer, events: DungeonEvent[]): void {
  const run = state.run;
  const stall = run?.stall;
  const npc = state.npcs.find((entry) => entry.id === adventurer.npcId);
  if (!run || !stall || !npc) return;

  const offers = stallGoods(state)
    .map(({ slot, item }) => {
      const definition = MERCHANT_ITEM_DEFINITIONS[item.definitionId];
      if (!definition) return undefined;
      const desperate = desperateFor(adventurer, item);
      // 要らない品は何倍だろうと要らない。倍率がものを言うのは、本当に困っているときだけ。
      if (!wantsItem(npc, item) && !desperate) return undefined;
      return { slot, item, desperate };
    })
    .filter((offer): offer is { slot: StallSlot; item: ItemInstance; desperate: boolean } => Boolean(offer))
    // 命がかかっている品を先に見る。
    .sort((a, b) => Number(b.desperate) - Number(a.desperate) || a.slot.price - b.slot.price);

  const profile = ensureGuardProfile(state, npc);
  for (const offer of offers) {
    const baseline = baselineFor(offer.item);
    const verdict = dungeonVerdict(npc, offer.slot.price, baseline, adventurer.gold, offer.desperate, profile.personality);
    if (verdict.reaction === "refuse") continue;
    completeStallSale(state, npc, adventurer, offer.slot, offer.item, verdict.sentiment, offer.desperate, events);
    state.message = `${verdict.line}（${offer.slot.price}G）`;
    return;
  }
  stall.passedNpcIds.push(adventurer.npcId);
  state.message = `${npc.name}は品を眺め、何も買わずに離れていった。`;
}

function completeStallSale(
  state: GameState,
  npc: NpcRecord,
  adventurer: DungeonAdventurer,
  slot: StallSlot,
  item: ItemInstance,
  sentiment: ReturnType<typeof dungeonVerdict>["sentiment"],
  desperate: boolean,
  events: DungeonEvent[],
): void {
  const run = state.run;
  const stall = run?.stall;
  if (!run || !stall) return;
  const price = slot.price;
  const name = MERCHANT_ITEM_DEFINITIONS[item.definitionId]?.trueName ?? item.definitionId;

  state.inventory = state.inventory.filter((entry) => entry.uuid !== item.uuid);
  stall.slots = stall.slots.filter((entry) => entry.itemId !== item.uuid);
  stall.earned += price;
  stall.soldCount += 1;
  state.gold += price;
  adventurer.gold -= price;
  npc.inventoryIds.push(item.uuid);
  item.owner = npc.id;
  item.location = { kind: "npcInventory", npcId: npc.id };
  item.history.push({ day: state.day, type: "sold", detail: `地下${run.floor}階の露店で${npc.name}へ売却`, value: price });
  item.historyV2 ??= [];
  item.historyV2.push({ day: state.day, type: "sold", npcId: npc.id, price, detail: `地下${run.floor}階の露店で売却` });

  // 同じ値でも、誰に売ったかで残るものが変わる。
  const profile = ensureGuardProfile(state, npc);
  if (sentiment === "resented") {
    recordBond(state, npc, "gouged", `地下${run.floor}階の露店で${name}を${price}Gで買わされた`, run.floor);
    adjustGuardProfile(profile, -8);
    npc.relation = Math.max(-100, npc.relation - 6);
  } else if (sentiment === "grateful" || desperate) {
    recordBond(state, npc, "aided", `地下${run.floor}階の露店で${name}を${price}Gで譲られ、窮地を脱した`, run.floor);
    if (sentiment === "grateful") adjustGuardProfile(profile, 4);
    npc.relation = Math.min(100, npc.relation + 2);
  } else {
    recordBond(state, npc, "traded", `地下${run.floor}階の露店で${name}を${price}Gで買った`, run.floor);
    npc.relation = Math.min(100, npc.relation + 1);
  }
  events.push({ type: "stallSold", npcId: npc.id, itemId: item.uuid, price });
}

/**
 * 露店の一手番。
 *
 * 客をさばき、噂を広げ、護衛を消耗させる。護衛が前からいなくなっていれば畳む。
 */
export function stallPhase(state: GameState, events: DungeonEvent[], drawDelver: () => boolean): void {
  const run = state.run;
  const stall = run?.stall;
  if (!run || !stall) return;

  // 護衛がいなくなれば露店は成り立たない。深層に品を抱えて座っているだけになる。
  if (run.guard?.mode !== "covering") {
    closeStall(state, events, true);
    return;
  }

  for (const adventurer of [...run.adventurers]) {
    if (stall.passedNpcIds.includes(adventurer.npcId)) continue;
    if (!atCounter(state, adventurer)) continue;
    serveCustomer(state, adventurer, events);
  }

  // 並べる品が尽きたら、続ける意味はない。
  if (stallGoods(state).length === 0) {
    closeStall(state, events);
    return;
  }

  // じっと座っているのは護衛にとって嫌な仕事である。
  const guardNpc = state.npcs.find((npc) => npc.id === run.guard?.guardId);
  if (guardNpc) adjustGuardProfile(ensureGuardProfile(state, guardNpc), 0, STALL_GUARD_STRESS_PER_TURN);

  // 噂を聞いて誰かが寄ってくる。呼び込みには限りがある。
  const elapsed = run.turn - stall.openedTurn;
  if (stall.drawnCount < STALL_DRAW_MAX && elapsed > 0 && elapsed % STALL_DRAW_INTERVAL === 0) {
    if (drawDelver()) stall.drawnCount += 1;
  }
}
