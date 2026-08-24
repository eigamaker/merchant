import { describe, expect, it } from "vitest";
import { INVENTORY_CAPACITY, beginExpedition, createItem, createNewGame, moveInventoryItems, moveStoreItemsToInventory, performDungeonCommand, setDisplayedItems } from "./engine";
import {
  buySupply,
  canOpenShop,
  closeShopSession,
  consumeDungeonTime,
  dungeonMealProvisionCost,
  dungeonTimeUntilNextMeal,
  equipItem,
  finishCurrentCustomer,
  isShopSessionActive,
  playerAttackPower,
  playerDefensePower,
  restUntilMorning,
  startShopSession,
  summonNextCustomer,
  inventoryItemCount,
  SHOP_CUSTOMER_MAX,
  SHOP_CUSTOMER_MIN,
} from "./merchantSystems";

describe("v6 merchant systems", () => {
  it("keeps supplies outside the twenty-four-item inventory", () => {
    const state = createNewGame();
    expect(inventoryItemCount(state)).toBe(0);
    const gold = state.gold;
    expect(buySupply(state, "provisions")).toBe(true);
    expect(state.provisions).toBe(4);
    expect(state.gold).toBe(gold - 15);
    expect(state.dailySupplyStock.provisions).toBe(5);
    expect(inventoryItemCount(state)).toBe(0);
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

  it("moves checked inventory items in bulk and applies a checked display set", () => {
    const state = createNewGame();
    const items = Array.from({ length: 5 }, () => createItem(state, "iron-sword", 1));
    state.inventory.push(...items);

    expect(moveInventoryItems(state, items.slice(0, 3).map((item) => item.uuid), "display")).toBe(3);
    expect(state.inventory).toEqual(items.slice(3));
    expect(state.store).toEqual(items.slice(0, 3));
    expect(state.display).toEqual(items.slice(0, 3).map((item) => item.uuid));

    expect(moveInventoryItems(state, items.slice(3).map((item) => item.uuid), "storage")).toBe(2);
    expect(setDisplayedItems(state, [items[1]!.uuid, items[4]!.uuid])).toBe(3);
    expect(state.display).toEqual([items[1]!.uuid, items[4]!.uuid]);
    expect(items[0]!.location).toEqual({ kind: "homeStorage" });
    expect(items[4]!.location).toEqual({ kind: "shopStock" });
  });

  it("does not partially move a bulk selection when the display lacks space", () => {
    const state = createNewGame();
    const stored = Array.from({ length: 4 }, () => createItem(state, "iron-sword", 1));
    state.inventory.push(...stored);
    moveInventoryItems(state, stored.map((item) => item.uuid), "display");
    const incoming = createItem(state, "old-ring", 1);
    state.inventory.push(incoming);

    expect(moveInventoryItems(state, [incoming.uuid], "display")).toBe(0);
    expect(state.inventory).toContain(incoming);
    expect(state.display).toHaveLength(4);
  });

  it("returns checked stored items to the bag without partially exceeding capacity", () => {
    const state = createNewGame();
    const stored = Array.from({ length: 3 }, () => createItem(state, "iron-sword", 1));
    state.inventory.push(...stored);
    moveInventoryItems(state, stored.map((item) => item.uuid), "storage");

    expect(moveStoreItemsToInventory(state, stored.slice(0, 2).map((item) => item.uuid))).toBe(2);
    expect(state.inventory).toEqual(stored.slice(0, 2));
    expect(state.store).toEqual(stored.slice(2));

    const fillers = Array.from({ length: INVENTORY_CAPACITY - state.inventory.length }, () => createItem(state, "old-ring", 1));
    state.inventory.push(...fillers);
    expect(moveStoreItemsToInventory(state, [stored[2]!.uuid])).toBe(0);
    expect(state.store).toContain(stored[2]);
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
    expect(state.shopSession.requestedItemId).toBe(item.uuid);
    expect(state.shopSession.requestedPrice).toBeGreaterThan(0);
    finishCurrentCustomer(state);
    expect(state.visitorNpcIds).toEqual([]);
    expect(state.shopSession.requestedItemId).toBeUndefined();
    expect(state.shopSession.requestedPrice).toBeUndefined();
    closeShopSession(state);
    expect(state.timeSlot).toBe("night");
    expect(state.shopSession.status).toBe("finished");
    expect(isShopSessionActive(state)).toBe(false);
    expect(restUntilMorning(state)).toBe(true);
    expect(state.timeSlot).toBe("morning");
  });

  it("varies the daily customer count between three and six", () => {
    const counts = new Set<number>();
    for (let day = 1; day <= 12; day += 1) {
      const state = createNewGame();
      const item = createItem(state, "iron-sword", 1);
      state.day = day;
      state.shopSession.day = day;
      state.store.push(item);
      item.location = { kind: "shopStock" };
      state.display = [item.uuid];
      expect(startShopSession(state)).toBe(true);
      counts.add(state.shopSession.queueNpcIds.length);
      expect(state.shopSession.queueNpcIds.length).toBeGreaterThanOrEqual(SHOP_CUSTOMER_MIN);
      expect(state.shopSession.queueNpcIds.length).toBeLessThanOrEqual(SHOP_CUSTOMER_MAX);
    }
    expect(counts.size).toBeGreaterThan(1);
  });

  it("consumes one provision per party member every thirty actions and damages shortages", () => {
    const state = createNewGame();
    beginExpedition(state);
    state.provisions = 3;
    expect(dungeonMealProvisionCost(state)).toBe(1);
    expect(dungeonTimeUntilNextMeal(state)).toBe(30);
    consumeDungeonTime(state, 10);
    expect(dungeonTimeUntilNextMeal(state)).toBe(20);
    consumeDungeonTime(state, 20);
    expect(state.provisions).toBe(2);
    expect(state.timeSlot).toBe("afternoon");
    expect(state.message).toContain("食料を1個");
    expect(dungeonTimeUntilNextMeal(state)).toBe(30);

    state.run!.guard = { guardId: "test-guard", pos: { ...state.run!.player }, hp: 10, maxHp: 10, damage: 2, mode: "covering", safeTurns: 0 };
    expect(dungeonMealProvisionCost(state)).toBe(2);
    const hp = state.hp;
    consumeDungeonTime(state, 30);
    expect(state.provisions).toBe(0);
    expect(state.hp).toBe(hp);
    expect(state.message).toContain("食料を2個");
    consumeDungeonTime(state, 30);
    expect(state.hp).toBe(hp - 2);
    expect(state.message).toContain("2人分");
    expect(state.message).toContain("2個不足");
    state.location = "home";
    state.run = undefined;
    state.timeSlot = "evening";
    expect(restUntilMorning(state)).toBe(true);
    expect(state.hp).toBe(state.maxHp);
    expect(state.timeSlot).toBe("morning");
  });
});
