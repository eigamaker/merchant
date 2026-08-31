import { describe, expect, it } from "vitest";
import { beginExpedition, createItem, createNewGame, descend, returnHome, waitTurn } from "./engine";
import { ADVENTURER_RANKS, ITEM_VISUALS, MERCHANT_ITEM_DEFINITIONS, NPC_APPEARANCES, npcAppearanceSprite } from "./merchantContent";
import { npcActorIds } from "./actorCatalog";
import { acceptCustomerPurchaseRequest, cancelEscortCommission, escortFeeForNpc, postEscortCommission, prepareCustomerPurchaseRequest } from "./merchantEconomy";
import { bagCapacity, depositGold, startShopSession, summonNextCustomer } from "./merchantSystems";
import { ADVENTURER_ROSTER_TARGET, ROSTER_RANK_SHAPE, createRosterAdventurer } from "./npcRoster";

describe("v6 merchant world", () => {
  it("defines 19 replaceable item visuals and a ranked NPC roster", () => {
    expect(Object.keys(MERCHANT_ITEM_DEFINITIONS)).toHaveLength(19);
    expect(new Set(Object.values(MERCHANT_ITEM_DEFINITIONS).map((item) => item.category))).toEqual(
      new Set(["weapon", "armor", "bag", "medicine", "material", "curio"]),
    );
    expect(Object.values(MERCHANT_ITEM_DEFINITIONS).every((item) => ITEM_VISUALS[item.visualId!]?.endsWith(".png"))).toBe(true);

    const state = createNewGame();
    const adventurers = state.npcs.filter((npc) => npc.adventurer);
    // 台本のある15人に、生成された名簿が足されて目標人数になる。
    expect(adventurers).toHaveLength(ADVENTURER_ROSTER_TARGET);
    expect(state.npcs).toHaveLength(ADVENTURER_ROSTER_TARGET + 5);
    for (const rank of ["E", "D", "C", "B", "A"] as const) {
      expect(adventurers.filter((npc) => npc.rank === rank).length).toBe(ROSTER_RANK_SHAPE[rank]);
    }
    expect(state.visitorNpcIds).toHaveLength(0);
    // Everyone resolves to a sprite. Authored people name an appearance id from
    // the table; generated adventurers name one of the actor sheets marked as
    // adventurers, so nobody in the dungeon is wearing an unchosen face.
    expect(state.npcs.every((npc) => Boolean(npcAppearanceSprite(npc.appearanceId)))).toBe(true);
    const adventurerSheets = new Set(npcActorIds("adventurer"));
    expect(adventurerSheets.size).toBeGreaterThan(0);
    const generated = state.npcs.filter((npc) => npc.id.startsWith("adventurer-"));
    expect(generated.length).toBeGreaterThan(0);
    expect(generated.every((npc) => adventurerSheets.has(npc.appearanceId))).toBe(true);
    // The fifteen written by hand keep the appearance their entry names.
    expect(state.npcs.filter((npc) => !npc.id.startsWith("adventurer-")).every((npc) => Boolean(NPC_APPEARANCES[npc.appearanceId]))).toBe(true);
    // 初期装備は台本のある10人だけ。名簿を増やしてもアイテムは増えない。
    // 加えて商人が背負っている風呂敷が1つ。
    expect(Object.keys(state.itemsById)).toHaveLength(11);
    // 名前に通し番号が混じらない。
    expect(state.npcs.every((npc) => !/\d/.test(npc.name))).toBe(true);
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
    const shallow = createRosterAdventurer(state, { rank: "E" });
    const deep = createRosterAdventurer(state, { rank: "A" });

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
    // 相場1800Gはゴドウィンの所持金を超える。買える値を付けなければ、彼はよそをあたる。
    sword.askingPrice = 1200;
    state.store.push(sword);
    state.display.push(sword.uuid);

    expect(() => createItem(state, "nameless-black-blade", 8)).toThrow("一点もの");
    const request = prepareCustomerPurchaseRequest(state, buyer.id);
    expect(request?.itemId).toBe(sword.uuid);
    expect(request?.reaction).toBe("buy");
    expect(acceptCustomerPurchaseRequest(state).accepted).toBe(true);
    expect(sword.currentName).toMatch(/の剣$/);
    expect(sword.namedByNpcId).toBe(buyer.id);
    expect(sword.historyV2?.map((event) => event.type)).toEqual(expect.arrayContaining(["created", "sold", "named"]));
  });

  it("creates named dead adventurers without consuming the initial roster", () => {
    const state = createNewGame();
    const dead = createRosterAdventurer(state, { rank: "C", status: "dead" });

    const before = state.npcs.length;
    expect(dead.id.startsWith("adventurer-")).toBe(true);
    expect(dead.name.length).toBeGreaterThan(0);
    expect(dead.adventurer).toBe(true);
    expect(dead.status).toBe("dead");
    expect(state.npcs.some((npc) => npc.id === dead.id)).toBe(true);
    expect(before).toBeGreaterThan(0);
  });

  it("returns home after defeat, losing carried wealth but preserving the vault and home stock", () => {
    const state = createNewGame();
    const carried = createItem(state, "iron-sword");
    const stored = createItem(state, "old-ring");
    state.inventory.push(carried);
    state.store.push(stored);
    stored.location = { kind: "homeStorage" };
    const bagBefore = state.equipment.bagItemId;
    expect(depositGold(state, 175)).toBe(true);
    beginExpedition(state);
    const run = state.run!;
    const enemy = run.enemies[0]!;
    run.enemies = [enemy];
    run.adventurers = [];
    run.player = { x: 5, y: 5 };
    enemy.pos = { x: 6, y: 5 };
    enemy.damage = state.hp;
    enemy.staggerTurns = 0;
    run.map.tiles[5]![5] = run.map.tiles[5]![6] = 0;

    waitTurn(state);

    expect(state.hp).toBe(state.maxHp);
    expect(state.status).toBe("active");
    expect(state.location).toBe("home");
    expect(state.run).toBeUndefined();
    expect(state.gold).toBe(0);
    expect(state.vaultGold).toBe(175);
    expect(state.inventory).toEqual([]);
    // 道具袋は身から離れない。中身は失っても、明日また商いはできる。
    expect(state.equipment.bagItemId).toBe(bagBefore);
    expect(bagCapacity(state)).toBe(12);
    expect(state.store.map((item) => item.uuid)).toContain(stored.uuid);
    expect(state.provisions).toBe(0);
    expect(state.smokeBombs).toBe(0);
    expect(state.returnStones).toBe(0);
    expect(state.message).toContain("金庫の預金と自宅の在庫は無事");
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

    // 拾わなかった床の品と、迷宮へ担いでいった在庫は残らない。名簿はそのまま生き続ける。
    // 残るのは台本の10人の初期装備と、商人の風呂敷。
    expect(Object.keys(state.itemsById)).toHaveLength(11);
    expect(state.npcs.filter((npc) => npc.adventurer).length).toBeGreaterThanOrEqual(28);
    expect(state.npcs.filter((npc) => npc.adventurer).length).toBeLessThanOrEqual(40);
    expect(state.npcs.every((npc) => !npc.id.startsWith("generated-"))).toBe(true);
    expect(JSON.stringify(state).length).toBeLessThan(60_000);
  });

  it("keeps a looted item and the dead adventurer it names", () => {
    const state = createNewGame();
    beginExpedition(state);
    const run = state.run!;
    const dead = createRosterAdventurer(state, { rank: "E", status: "dead" });
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
