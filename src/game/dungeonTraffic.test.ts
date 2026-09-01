import { describe, expect, it } from "vitest";
import { beginExpedition, createItem, createNewGame, performDungeonCommand, waitTurn } from "./engine";
import { postEscortCommission } from "./merchantEconomy";
import { ensureGuardProfile } from "./guardProfiles";
import { recordBond } from "./npcBonds";
import { betrayalRisk } from "./guardBetrayal";
import {
  FLOOR_CROWD_MAX,
  HOLDUP_RISK,
  holdupRisk,
  trafficChance,
  willRescue,
} from "./dungeonTraffic";
import type { GameState, NpcRecord } from "./types";

/** 深層に、重い鞄と、開けた床を用意する。 */
function deepFloor(state: GameState): void {
  beginExpedition(state);
  const run = state.run!;
  run.floor = 7;
  run.highestFloor = 7;
  run.enemies = [];
  run.adventurers = [];
  run.items = [];
  run.chests = [];
  run.bodies = [];
  run.player = { x: 10, y: 10 };
  for (let y = 6; y <= 14; y += 1) for (let x = 6; x <= 14; x += 1) run.map.tiles[y]![x] = 0;
  for (let index = 0; index < 6; index += 1) state.inventory.push(createItem(state, "rune-tablet", 7));
}

/** その相手を、商人の隣に立たせる。 */
function standBeside(state: GameState, npc: NpcRecord, offset = 1): void {
  const run = state.run!;
  const maxHp = npc.maxHp ?? 12;
  run.adventurers.push({
    npcId: npc.id,
    pos: { x: run.player.x + offset, y: run.player.y },
    arrivedTurn: run.turn,
    hp: maxHp,
    maxHp,
    damage: npc.damage ?? 4,
    gold: 500,
  });
}

function pickOther(state: GameState, exclude: readonly string[] = []): NpcRecord {
  return state.npcs.find((npc) => npc.adventurer && npc.status !== "dead" && !exclude.includes(npc.id))!;
}

