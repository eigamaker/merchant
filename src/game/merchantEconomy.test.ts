import { describe, expect, it } from "vitest";
import { beginExpedition, createItem, createNewGame, waitTurn } from "./engine";
import { ITEM_VISUALS, MERCHANT_ITEM_DEFINITIONS, NPC_APPEARANCES } from "./merchantContent";
import { cancelEscortCommission, createGeneratedDeadAdventurer, offerShopItem, postEscortCommission, refreshDailyVisitors } from "./merchantEconomy";

describe("v5 merchant world", () => {
  it("defines 15 replaceable item visuals and eight stable NPC appearances", () => {
    expect(Object.keys(MERCHANT_ITEM_DEFINITIONS)).toHaveLength(15);
    expect(new Set(Object.values(MERCHANT_ITEM_DEFINITIONS).map((item) => item.category))).toEqual(
      new Set(["weapon", "armor", "medicine", "material", "curio"]),
    );
    expect(Object.values(MERCHANT_ITEM_DEFINITIONS).every((item) => ITEM_VISUALS[item.visualId!]?.endsWith(".png"))).toBe(true);

    const state = createNewGame();
    expect(state.npcs).toHaveLength(8);
    expect(state.visitorNpcIds).toHaveLength(2);
    expect(state.npcs.every((npc) => Boolean(NPC_APPEARANCES[npc.appearanceId]))).toBe(true);
    expect(Object.keys(state.itemsById)).toHaveLength(3);
  });

  it("refreshes exactly two visitors and excludes unavailable NPCs", () => {
    const state = createNewGame();
    const unavailable = state.npcs[0]!;
    unavailable.status = "dead";
    state.day += 1;
    refreshDailyVisitors(state);

    expect(state.visitorNpcIds).toHaveLength(2);
    expect(state.visitorNpcIds).not.toContain(unavailable.id);
    expect(state.npcs.filter((npc) => npc.status === "visiting").map((npc) => npc.id).sort()).toEqual([...state.visitorNpcIds].sort());
  });

  it("accepts and refunds an immediate escort commission", () => {
    const state = createNewGame();
    const before = state.gold;
    const selected = postEscortCommission(state, 180);

    expect(selected?.adventurer).toBe(true);
    expect(selected?.status).toBe("contracted");
    expect(state.escortCommission).toMatchObject({ status: "accepted", npcId: selected?.id, offeredFee: 180 });
    expect(state.gold).toBe(before - 180);

    cancelEscortCommission(state);
    expect(selected?.status).toBe("inTown");
    expect(state.gold).toBe(before);
    expect(state.escortCommission).toBeUndefined();
  });

  it("negotiates directly, remembers refusals, and transfers accepted stock", () => {
    const state = createNewGame();
    const buyer = state.npcs.find((npc) => npc.id === "godwin")!;
    buyer.status = "visiting";
    state.visitorNpcIds = [buyer.id];
    const item = createItem(state, "iron-sword", 1);
    item.location = { kind: "shopStock" };
    state.store.push(item);
    state.display.push(item.uuid);

    expect(offerShopItem(state, item.uuid, buyer.id, 99_999).accepted).toBe(false);
    expect(offerShopItem(state, item.uuid, buyer.id, 1).message).toContain("明日まで");
    state.day += 1;
    const accepted = offerShopItem(state, item.uuid, buyer.id, 100);

    expect(accepted.accepted).toBe(true);
    expect(item.location).toEqual({ kind: "npcInventory", npcId: buyer.id });
    expect(buyer.inventoryIds).toContain(item.uuid);
    expect(state.store).not.toContain(item);
    expect(state.archive).toContain(item);
  });

  it("names a singular legendary item on first sale and keeps its history", () => {
    const state = createNewGame();
    const buyer = state.npcs.find((npc) => npc.id === "godwin")!;
    buyer.status = "visiting";
    state.visitorNpcIds = [buyer.id];
    const sword = createItem(state, "nameless-black-blade", 7);
    sword.location = { kind: "shopStock" };
    state.store.push(sword);

    expect(() => createItem(state, "nameless-black-blade", 8)).toThrow("一点もの");
    expect(offerShopItem(state, sword.uuid, buyer.id, 1).accepted).toBe(true);
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
    expect(state.npcs).toHaveLength(9);
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
