import { describe, expect, it } from "vitest";
import { beginExpedition, createItem, createNewGame, performDungeonCommand, returnHome, waitTurn } from "./engine";
import { postEscortCommission } from "./merchantEconomy";
import { ensureGuardProfile } from "./guardProfiles";
import {
  BETRAYAL_RISK,
  DEMAND_RISK,
  OMEN_RISK,
  betrayalRisk,
  carriedValue,
} from "./guardBetrayal";
import type { GameState, NpcRecord } from "./types";

/** 深層に、重い鞄と、誰も見ていない状況を作る。 */
function deepAndAlone(state: GameState, guardId = "rolf"): NpcRecord {
  state.gold += 3000;
  expect(postEscortCommission(state, guardId)?.id).toBe(guardId);
  beginExpedition(state);
  const run = state.run!;
  run.floor = 8;
  run.highestFloor = 8;
  run.enemies = [];
  run.adventurers = [];
  run.items = [];
  run.chests = [];
  run.bodies = [];
  run.player = { x: 10, y: 10 };
  run.guard!.pos = { ...run.player };
  for (let y = 8; y <= 12; y += 1) for (let x = 8; x <= 12; x += 1) run.map.tiles[y]![x] = 0;
  // 目当てになるだけの荷。
  for (let index = 0; index < 6; index += 1) state.inventory.push(createItem(state, "rune-tablet", 8));
  return state.npcs.find((npc) => npc.id === guardId)!;
}

/** 何をしてもおかしくない人物にする。 */
function makeGreedy(state: GameState, npc: NpcRecord): void {
  const profile = ensureGuardProfile(state, npc);
  Object.assign(profile.personality, { greed: 95, integrity: 15, empathy: 20, discipline: 30, courage: 60 });
  Object.assign(profile, { trust: 0, stress: 40 });
}

/** 何があっても手を出さない人物にする。 */
function makeHonest(state: GameState, npc: NpcRecord): void {
  const profile = ensureGuardProfile(state, npc);
  Object.assign(profile.personality, { greed: 10, integrity: 95, empathy: 80, discipline: 85, courage: 60 });
  Object.assign(profile, { trust: 70, stress: 0 });
}

