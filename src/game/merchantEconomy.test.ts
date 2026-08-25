import { describe, expect, it } from "vitest";
import { beginExpedition, createItem, createNewGame, descend, returnHome, waitTurn } from "./engine";
import { ADVENTURER_RANKS, ITEM_VISUALS, MERCHANT_ITEM_DEFINITIONS, NPC_APPEARANCES } from "./merchantContent";
import { acceptCustomerPurchaseRequest, cancelEscortCommission, createGeneratedAdventurer, createGeneratedDeadAdventurer, escortFeeForNpc, postEscortCommission, prepareCustomerPurchaseRequest } from "./merchantEconomy";
import { startShopSession, summonNextCustomer } from "./merchantSystems";

describe("v6 merchant world", () => {
  it("defines 15 replaceable item visuals and a ranked NPC roster", () => {
    expect(Object.keys(MERCHANT_ITEM_DEFINITIONS)).toHaveLength(15);
    expect(new Set(Object.values(MERCHANT_ITEM_DEFINITIONS).map((item) => item.category))).toEqual(
      new Set(["weapon", "armor", "medicine", "material", "curio"]),
    );
    expect(Object.values(MERCHANT_ITEM_DEFINITIONS).every((item) => ITEM_VISUALS[item.visualId!]?.endsWith(".png"))).toBe(true);

    const state = createNewGame();
    expect(state.npcs).toHaveLength(15);
    expect(state.npcs.filter((npc) => npc.adventurer)).toHaveLength(10);
    expect(new Set(state.npcs.filter((npc) => npc.adventurer).map((npc) => npc.rank))).toEqual(new Set(["E", "D", "C", "B", "A"]));
    expect(state.visitorNpcIds).toHaveLength(0);
    expect(state.npcs.every((npc) => Boolean(NPC_APPEARANCES[npc.appearanceId]))).toBe(true);
    expect(Object.keys(state.itemsById)).toHaveLength(10);
  });

  it("keeps customers hidden until opening and excludes unavailable NPCs", () => {
    const state = createNewGame();
    const unavailable = state.npcs[0]!;
    unavailable.status = "dead";
    const stock = createItem(state, "iron-sword", 1);
    state.store.push(stock);
    state.display.push(stock.uuid);
    stock.location = { kind: "shopStock" };
    expect(startShopSession(state)).toBe(true);
    expect(state.visitorNpcIds).toEqual([]);
    state.shopSession.status = "waiting";
    const customerId = summonNextCustomer(state);

    expect(state.visitorNpcIds).toEqual([customerId]);
    expect(state.visitorNpcIds).not.toContain(unavailable.id);
    expect(state.npcs.find((npc) => npc.id === customerId)?.status).toBe("visiting");
  });

  it("accepts and refunds an immediate escort commission", () => {
    const state = createNewGame();
    const before = state.gold;
    const fee = escortFeeForNpc(state, state.npcs.find((npc) => npc.id === "rolf")!);
    const selected = postEscortCommission(state, "rolf");

    expect(selected?.adventurer).toBe(true);
    expect(selected?.status).toBe("contracted");
    expect(state.escortCommission).toMatchObject({ status: "accepted", npcId: selected?.id, offeredFee: fee });
    expect(state.gold).toBe(before - fee);

    cancelEscortCommission(state);
    expect(selected?.status).toBe("inTown");
    expect(state.gold).toBe(before);
    expect(state.escortCommission).toBeUndefined();
  });

  it("prices a specifically selected escort by rank and makes high ranks stronger", () => {
    const state = createNewGame();
    const low = state.npcs.find((npc) => npc.id === "mina")!;
    const high = state.npcs.find((npc) => npc.id === "astrid")!;

    expect(escortFeeForNpc(state, low)).toBeGreaterThanOrEqual(Math.floor(ADVENTURER_RANKS.E.escortFee * 0.88));
    expect(escortFeeForNpc(state, high)).toBeGreaterThanOrEqual(Math.floor(ADVENTURER_RANKS.A.escortFee * 0.88));
    expect(high.maxHp).toBeGreaterThan(low.maxHp!);
    expect(high.damage).toBeGreaterThan(low.damage!);
    expect(postEscortCommission(state, high.id)).toBeUndefined();
    expect(state.message).toContain(`${escortFeeForNpc(state, high)}G`);
  });

  it("starts an expedition with the exact high-rank escort selected by the merchant", () => {
    const state = createNewGame();
    const high = state.npcs.find((npc) => npc.id === "astrid")!;
    const fee = escortFeeForNpc(state, high);
    state.gold = fee + 100;

    const selected = postEscortCommission(state, "astrid");
    beginExpedition(state);

    expect(selected?.rank).toBe("A");
    expect(state.run?.guard).toMatchObject({ guardId: "astrid", maxHp: 44, damage: 12 });
    expect(state.gold).toBe(100);
  });

  it("generates floor-ranked adventurers with varied stats", () => {
    const state = createNewGame();
    const shallow = createGeneratedAdventurer(state, 1);
    const deep = createGeneratedAdventurer(state, 8);

    expect(shallow.rank).toBe("E");
    expect(deep.rank).toBe("A");
    expect(deep.maxHp).toBeGreaterThan(shallow.maxHp!);
    expect(deep.damage).toBeGreaterThan(shallow.damage!);
  });

  it("lets the customer request an interesting shelf item at their price", () => {
    const state = createNewGame();
    const buyer = state.npcs.find((npc) => npc.id === "godwin")!;
    buyer.status = "visiting";
    state.visitorNpcIds = [buyer.id];
    state.shopSession = { day: state.day, status: "serving", queueNpcIds: [], currentNpcId: buyer.id, servedNpcIds: [] };
    const sword = createItem(state, "iron-sword", 1);
    const antidote = createItem(state, "antidote", 1);
    for (const item of [sword, antidote]) item.location = { kind: "shopStock" };
    state.store.push(sword, antidote);
    state.display.push(sword.uuid, antidote.uuid);

    const request = prepareCustomerPurchaseRequest(state, buyer.id);
    expect(request?.itemId).toBe(sword.uuid);
    expect(request?.price).toBeGreaterThan(0);
    expect(request?.price).toBeLessThanOrEqual(buyer.budget);
    expect(prepareCustomerPurchaseRequest(state, buyer.id)).toEqual(request);

    const accepted = acceptCustomerPurchaseRequest(state);

    expect(accepted.accepted).toBe(true);
    expect(sword.location).toEqual({ kind: "npcInventory", npcId: buyer.id });
    expect(buyer.inventoryIds).toContain(sword.uuid);
    expect(state.store).not.toContain(sword);
    expect(state.archive).toContain(sword);
    expect(antidote.location).toEqual({ kind: "shopStock" });
  });

  it("names a singular legendary item on first sale and keeps its history", () => {
    const state = createNewGame();
    const buyer = state.npcs.find((npc) => npc.id === "godwin")!;
    buyer.status = "visiting";
    state.visitorNpcIds = [buyer.id];
    state.shopSession = { day: state.day, status: "serving", queueNpcIds: [], currentNpcId: buyer.id, servedNpcIds: [] };
    const sword = createItem(state, "nameless-black-blade", 7);
    sword.location = { kind: "shopStock" };
    state.store.push(sword);
    state.display.push(sword.uuid);

    expect(() => createItem(state, "nameless-black-blade", 8)).toThrow("一点もの");
    expect(prepareCustomerPurchaseRequest(state, buyer.id)?.itemId).toBe(sword.uuid);
    expect(acceptCustomerPurchaseRequest(state).accepted).toBe(true);
    expect(sword.currentName).toMatch(/の剣$/);
    expect(sword.namedByNpcId).toBe(buyer.id);
    expect(sword.historyV2?.map((event) => event.type)).toEqual(expect.arrayContaining(["created", "sold", "named"]));
  });

  it("creates named dead adventurers without consuming the initial roster", () => {
    const state = createNewGame();
    const dead = createGeneratedDeadAdventurer(state, 3);

    expect(dead.id).toBe("generated-adventurer-1");
    expect(dead.name.length).toBeGreaterThan(0);
    expect(dead.adventurer).toBe(true);
    expect(dead.status).toBe("dead");
    expect(state.npcs).toHaveLength(16);
  });

  it("ends the campaign when the merchant reaches zero HP", () => {
    const state = createNewGame();
    beginExpedition(state);
    const run = state.run!;
    const enemy = run.enemies[0]!;
    run.enemies = [enemy];
    run.player = { x: 5, y: 5 };
    enemy.pos = { x: 6, y: 5 };
    enemy.damage = state.hp;
    enemy.staggerTurns = 0;
    run.map.tiles[5]![5] = run.map.tiles[5]![6] = 0;

    waitTurn(state);

    expect(state.hp).toBe(0);
    expect(state.status).toBe("gameOver");
    expect(state.location).toBe("dungeon");
  });
});

