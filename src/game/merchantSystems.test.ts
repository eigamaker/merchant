import { describe, expect, it } from "vitest";
import { beginExpedition, createItem, createNewGame, performDungeonCommand } from "./engine";
import {
  buySupply,
  canOpenShop,
  closeShopSession,
  consumeDungeonTime,
  equipItem,
  finishCurrentCustomer,
  isShopSessionActive,
  playerAttackPower,
  playerDefensePower,
  restUntilMorning,
  startShopSession,
  summonNextCustomer,
  totalBulk,
} from "./merchantSystems";

describe("v6 merchant systems", () => {
  it("counts supplies in bag bulk and buys them from daily supplier stock", () => {
    const state = createNewGame();
    expect(totalBulk(state)).toBe(3);
    const gold = state.gold;
    expect(buySupply(state, "provisions")).toBe(true);
    expect(state.provisions).toBe(4);
    expect(state.gold).toBe(gold - 15);
    expect(state.dailySupplyStock.provisions).toBe(5);
    expect(totalBulk(state)).toBe(4);
  });

  it("equips one weapon and armor and exposes their combat values", () => {
    const state = createNewGame();
    const sword = createItem(state, "iron-sword", 1);
    const armor = createItem(state, "leather-armor", 1);
    state.inventory.push(sword, armor);
    expect(equipItem(state, sword.uuid)).toBe(true);
    expect(equipItem(state, armor.uuid)).toBe(true);
    expect(playerAttackPower(state)).toBe(2);
    expect(playerDefensePower(state)).toBe(1);
  });

  it("attacks only the front tile and consumes a turn when a target exists", () => {
    const state = createNewGame();
    beginExpedition(state);
    const run = state.run!;
    const enemy = run.enemies[0]!;
    run.enemies = [enemy];
    run.player = { x: 5, y: 5 };
    enemy.pos = { x: 6, y: 5 };
    enemy.hp = 3;
    run.map.tiles[5]![5] = run.map.tiles[5]![6] = 0;
    const before = run.turn;
    const hit = performDungeonCommand(state, { type: "attack", direction: { x: 1, y: 0 } });
    expect(hit.consumedTurn).toBe(true);
    expect(run.turn).toBe(before + 1);
    const miss = performDungeonCommand(state, { type: "attack", direction: { x: 0, y: -1 } });
    expect(miss.consumedTurn).toBe(false);
  });

  it("reveals one hidden customer at a time and closes at night", () => {
    const state = createNewGame();
    const item = createItem(state, "iron-sword", 1);
    state.store.push(item);
    item.location = { kind: "shopStock" };
    state.display = [item.uuid];
    expect(canOpenShop(state)).toBe(true);
    expect(startShopSession(state)).toBe(true);
    expect(isShopSessionActive(state)).toBe(true);
    expect(state.visitorNpcIds).toEqual([]);
    state.shopSession.status = "waiting";
    const first = summonNextCustomer(state);
    expect(first).toBeTruthy();
    expect(state.visitorNpcIds).toEqual([first]);
    finishCurrentCustomer(state);
    expect(state.visitorNpcIds).toEqual([]);
    closeShopSession(state);
    expect(state.timeSlot).toBe("night");
    expect(state.shopSession.status).toBe("finished");
    expect(isShopSessionActive(state)).toBe(false);
    expect(restUntilMorning(state)).toBe(true);
    expect(state.timeSlot).toBe("morning");
  });

  it("consumes food each dungeon time band, damages starvation, and resting heals", () => {
    const state = createNewGame();
    beginExpedition(state);
    state.provisions = 1;
    consumeDungeonTime(state, 25);
    expect(state.provisions).toBe(0);
    expect(state.timeSlot).toBe("afternoon");
    const hp = state.hp;
    consumeDungeonTime(state, 25);
    expect(state.hp).toBe(hp - 2);
    state.location = "home";
    state.run = undefined;
    state.timeSlot = "evening";
    expect(restUntilMorning(state)).toBe(true);
    expect(state.hp).toBe(state.maxHp);
    expect(state.timeSlot).toBe("morning");
  });
});