describe("dungeon traffic", () => {
  it("caps arrivals at two adventurers on a floor", () => {
    expect(FLOOR_CROWD_MAX).toBe(2);
  });

  it("thins the traffic the deeper the merchant goes", () => {
    // 浅い階には人がいる。深さとは、助けが来ない距離のことである。
    expect(trafficChance(1)).toBeGreaterThan(trafficChance(4));
    expect(trafficChance(4)).toBeGreaterThan(trafficChance(8));
    expect(trafficChance(8)).toBeGreaterThan(0);
  });

  it("keeps a guard standing in front from tempting most passers-by", () => {
    const state = createNewGame();
    state.gold += 2000;
    postEscortCommission(state, "rolf");
    deepFloor(state);
    const robber = pickOther(state, ["rolf"]);
    const profile = ensureGuardProfile(state, robber);
    // 並の欲深さ。護衛が前にいれば思いとどまり、いなくなれば手を出す。
    Object.assign(profile.personality, { greed: 70, integrity: 45 });
    Object.assign(profile, { trust: 0 });

    const guarded = holdupRisk(state, robber, profile);
    state.run!.guard!.mode = "retreated";
    const exposed = holdupRisk(state, robber, profile);

    expect(exposed).toBeGreaterThan(guarded);
    expect(guarded).toBeLessThan(HOLDUP_RISK);
    expect(exposed).toBeGreaterThanOrEqual(HOLDUP_RISK);
  });

  it("does not stop a truly ruthless one, guard or no guard", () => {
    const state = createNewGame();
    state.gold += 2000;
    postEscortCommission(state, "rolf");
    deepFloor(state);
    const robber = pickOther(state, ["rolf"]);
    const profile = ensureGuardProfile(state, robber);
    Object.assign(profile.personality, { greed: 95, integrity: 15 });
    Object.assign(profile, { trust: 0 });
    // 護衛を立てていても、本当に見境のない相手は手を出してくる。
    expect(holdupRisk(state, robber, profile)).toBeGreaterThanOrEqual(HOLDUP_RISK);
  });

  it("blocks the way with a holdup and refuses every other command until answered", () => {
    const state = createNewGame();
    deepFloor(state);
    const robber = pickOther(state);
    const profile = ensureGuardProfile(state, robber);
    Object.assign(profile.personality, { greed: 95, integrity: 15 });
    Object.assign(profile, { trust: 0 });
    robber.relation = 0;
    standBeside(state, robber);

    const turn = waitTurn(state);

    expect(turn.holdup?.npcId).toBe(robber.id);
    expect(state.run!.holdup).toBeDefined();
    expect(state.message).toContain("行く手に立った");

    const blocked = performDungeonCommand(state, { type: "move", direction: { x: 0, y: 1 } });
    expect(blocked.consumedTurn).toBe(false);
    expect(state.message).toContain("返事をするまで");
  });

  it("hands over gold and is let through", () => {
    const state = createNewGame();
    state.gold = 1200;
    deepFloor(state);
    const robber = pickOther(state);
    const profile = ensureGuardProfile(state, robber);
    Object.assign(profile.personality, { greed: 95, integrity: 15 });
    Object.assign(profile, { trust: 0 });
    standBeside(state, robber);
    waitTurn(state);
    const holdup = state.run!.holdup!;
    expect(holdup.takesGoods).toBe(false);
    const carried = state.inventory.length;

    performDungeonCommand(state, { type: "answerHoldup", hand: true });

    expect(state.gold).toBe(1200 - holdup.amount);
    expect(state.inventory).toHaveLength(carried);
    // 「出せば通してやる」と言った以上、同じ相手が二度は呼び止めない。
    expect(state.run!.holdup).toBeUndefined();
    expect(state.run!.holdupSettledNpcIds).toContain(robber.id);
    waitTurn(state);
    expect(state.run!.holdup).toBeUndefined();
    expect(profile.career.holdupCount).toBe(1);
    expect(robber.bonds?.some((bond) => bond.kind === "waylaid")).toBe(true);
  });

  it("takes half the bag when the merchant has no coin to give", () => {
    const state = createNewGame();
    state.gold = 0;
    deepFloor(state);
    const robber = pickOther(state);
    const profile = ensureGuardProfile(state, robber);
    Object.assign(profile.personality, { greed: 95, integrity: 15 });
    Object.assign(profile, { trust: 0 });
    standBeside(state, robber);
    waitTurn(state);
    const holdup = state.run!.holdup!;
    expect(holdup.takesGoods).toBe(true);
    const carried = state.inventory.length;

    performDungeonCommand(state, { type: "answerHoldup", hand: true });

    expect(state.inventory.length).toBeLessThan(carried);
    expect(state.inventory.length).toBeGreaterThan(0);
    expect(robber.inventoryIds.length).toBeGreaterThan(0);
  });

  it("cuts the merchant down when the refusal leaves nobody standing in front", () => {
    const state = createNewGame();
    state.gold = 800;
    deepFloor(state);
    const robber = pickOther(state);
    const profile = ensureGuardProfile(state, robber);
    Object.assign(profile.personality, { greed: 95, integrity: 15 });
    Object.assign(profile, { trust: 0 });
    standBeside(state, robber);
    waitTurn(state);
    const hpBefore = state.hp;

    performDungeonCommand(state, { type: "answerHoldup", hand: false });

    // 商人は戦えない。誰も前にいなければ、そのまま斬られる。
    expect(state.hp).toBeLessThan(hpBefore);
    expect(state.message).toContain("一撃");
  });

  it("lets a guard earn the fee by stepping in front of the robber", () => {
    const state = createNewGame();
    state.gold = 2000;
    postEscortCommission(state, "rolf");
    deepFloor(state);
    const guardNpc = state.npcs.find((npc) => npc.id === "rolf")!;
    Object.assign(ensureGuardProfile(state, guardNpc).personality, { integrity: 80 });
    state.run!.guard!.pos = { ...state.run!.player };
    const robber = pickOther(state, ["rolf"]);
    const robberProfile = ensureGuardProfile(state, robber);
    Object.assign(robberProfile.personality, { greed: 95, integrity: 15 });
    Object.assign(robberProfile, { trust: 0 });
    standBeside(state, robber);
    // 護衛が前にいると誰も手を出さないので、この試験だけ直に呼び止めさせる。
    state.run!.holdup = { npcId: robber.id, amount: 500, takesGoods: false, floor: 7, turn: state.run!.turn };
    const hpBefore = state.hp;
    const robberHpBefore = state.run!.adventurers[0]!.hp;

    performDungeonCommand(state, { type: "answerHoldup", hand: false });

    expect(state.hp).toBe(hpBefore);
    expect(state.run!.adventurers[0]?.hp ?? 0).toBeLessThan(robberHpBefore);
    expect(ensureGuardProfile(state, guardNpc).career.rescueCount).toBe(1);
  });

  it("lets a trusted bystander shield the merchant who has no guard", () => {
    const state = createNewGame();
    state.gold = 800;
    deepFloor(state);
    const robber = pickOther(state);
    const robberProfile = ensureGuardProfile(state, robber);
    Object.assign(robberProfile.personality, { greed: 95, integrity: 15 });
    Object.assign(robberProfile, { trust: 0 });
    standBeside(state, robber, 1);

    // 縁を積んできた相手が、たまたま同じ階にいた。
    const friend = pickOther(state, [robber.id]);
    recordBond(state, friend, "foughtTogether", "共に生還した");
    const friendProfile = ensureGuardProfile(state, friend);
    Object.assign(friendProfile, { trust: 80 });
    expect(willRescue(friend, friendProfile)).toBe(true);
    standBeside(state, friend, -1);

    waitTurn(state);
    expect(state.run!.holdup).toBeDefined();
    const hpBefore = state.hp;

    performDungeonCommand(state, { type: "answerHoldup", hand: false });

    expect(state.hp).toBe(hpBefore);
    expect(ensureGuardProfile(state, friend).career.rescueCount).toBe(1);
    expect(friend.bonds?.some((bond) => bond.kind === "rescued")).toBe(true);
  });

  it("makes a newcomer on the floor call off a guard who was about to turn", () => {
    const state = createNewGame();
    state.gold += 3000;
    postEscortCommission(state, "rolf");
    deepFloor(state);
    const guardNpc = state.npcs.find((npc) => npc.id === "rolf")!;
    const profile = ensureGuardProfile(state, guardNpc);
    Object.assign(profile.personality, { greed: 95, integrity: 15, empathy: 20, discipline: 30 });
    Object.assign(profile, { trust: 0, stress: 40 });
    state.run!.guard!.pos = { ...state.run!.player };

    // 独りでいるあいだは、確かに影が差している。
    expect(betrayalRisk(state, guardNpc, profile).score).toBeGreaterThan(0);
    waitTurn(state);
    expect(state.run!.demand).toBeDefined();

    // そこへ誰かが入ってくる。それだけで話は消える。
    standBeside(state, pickOther(state, ["rolf"]), 3);
    performDungeonCommand(state, { type: "answerDemand", pay: false });

    expect(state.run!.demand).toBeUndefined();
    expect(state.inventory.length).toBeGreaterThan(0);
    expect(state.gold).toBeGreaterThan(0);
  });

  it("never crowds the floor past its limit", () => {
    const state = createNewGame();
    deepFloor(state);
    state.run!.floor = 1;
    for (const npc of state.npcs.filter((entry) => entry.adventurer).slice(0, 8)) {
      npc.status = "delving";
      npc.delve = { floor: 1, departedDay: state.day };
    }
    for (let turn = 0; turn < 60; turn += 1) {
      if (state.run?.holdup) performDungeonCommand(state, { type: "answerHoldup", hand: true });
      else waitTurn(state);
      if (!state.run) break;
      expect(state.run.adventurers.length).toBeLessThanOrEqual(FLOOR_CROWD_MAX);
    }
  });
});