describe("campaign record pruning", () => {
  function expedition(state: ReturnType<typeof createNewGame>, floors = 4): void {
    beginExpedition(state);
    for (let index = 0; index < floors; index += 1) descend(state);
    returnHome(state);
  }

  it("keeps the save bounded across repeated expeditions", () => {
    const state = createNewGame();
    for (let visit = 0; visit < 10; visit += 1) {
      state.day = visit + 1;
      expedition(state);
    }

    // 拾わなかった床の品と、一度も取引しなかった冒険者は残らない。
    // 町の常連15人と、その初期装備だけが残る。
    expect(Object.keys(state.itemsById)).toHaveLength(10);
    expect(state.npcs).toHaveLength(15);
    expect(state.npcs.every((npc) => npc.status !== "departed")).toBe(true);
    expect(JSON.stringify(state).length).toBeLessThan(40_000);
  });

  it("keeps a looted item and the dead adventurer it names", () => {
    const state = createNewGame();
    beginExpedition(state);
    const run = state.run!;
    const dead = createGeneratedDeadAdventurer(state, 1);
    const loot = createItem(state, "blue-gem", 1);
    loot.owner = dead.id;
    loot.historyV2 = [{ day: 1, type: "ownerDied", npcId: dead.id, detail: "test" }];
    dead.inventoryIds.push(loot.uuid);
    run.bodies.push({ id: `body-${dead.id}`, npcId: dead.id, name: dead.name, pos: { ...run.player }, loot: [loot], inspected: true });

    state.inventory.push(loot);
    loot.owner = "player";
    returnHome(state);

    expect(state.itemsById[loot.uuid]).toBeDefined();
    expect(state.npcs.some((npc) => npc.id === dead.id)).toBe(true);
  });

  it("keeps shelved and sold goods", () => {
    const state = createNewGame();
    const shelved = createItem(state, "iron-sword");
    const sold = createItem(state, "old-ring");
    state.store.push(shelved);
    state.display.push(shelved.uuid);
    state.archive.push(sold);
    beginExpedition(state);
    returnHome(state);

    expect(state.itemsById[shelved.uuid]).toBeDefined();
    expect(state.itemsById[sold.uuid]).toBeDefined();
  });
});
