import { describe, expect, it } from "vitest";
import { beginExpedition, createItem, createNewGame, performDungeonCommand, returnHome, waitTurn } from "./engine";
import { postEscortCommission } from "./merchantEconomy";
import { equipBag } from "./merchantSystems";
import {
  STALL_GUARD_STRESS_PER_TURN,
  STALL_MIN_SLOTS,
  stallCapacity,
  stallGoods,
  stallReadiness,
} from "./dungeonStall";
import type { GameState, NpcRecord } from "./types";

/** 露店を開ける状態まで持っていく。護衛を雇い、敵と冒険者を退けた開けた床に立たせる。 */
function pitchCamp(state: GameState, guardId = "rolf"): void {
  state.gold += 2000;
  expect(postEscortCommission(state, guardId)?.id).toBe(guardId);
  beginExpedition(state);
  const run = state.run!;
  run.enemies = [];
  run.adventurers = [];
  run.items = [];
  run.chests = [];
  run.bodies = [];
  run.player = { x: 10, y: 10 };
  run.guard!.pos = { ...run.player };
  // 商人の周りを掘って、風呂敷を広げられる床を作る。
  for (let y = 7; y <= 13; y += 1) for (let x = 7; x <= 13; x += 1) run.map.tiles[y]![x] = 0;
  run.map.stairsUp = { x: 2, y: 2 };
  run.map.stairsDown = { x: 3, y: 2 };
}

/** 露店の客を1人、隣に立たせる。 */
function seatCustomer(state: GameState, options: { interests?: NpcRecord["interests"]; gold?: number; hp?: number } = {}): NpcRecord {
  const run = state.run!;
  const npc = state.npcs.find((entry) => entry.adventurer && entry.id !== run.guard?.guardId && entry.status !== "dead")!;
  if (options.interests) npc.interests = [...options.interests];
  run.adventurers.push({
    npcId: npc.id,
    pos: { x: run.player.x + 1, y: run.player.y },
    hp: options.hp ?? 10,
    maxHp: 10,
    damage: 3,
    gold: options.gold ?? 5000,
  });
  return npc;
}

