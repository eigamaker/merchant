import { describe, expect, it } from "vitest";
import { DISPLAY_CAPACITY, beginExpedition, createItem, createNewGame, moveInventoryItems, moveStoreItemsToInventory, setDisplayedItems } from "./engine";
import {
  buySupply,
  canOpenShop,
  closeShopSession,
  consumeDungeonTime,
  dungeonMealProvisionCost,
  dungeonTimeUntilNextMeal,
  depositGold,
  bagCapacity,
  equipBag,
  finishCurrentCustomer,
  isShopSessionActive,
  restUntilMorning,
  startShopSession,
  summonNextCustomer,
  withdrawGold,
  inventoryItemCount,
  PROVISIONS_PER_SLOT,
  provisionCapacityRemaining,
  provisionSlotCount,
  SHOP_CUSTOMER_MAX,
  SHOP_CUSTOMER_MIN,
} from "./merchantSystems";

describe("v6 merchant systems", () => {
  it("moves money between carried gold and the safe home vault", () => {
    const state = createNewGame();
    expect(state.vaultGold).toBe(0);
    expect(depositGold(state, 120)).toBe(true);
    expect(state.gold).toBe(180);
    expect(state.vaultGold).toBe(120);
    expect(withdrawGold(state, 50)).toBe(true);
    expect(state.gold).toBe(230);
    expect(state.vaultGold).toBe(70);
    expect(depositGold(state)).toBe(true);
    expect(state.gold).toBe(0);
    expect(state.vaultGold).toBe(300);

    beginExpedition(state);
    expect(withdrawGold(state, 50)).toBe(false);
    expect(state.gold).toBe(0);
    expect(state.vaultGold).toBe(300);
  });

  it("packs up to ten provisions into each inventory slot", () => {
    const state = createNewGame();
    expect(PROVISIONS_PER_SLOT).toBe(10);
    expect(provisionSlotCount(0)).toBe(0);
    expect(provisionSlotCount(1)).toBe(1);
    expect(provisionSlotCount(10)).toBe(1);
    expect(provisionSlotCount(11)).toBe(2);
    expect(provisionSlotCount(30)).toBe(3);
    expect(inventoryItemCount(state)).toBe(1); // 初期食料3個の束
    const gold = state.gold;
    expect(buySupply(state, "provisions", 7)).toBe(true);
    expect(state.provisions).toBe(10);
    expect(state.gold).toBe(gold - 15 * 7);
    expect(state.dailySupplyStock.provisions).toBe(0);
    expect(inventoryItemCount(state)).toBe(1);
    expect(buySupply(state, "provisions", 1)).toBe(true);
    expect(inventoryItemCount(state)).toBe(2);
  });

  it("limits provision purchases by bag slots instead of shop stock", () => {
    const state = createNewGame();
    state.gold = 2_000;
    state.provisions = 30;
    expect(inventoryItemCount(state)).toBe(3);
    state.inventory.push(...Array.from({ length: bagCapacity(state) - 3 }, () => createItem(state, "old-ring")));
    expect(inventoryItemCount(state)).toBe(bagCapacity(state));
    expect(provisionCapacityRemaining(state)).toBe(0);
    expect(buySupply(state, "provisions", 1)).toBe(false);
    expect(state.provisions).toBe(30);
    expect(state.message).toContain("食料は10個ごとに1枠");
  });

  it("keeps the daily limits for smoke bombs and return stones", () => {
    const state = createNewGame();
    expect(buySupply(state, "smokeBombs", 3)).toBe(false);
    expect(buySupply(state, "smokeBombs", 2)).toBe(true);
    expect(state.dailySupplyStock.smokeBombs).toBe(0);
    expect(buySupply(state, "smokeBombs")).toBe(false);
  });

  it.each(["morning", "afternoon", "evening", "night"] as const)("rests at home during %s and advances to the next morning", (timeSlot) => {
    const state = createNewGame();
    state.timeSlot = timeSlot;
    const day = state.day;

    expect(restUntilMorning(state)).toBe(true);
    expect(state.day).toBe(day + 1);
    expect(state.timeSlot).toBe("morning");
  });

  it("leaves weapons and armour as merchandise, since the merchant cannot wear them", () => {
    const state = createNewGame();
    const sword = createItem(state, "iron-sword", 1);
    const armor = createItem(state, "leather-armor", 1);
    state.inventory.push(sword, armor);
    // 身に着けられるのは道具袋だけ。武器も防具も商品か、冒険者へ預ける品でしかない。
    expect(equipBag(state, sword.uuid)).toBe(false);
    expect(equipBag(state, armor.uuid)).toBe(false);
    expect(state.equipment.bagItemId).not.toBe(sword.uuid);
    expect(state.equipment.bagItemId).not.toBe(armor.uuid);
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
    const stored = Array.from({ length: DISPLAY_CAPACITY }, () => createItem(state, "iron-sword", 1));
    state.inventory.push(...stored);
    moveInventoryItems(state, stored.map((item) => item.uuid), "display");
    const incoming = createItem(state, "old-ring", 1);
    state.inventory.push(incoming);

    expect(moveInventoryItems(state, [incoming.uuid], "display")).toBe(0);
    expect(state.inventory).toContain(incoming);
    expect(state.display).toHaveLength(DISPLAY_CAPACITY);
  });

  it("returns checked stored items to the bag without partially exceeding capacity", () => {
    const state = createNewGame();
    const stored = Array.from({ length: 3 }, () => createItem(state, "iron-sword", 1));
    state.inventory.push(...stored);
    moveInventoryItems(state, stored.map((item) => item.uuid), "storage");

    expect(moveStoreItemsToInventory(state, stored.slice(0, 2).map((item) => item.uuid))).toBe(2);
    expect(state.inventory).toEqual(stored.slice(0, 2));
    expect(state.store).toEqual(stored.slice(2));

    const fillers = Array.from({ length: bagCapacity(state) - state.inventory.length }, () => createItem(state, "old-ring", 1));
    state.inventory.push(...fillers);
    expect(moveStoreItemsToInventory(state, [stored[2]!.uuid])).toBe(0);
    expect(state.store).toContain(stored[2]);
  });

  it("carries what the equipped bag holds, and swaps bags without losing the old one", () => {
    const state = createNewGame();
    expect(bagCapacity(state)).toBe(12);

    const sack = createItem(state, "shoulder-sack");
    state.inventory.push(sack);
    const previousBagId = state.equipment.bagItemId!;
    expect(equipBag(state, sack.uuid)).toBe(true);
    expect(bagCapacity(state)).toBe(18);
    expect(state.equipment.bagItemId).toBe(sack.uuid);
    // 使っていた袋は捨てない。売り物として鞄へ戻る。
    expect(state.inventory.map((item) => item.uuid)).toContain(previousBagId);

    // 小さい袋へ戻すと溢れる荷は、持ち替えそのものを断る。
    state.inventory.push(...Array.from({ length: 16 }, () => createItem(state, "old-ring")));
    expect(equipBag(state, previousBagId)).toBe(false);
    expect(state.equipment.bagItemId).toBe(sack.uuid);
    expect(state.message).toContain("先に荷を減らそう");
  });

  it("reveals one hidden customer at a time and closes at night", () => {
    const state = createNewGame();
    const item = createItem(state, "iron-sword", 1);
    state.store.push(item);
    item.location = { kind: "shopStock" };
    // 誰が来ても買える値にしておく。この試験が見ているのは客の並びであって値付けではない。
    item.askingPrice = 20;
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
    expect(state.shopSession.requestedPrice).toBe(20);
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
    expect(state.timeSlot).toBe("evening");
    expect(state.message).toContain("食料を1個");
    expect(dungeonTimeUntilNextMeal(state)).toBe(30);

    state.run!.guard = { guardId: "test-guard", pos: { ...state.run!.player }, hp: 10, maxHp: 10, damage: 2, mode: "covering", safeTurns: 0, healingTrustGained: 0, retreatCount: 0 };
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

describe("familiar customers", () => {
  it("brings people we have dealt with to the counter more often", () => {
    const state = createNewGame();
    const [familiar, stranger] = state.npcs.filter((npc) => npc.adventurer && npc.status === "inTown");
    familiar!.relation = 20;
    familiar!.bonds = [
      { day: 1, kind: "aided", detail: "薬を譲った", floor: 3 },
      { day: 2, kind: "traded", detail: "石を買った", floor: 2 },
      { day: 3, kind: "served", detail: "買っていった" },
    ];

    let familiarVisits = 0;
    let strangerVisits = 0;
    for (let day = 1; day <= 40; day += 1) {
      state.day = day;
      state.shopSession = { day, status: "closed", queueNpcIds: [], servedNpcIds: [] };
      const shelved = createItem(state, "iron-sword");
      state.store.push(shelved);
      state.display = [shelved.uuid];
      shelved.location = { kind: "shopStock" };
      expect(startShopSession(state)).toBe(true);
      if (state.shopSession.queueNpcIds.includes(familiar!.id)) familiarVisits += 1;
      if (state.shopSession.queueNpcIds.includes(stranger!.id)) strangerVisits += 1;
      state.display = [];
      state.store = [];
    }

    // 縁と関係の重みは決定的な指名ではなく、後押し。確実に上回るが独占はしない。
    expect(familiarVisits).toBeGreaterThan(strangerVisits);
    expect(familiarVisits).toBeGreaterThan(20);
    expect(familiarVisits).toBeLessThan(40);
  });
});