describe("guard betrayal", () => {
  it("needs depth, greed and an empty corridor — a witness ends it", () => {
    const state = createNewGame();
    const npc = deepAndAlone(state);
    makeGreedy(state, npc);
    const profile = ensureGuardProfile(state, npc);

    const alone = betrayalRisk(state, npc, profile);
    expect(alone.witnesses).toBe(0);
    expect(alone.score).toBeGreaterThanOrEqual(DEMAND_RISK);

    // 同じ相手、同じ荷、同じ深さでも、見ている者がひとりいれば話そのものが起きない。
    state.run!.adventurers.push({ npcId: "someone", pos: { x: 12, y: 12 }, hp: 10, maxHp: 10, damage: 3, gold: 100 });
    expect(betrayalRisk(state, npc, profile).witnesses).toBe(1);
    waitTurn(state);
    expect(state.run!.demand).toBeUndefined();
    expect(state.run!.guard).toBeDefined();
    expect(state.inventory.length).toBeGreaterThan(0);
  });

  it("withdraws a standing demand the moment someone walks onto the floor", () => {
    const state = createNewGame();
    const npc = deepAndAlone(state);
    makeGreedy(state, npc);
    waitTurn(state);
    expect(state.run!.demand).toBeDefined();

    state.run!.adventurers.push({ npcId: "witness", pos: { x: 12, y: 12 }, hp: 10, maxHp: 10, damage: 3, gold: 100 });
    performDungeonCommand(state, { type: "answerDemand", pay: false });

    expect(state.run!.demand).toBeUndefined();
    expect(state.message).toContain("人影");
    expect(state.inventory.length).toBeGreaterThan(0);
  });

  it("leaves an honest guard well below every threshold in the same spot", () => {
    const state = createNewGame();
    const npc = deepAndAlone(state);
    makeHonest(state, npc);
    expect(betrayalRisk(state, npc, ensureGuardProfile(state, npc)).score).toBeLessThan(OMEN_RISK);
  });

  it("stays quiet on a shallow floor with a light bag", () => {
    const state = createNewGame();
    const npc = deepAndAlone(state);
    makeGreedy(state, npc);
    // 推奨階の内側へ戻し、荷を降ろす。深さも動機も無ければ、何も起きない。
    state.run!.floor = 2;
    state.inventory = [];
    expect(carriedValue(state)).toBe(0);
    expect(betrayalRisk(state, npc, ensureGuardProfile(state, npc)).score).toBeLessThan(OMEN_RISK);
  });

  it("blocks the corridor with a demand, and refuses every other command until answered", () => {
    const state = createNewGame();
    const npc = deepAndAlone(state);
    makeGreedy(state, npc);

    const turn = waitTurn(state);

    const demand = state.run!.demand!;
    expect(demand).toBeDefined();
    expect(turn.guardDemand?.guardId).toBe(npc.id);
    expect(demand.amount).toBeGreaterThan(0);
    expect(demand.amount).toBeLessThanOrEqual(state.gold);
    expect(state.message).toContain("行く手を塞いだ");

    // 返事をするまで一歩も動けない。
    const blocked = performDungeonCommand(state, { type: "move", direction: { x: 1, y: 0 } });
    expect(blocked.consumedTurn).toBe(false);
    expect(state.message).toContain("返事をするまで");
  });

  it("takes the money and stands back up when paid", () => {
    const state = createNewGame();
    const npc = deepAndAlone(state);
    makeGreedy(state, npc);
    waitTurn(state);
    const demand = state.run!.demand!;
    const goldBefore = state.gold;
    const carried = state.inventory.length;

    performDungeonCommand(state, { type: "answerDemand", pay: true });

    expect(state.gold).toBe(goldBefore - demand.amount);
    expect(state.inventory).toHaveLength(carried);
    expect(state.run!.guard).toBeDefined();
    const profile = ensureGuardProfile(state, npc);
    expect(profile.career.extortionCount).toBe(1);
    expect(npc.bonds?.some((bond) => bond.kind === "extorted")).toBe(true);
    // 払っても信用は戻らない。この人物が何をする人かは分かってしまった。
    expect(profile.trust).toBe(0);
  });

  it("takes the bag, the gold and the return stones when the demand is refused", () => {
    const state = createNewGame();
    const npc = deepAndAlone(state);
    makeGreedy(state, npc);
    state.returnStones = 2;
    waitTurn(state);
    expect(state.run!.demand).toBeDefined();
    const stolenGold = state.gold;
    const stolenItems = state.inventory.map((item) => item.uuid);
    const bagId = state.equipment.bagItemId;

    // 答えを聞いた手番では、まだ何も起きない。商人にはこの一手だけ逃げる隙がある。
    performDungeonCommand(state, { type: "answerDemand", pay: false });
    expect(state.inventory.map((item) => item.uuid)).toEqual(stolenItems);
    expect(betrayalRisk(state, npc, ensureGuardProfile(state, npc)).score).toBeGreaterThanOrEqual(BETRAYAL_RISK);

    // 腹を決めるのは次の一手である。
    const turn = waitTurn(state);

    expect(turn.events.some((event) => event.type === "guardBetrayed")).toBe(true);
    expect(state.gold).toBe(0);
    expect(state.inventory).toEqual([]);
    expect(state.returnStones).toBe(0);
    // 空の袋は売れない。道具袋だけは置いていく。
    expect(state.equipment.bagItemId).toBe(bagId);
    // 命までは取らない。取る必要がないからである。
    expect(state.hp).toBeGreaterThan(0);
    expect(state.location).toBe("dungeon");

    expect(state.run!.guard).toBeUndefined();
    expect(state.hiredGuardId).toBeUndefined();
    expect(npc.status).toBe("inTown");
    expect(npc.inventoryIds).toEqual(expect.arrayContaining(stolenItems));
    const profile = ensureGuardProfile(state, npc);
    expect(profile.career.betrayalCount).toBe(1);
    expect(profile.career.events.at(-1)?.type).toBe("betrayed");
    expect(npc.bonds?.at(-1)?.kind).toBe("betrayed");
    expect(stolenGold).toBeGreaterThan(0);
    expect(state.message).toContain("ひとり残された");
  });

  it("rewards a guard who had every reason and did nothing", () => {
    const state = createNewGame();
    const npc = deepAndAlone(state);
    makeHonest(state, npc);
    const profile = ensureGuardProfile(state, npc);
    const trustBefore = profile.trust;
    // 疑う理由はあった —— 深く、荷は重く、誰も見ていなかった。
    state.run!.betrayalPeak = OMEN_RISK + 5;

    returnHome(state);

    expect(profile.trust).toBeGreaterThan(trustBefore);
    expect(profile.career.events.some((event) => event.detail.includes("誰も見ていない深さ"))).toBe(true);
  });
});