describe("dungeon stall", () => {
  it("scales the cloth with the bag and needs a covering guard to spread it", () => {
    const state = createNewGame();
    // 風呂敷12枠なら床に置けるのは4点。何を並べるかそのものが商いになる。
    expect(stallCapacity(state)).toBe(4);
    const bigger = createNewGame();
    bigger.inventory.push(createItem(bigger, "caravan-pack"));
    expect(equipBag(bigger, bigger.inventory.at(-1)!.uuid)).toBe(true);
    expect(stallCapacity(bigger)).toBe(10);

    const solo = createNewGame();
    beginExpedition(solo);
    solo.inventory.push(createItem(solo, "minor-healing-potion"), createItem(solo, "antidote"));
    const refusal = stallReadiness(solo);
    expect(refusal.allowed).toBe(false);
    expect(refusal.reason).toBe("noGuard");
    expect(refusal.message).toContain("無防備");
  });

  it("refuses to spread the cloth with enemies close by", () => {
    const state = createNewGame();
    pitchCamp(state);
    state.inventory.push(createItem(state, "minor-healing-potion"), createItem(state, "antidote"));
    const run = state.run!;
    run.enemies = [{ id: "e1", name: "見張り", pos: { x: run.player.x + 2, y: run.player.y }, hp: 5, maxHp: 5, damage: 1, state: "patrol", staggerTurns: 0 }];
    const refusal = stallReadiness(state);
    expect(refusal.allowed).toBe(false);
    expect(refusal.reason).toBe("enemiesNear");
  });

  it("lays goods on the floor without taking them out of the bag", () => {
    const state = createNewGame();
    pitchCamp(state);
    const potion = createItem(state, "minor-healing-potion");
    const antidote = createItem(state, "antidote");
    state.inventory.push(potion, antidote);

    const result = performDungeonCommand(state, {
      type: "openStall",
      goods: [{ itemId: potion.uuid, price: 300 }, { itemId: antidote.uuid, price: 200 }],
    });

    expect(result.consumedTurn).toBe(true);
    const stall = state.run!.stall!;
    expect(stall.slots).toHaveLength(2);
    // 並べても品は鞄の中にある。露店は在庫を移すのではなく、鞄の中身を床に見せているだけ。
    expect(state.inventory.map((item) => item.uuid)).toEqual(expect.arrayContaining([potion.uuid, antidote.uuid]));
    expect(stallGoods(state)).toHaveLength(2);
    // 枠はどれも商人の隣接升で、足元とは重ならない。
    for (const slot of stall.slots) {
      expect(slot.pos).not.toEqual(state.run!.player);
      expect(Math.abs(slot.pos.x - state.run!.player.x) + Math.abs(slot.pos.y - state.run!.player.y)).toBeLessThanOrEqual(4);
    }
    expect(result.events.some((event) => event.type === "stallOpened")).toBe(true);
  });

  it("needs at least two goods on the cloth", () => {
    const state = createNewGame();
    pitchCamp(state);
    const potion = createItem(state, "minor-healing-potion");
    state.inventory.push(potion);

    const result = performDungeonCommand(state, { type: "openStall", goods: [{ itemId: potion.uuid, price: 300 }] });

    expect(result.consumedTurn).toBe(false);
    expect(state.run!.stall).toBeUndefined();
    expect(state.message).toContain(`${STALL_MIN_SLOTS}点`);
  });

  it("sells to a wounded adventurer at many times the market price", () => {
    const state = createNewGame();
    pitchCamp(state);
    const potion = createItem(state, "minor-healing-potion");
    const antidote = createItem(state, "antidote");
    state.inventory.push(potion, antidote);
    // 深く傷ついた相手。他に店のない地下で、回復薬を握っているのは商人だけである。
    const customer = seatCustomer(state, { interests: ["medicine"], hp: 3 });
    const goldBefore = state.gold;

    // 広げた手番から時間は流れる。隣に立っていた相手はその場で品を見る。
    performDungeonCommand(state, {
      type: "openStall",
      goods: [{ itemId: potion.uuid, price: 180 }, { itemId: antidote.uuid, price: 999 }],
    });

    // 相場36Gの薬が180Gで通る。5倍でも成り立つのは、相手が本当に困っているからである。
    expect(state.gold).toBe(goldBefore + 180);
    expect(state.run!.stall!.earned).toBe(180);
    expect(state.run!.stall!.soldCount).toBe(1);
    expect(state.inventory.map((item) => item.uuid)).not.toContain(potion.uuid);
    expect(customer.inventoryIds).toContain(potion.uuid);
    expect(customer.bonds?.some((bond) => bond.kind === "aided" || bond.kind === "gouged")).toBe(true);
  });

  it("turns away a customer who wants nothing on the cloth, and does not ask twice", () => {
    const state = createNewGame();
    pitchCamp(state);
    const sword = createItem(state, "iron-sword");
    const spear = createItem(state, "bronze-spear");
    state.inventory.push(sword, spear);
    // 薬しか欲しくない相手に武器を並べても、何倍だろうと売れない。
    const customer = seatCustomer(state, { interests: ["medicine"], hp: 10 });
    performDungeonCommand(state, {
      type: "openStall",
      goods: [{ itemId: sword.uuid, price: 100 }, { itemId: spear.uuid, price: 200 }],
    });

    expect(state.run!.stall!.soldCount).toBe(0);
    expect(state.run!.stall!.passedNpcIds).toContain(customer.id);
    expect(state.message).toContain("何も買わずに");
  });

  it("wears the guard down for every turn the cloth stays open", () => {
    const state = createNewGame();
    pitchCamp(state);
    state.inventory.push(createItem(state, "minor-healing-potion"), createItem(state, "antidote"));
    const guardNpc = state.npcs.find((npc) => npc.id === state.run!.guard!.guardId)!;
    guardNpc.guardProfile!.stress = 0;
    performDungeonCommand(state, {
      type: "openStall",
      goods: state.inventory.map((item) => ({ itemId: item.uuid, price: 100 })),
    });
    const stressAfterOpening = guardNpc.guardProfile!.stress;

    waitTurn(state);
    waitTurn(state);

    // じっと座っているのは護衛にとって嫌な仕事である。
    expect(guardNpc.guardProfile!.stress).toBe(stressAfterOpening + STALL_GUARD_STRESS_PER_TURN * 2);
  });

  it("folds the cloth the moment the guard stops covering", () => {
    const state = createNewGame();
    pitchCamp(state);
    state.inventory.push(createItem(state, "minor-healing-potion"), createItem(state, "antidote"));
    performDungeonCommand(state, {
      type: "openStall",
      goods: state.inventory.map((item) => ({ itemId: item.uuid, price: 100 })),
    });
    expect(state.run!.stall).toBeDefined();

    // 護衛が前からいなくなれば、深層に品を抱えて座っているだけになる。
    state.run!.guard!.mode = "retreated";
    const turn = waitTurn(state);

    expect(state.run!.stall).toBeUndefined();
    expect(turn.events.some((event) => event.type === "stallClosed")).toBe(true);
    // 品はもともと鞄にあるので、畳んでも何も失わない。
    expect(state.inventory).toHaveLength(2);
  });

  it("folds the cloth on the way home and keeps every unsold item", () => {
    const state = createNewGame();
    pitchCamp(state);
    state.inventory.push(createItem(state, "minor-healing-potion"), createItem(state, "antidote"));
    performDungeonCommand(state, {
      type: "openStall",
      goods: state.inventory.map((item) => ({ itemId: item.uuid, price: 100 })),
    });
    const carried = state.inventory.map((item) => item.uuid);

    returnHome(state);

    expect(state.run).toBeUndefined();
    expect(state.inventory.map((item) => item.uuid)).toEqual(carried);
  });
});
