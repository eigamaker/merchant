import { describe, expect, it } from "vitest";
import { beginExpedition, createItem, createNewGame, descend, performDungeonCommand, returnHome } from "./engine";
import { restUntilMorning } from "./merchantSystems";
import {
  ENTRUSTED_NPC_LIMIT,
  RETAINER_SURVIVALS,
  RETAINER_TRUST,
  carriedGearItems,
  entrustGear,
  entrustedNpcCount,
  gearPower,
  gearSlots,
  hasEntrustedGear,
  isRetained,
  npcCombatStats,
  reclaimGear,
  recordGearDeed,
  retainerReady,
  settleLentGear,
  updateRetainer,
  withholdsLentGear,
} from "./npcGear";
import { hasBond, principalBond } from "./npcBonds";
import { escortFeeForNpc } from "./merchantEconomy";
import type { GameState, NpcRecord } from "./types";

/** 町にいる名簿の冒険者（台本の15人ではない側）を選ぶ。 */
function rosterFavourite(state: GameState, index = 0): NpcRecord {
  return state.npcs.filter((npc) => npc.adventurer && npc.id.startsWith("adventurer-") && npc.status === "inTown")[index]!;
}

function giveMerchantItem(state: GameState, definitionId: string, floor?: number) {
  const item = createItem(state, definitionId, floor);
  state.inventory.push(item);
  return item;
}

function sleepOneNight(state: GameState): void {
  state.timeSlot = "evening";
  restUntilMorning(state);
}

/**
 * 返す／返さないは決定論だが確率なので、当たり日を探してからそこで検証する。
 * campaignId はキャンペーンごとに違うため、日を固定打ちすると不安定になる。
 */
function findDay(state: GameState, npc: NpcRecord, withholding: boolean): number {
  for (let day = state.day + 1; day < state.day + 200; day += 1) {
    const probe = { ...state, day };
    if (withholdsLentGear(probe as GameState, npc) === withholding) return day;
  }
  throw new Error("該当する日が見つからなかった");
}

describe("entrusting gear", () => {
  it("moves the item out of the merchant's hands and into the slot", () => {
    const state = createNewGame();
    const favourite = rosterFavourite(state);
    const sword = giveMerchantItem(state, "iron-sword");

    const result = entrustGear(state, favourite, sword.uuid, "given");

    expect(result.ok).toBe(true);
    expect(state.inventory).not.toContain(sword);
    expect(favourite.gear?.weapon).toMatchObject({ itemId: sword.uuid, term: "given", since: state.day });
    // 参照であって別の置き場ではない —— 品は inventoryIds の中にいる。
    expect(favourite.inventoryIds).toContain(sword.uuid);
    expect(sword.location).toEqual({ kind: "npcInventory", npcId: favourite.id });
    expect(carriedGearItems(state, favourite).map((item) => item.uuid)).toEqual([sword.uuid]);
    expect(principalBond(favourite)?.kind).toBe("entrusted");
  });

  it("refuses anything that is not a weapon or armour", () => {
    const state = createNewGame();
    const favourite = rosterFavourite(state);
    const potion = giveMerchantItem(state, "minor-healing-potion");
    expect(entrustGear(state, favourite, potion.uuid, "lent").ok).toBe(false);
    expect(hasEntrustedGear(favourite)).toBe(false);
  });

  it("keeps one weapon and one armour per person", () => {
    const state = createNewGame();
    const favourite = rosterFavourite(state);
    expect(entrustGear(state, favourite, giveMerchantItem(state, "iron-sword").uuid, "given").ok).toBe(true);
    expect(entrustGear(state, favourite, giveMerchantItem(state, "bronze-spear").uuid, "given").ok).toBe(false);
    expect(entrustGear(state, favourite, giveMerchantItem(state, "leather-armor").uuid, "given").ok).toBe(true);
    expect(carriedGearItems(state, favourite)).toHaveLength(2);
  });

  it("forces the merchant to pick favourites", () => {
    const state = createNewGame();
    for (let index = 0; index < ENTRUSTED_NPC_LIMIT; index += 1) {
      const npc = rosterFavourite(state, index);
      expect(entrustGear(state, npc, giveMerchantItem(state, "iron-sword").uuid, "given").ok).toBe(true);
    }
    const oneTooMany = rosterFavourite(state, ENTRUSTED_NPC_LIMIT);
    expect(entrustGear(state, oneTooMany, giveMerchantItem(state, "iron-sword").uuid, "given").ok).toBe(false);
    expect(entrustedNpcCount(state)).toBe(ENTRUSTED_NPC_LIMIT);
  });

  it("adds the gear's numbers without touching an unequipped roster member", () => {
    const state = createNewGame();
    const bare = rosterFavourite(state, 0);
    const armed = rosterFavourite(state, 1);
    const before = npcCombatStats(state, bare);
    expect(before).toEqual({ maxHp: bare.maxHp, damage: bare.damage, defense: 0 });
    expect(gearPower(state, bare)).toBe(0);

    entrustGear(state, armed, giveMerchantItem(state, "bronze-spear").uuid, "given");   // attack 3
    entrustGear(state, armed, giveMerchantItem(state, "round-shield").uuid, "given");   // defense 3

    expect(npcCombatStats(state, armed)).toEqual({
      maxHp: armed.maxHp! + 9,
      damage: armed.damage! + 3,
      defense: 3,
    });
    expect(gearPower(state, armed)).toBe(9);
  });
});

describe("entrusted gear outlives the expedition", () => {
  it("survives pruning for a generated roster member across repeated returns", () => {
    const state = createNewGame();
    const favourite = rosterFavourite(state);
    // 迷宮由来の品。以前の剪定規則ではこれが真っ先に消えていた。
    const blade = giveMerchantItem(state, "round-shield", 6);
    expect(entrustGear(state, favourite, blade.uuid, "given").ok).toBe(true);

    for (let visit = 0; visit < 3; visit += 1) {
      state.timeSlot = "morning";
      state.lastExpeditionDay = 0;
      expect(beginExpedition(state)).toBe(true);
      descend(state);
      returnHome(state);
      state.inventory = [];
    }

    const kept = state.npcs.find((npc) => npc.id === favourite.id)!;
    expect(state.itemsById[blade.uuid]).toBeDefined();
    expect(kept.gear?.armor?.itemId).toBe(blade.uuid);
    expect(kept.inventoryIds).toContain(blade.uuid);
  });
});

describe("lending and reclaiming", () => {
  it("will not pull gear out of the dungeon", () => {
    const state = createNewGame();
    const favourite = rosterFavourite(state);
    const lent = giveMerchantItem(state, "iron-sword");
    entrustGear(state, favourite, lent.uuid, "lent");
    favourite.status = "delving";
    expect(reclaimGear(state, favourite, "weapon").ok).toBe(false);
    favourite.status = "inTown";
    expect(reclaimGear(state, favourite, "weapon").ok).toBe(true);
    expect(state.store.some((item) => item.uuid === lent.uuid)).toBe(true);
    expect(favourite.inventoryIds).not.toContain(lent.uuid);
    expect(hasEntrustedGear(favourite)).toBe(false);
  });

  it("settles a loan the day after it was made, and never a gift", () => {
    const state = createNewGame();
    const borrower = rosterFavourite(state, 0);
    const keeper = rosterFavourite(state, 1);
    const lent = giveMerchantItem(state, "iron-sword");
    const given = giveMerchantItem(state, "leather-armor");
    entrustGear(state, borrower, lent.uuid, "lent");
    entrustGear(state, keeper, given.uuid, "given");

    // 預けた当日は精算しない。
    settleLentGear(state, borrower);
    expect(borrower.gear?.weapon).toBeDefined();

    // 返す相手にしておき、実際に返す日を選ぶ。
    Object.assign(borrower.guardProfile!.personality, { integrity: 100, greed: 0 });
    borrower.guardProfile!.trust = 100;
    state.day = findDay(state, borrower, false);
    settleLentGear(state, borrower);
    settleLentGear(state, keeper);

    expect(hasEntrustedGear(borrower)).toBe(false);
    expect(state.store.some((item) => item.uuid === lent.uuid)).toBe(true);
    // 譲った品は精算の対象にならない。
    expect(keeper.gear?.armor?.itemId).toBe(given.uuid);
  });

  it("lets a greedy borrower keep it, and remembers that they did", () => {
    const state = createNewGame();
    const borrower = rosterFavourite(state);
    const lent = giveMerchantItem(state, "iron-sword");
    entrustGear(state, borrower, lent.uuid, "lent");
    Object.assign(borrower.guardProfile!.personality, { integrity: 0, greed: 100 });
    borrower.guardProfile!.trust = 0;
    const relationBefore = borrower.relation;

    state.day = findDay(state, borrower, true);
    settleLentGear(state, borrower);

    expect(borrower.gear?.weapon?.withheld).toBe(true);
    expect(borrower.relation).toBe(relationBefore - 8);
    expect(state.events.some((event) => event.id.startsWith("withheld-"))).toBe(true);
    // 二度は取り立てない。
    state.day = findDay(state, borrower, true);
    settleLentGear(state, borrower);
    expect(state.events.filter((event) => event.id.startsWith("withheld-"))).toHaveLength(1);
  });

  it("returns a loan on a day the borrower means to return it", () => {
    const state = createNewGame();
    const borrower = rosterFavourite(state);
    Object.assign(borrower.guardProfile!.personality, { integrity: 100, greed: 0 });
    borrower.guardProfile!.trust = 100;
    const lent = giveMerchantItem(state, "iron-sword");
    entrustGear(state, borrower, lent.uuid, "lent");

    state.day = findDay(state, borrower, false);
    settleLentGear(state, borrower);

    expect(hasEntrustedGear(borrower)).toBe(false);
    expect(state.store.some((item) => item.uuid === lent.uuid)).toBe(true);
    // 貸した事実は縁として残る。
    expect(hasBond(borrower)).toBe(true);
  });

  it("settles loans through the ordinary passage of days", () => {
    const state = createNewGame();
    const borrower = rosterFavourite(state);
    Object.assign(borrower.guardProfile!.personality, { integrity: 100, greed: 0 });
    borrower.guardProfile!.trust = 100;
    entrustGear(state, borrower, giveMerchantItem(state, "iron-sword").uuid, "lent");

    // 返すか、返さないと決めるか。どちらでも「宙ぶらりんのまま」にはならない。
    for (let night = 0; night < 8 && hasEntrustedGear(borrower) && !borrower.gear?.weapon?.withheld; night += 1) {
      sleepOneNight(state);
    }
    expect(!hasEntrustedGear(borrower) || borrower.gear?.weapon?.withheld).toBeTruthy();
  });
});

describe("the whole chain", () => {
  it("carries a blade to fame, loses it with its owner, and gives it back inscribed", () => {
    const state = createNewGame();
    const hero = rosterFavourite(state);
    const blade = giveMerchantItem(state, "nameless-black-blade", 8);
    expect(entrustGear(state, hero, blade.uuid, "given").ok).toBe(true);

    // 深くまで担がれ、銘が育つ。
    recordGearDeed(state, hero, { floor: 8 });
    const earnedName = blade.currentName;
    expect(earnedName).toBeDefined();
    expect(blade.deeds!.deepestFloor).toBe(8);

    // 商人の見ていないところで死ぬ。
    Object.assign(hero.guardProfile!.personality, { courage: 0, discipline: 0 });
    let deathNotice = "";
    // sleepOneNight の中で状態が変わるので、毎回名簿から読み直す。
    const statusOf = (): string => state.npcs.find((npc) => npc.id === hero.id)!.status;
    for (let night = 0; night < 60 && statusOf() !== "dead"; night += 1) {
      hero.status = "delving";
      hero.delve = { floor: 2, departedDay: state.day };
      hero.conditionHp = 1;
      sleepOneNight(state);
      if (statusOf() === "dead") deathNotice = state.message;
    }
    expect(statusOf()).toBe("dead");

    // 預けた品は、確かにその階に残っている。
    const corpse = state.dungeonCorpses.find((entry) => entry.npcId === hero.id)!;
    expect(corpse.lootIds).toContain(blade.uuid);
    expect(corpse.floor).toBe(2);
    // 物語を負った品を抱えた遺体は、迷宮にすぐ呑まれない。
    expect(corpse.keepsake).toBe(true);
    expect(hero.gear).toBeUndefined();
    // 訃報は寝て起きた朝に届く。品の在り処まで書かれている。
    expect(deathNotice).toContain(hero.name);
    expect(deathNotice).toContain("まだあの深さにある");

    // 取りに行く。
    state.timeSlot = "morning";
    state.lastExpeditionDay = 0;
    expect(beginExpedition(state)).toBe(true);
    descend(state);
    expect(state.run!.floor).toBe(2);
    const body = state.run!.bodies.find((entry) => entry.npcId === hero.id)!;
    expect(body.loot.some((item) => item.uuid === blade.uuid)).toBe(true);

    state.run!.player = { ...body.pos };
    performDungeonCommand(state, { type: "inspectBody", bodyId: body.id });
    expect(state.message).toContain("あなたが預けた");
    performDungeonCommand(state, { type: "lootBody", bodyId: body.id, itemId: blade.uuid });

    // 戻ってきた剣は、あの人を喪った名前になっている。
    expect(state.inventory.some((item) => item.uuid === blade.uuid)).toBe(true);
    expect(blade.deeds!.ownersLost).toBe(1);
    expect(blade.currentName).not.toBe(earnedName);
    const named = (blade.historyV2 ?? []).filter((event) => event.type === "named");
    expect(named.length).toBeGreaterThanOrEqual(2);
  });
});

describe("keeping someone on retainer", () => {
  function readyRetainer(state: GameState): NpcRecord {
    const npc = rosterFavourite(state);
    entrustGear(state, npc, giveMerchantItem(state, "iron-sword").uuid, "given");
    const profile = npc.guardProfile!;
    profile.trust = RETAINER_TRUST;
    profile.career.successfulReturns = RETAINER_SURVIVALS;
    return npc;
  }

  it("asks for a gift, deep trust and a record of coming home", () => {
    const state = createNewGame();
    const npc = rosterFavourite(state);
    // 貸しただけでは足りない。
    entrustGear(state, npc, giveMerchantItem(state, "iron-sword").uuid, "lent");
    npc.guardProfile!.trust = 100;
    npc.guardProfile!.career.successfulReturns = 20;
    expect(retainerReady(state, npc)).toBe(false);

    const given = readyRetainer(createNewGame());
    expect(given.retainedSince).toBeUndefined();
  });

  it("will not keep someone who kept the merchant's sword", () => {
    const state = createNewGame();
    const npc = readyRetainer(state);
    npc.gear!.weapon!.withheld = true;
    expect(retainerReady(state, npc)).toBe(false);
  });

  it("costs far less and stays in town once retained", () => {
    const state = createNewGame();
    const npc = readyRetainer(state);
    const feeBefore = escortFeeForNpc(state, npc);

    updateRetainer(state, npc);

    expect(isRetained(npc)).toBe(true);
    expect(npc.retainedSince).toBe(state.day);
    expect(escortFeeForNpc(state, npc)).toBeLessThan(feeBefore);
    expect(state.events.some((event) => event.id === `retained-${npc.id}`)).toBe(true);

    // お抱えは自分の依頼で潜らない。呼べばいつでも町にいる。
    for (let night = 0; night < 15; night += 1) {
      sleepOneNight(state);
      expect(state.npcs.find((entry) => entry.id === npc.id)!.status).not.toBe("delving");
    }
  });
});

describe("the save stays bounded with favourites", () => {
  it("holds under sixty kilobytes after sixty nights with five armed adventurers", () => {
    const state = createNewGame();
    for (let index = 0; index < ENTRUSTED_NPC_LIMIT; index += 1) {
      const npc = rosterFavourite(state, index);
      entrustGear(state, npc, giveMerchantItem(state, "bronze-spear", 6).uuid, "given");
      entrustGear(state, npc, giveMerchantItem(state, "round-shield", 6).uuid, "given");
    }

    for (let night = 0; night < 60; night += 1) sleepOneNight(state);

    expect(JSON.stringify(state).length).toBeLessThan(60_000);
    // 預けた品は、持ち主が死んでも遺体台帳が引き取るので宙に浮かない。
    for (const npc of state.npcs) {
      for (const slot of gearSlots(npc)) expect(state.itemsById[slot.itemId]).toBeDefined();
    }
  });
});

describe("the moment of recovery", () => {
  it("does not let the turn's combat log bury the story beat", () => {
    const state = createNewGame();
    const hero = rosterFavourite(state);
    const blade = giveMerchantItem(state, "nameless-black-blade", 8);
    entrustGear(state, hero, blade.uuid, "given");
    recordGearDeed(state, hero, { floor: 8 });

    Object.assign(hero.guardProfile!.personality, { courage: 0, discipline: 0 });
    const statusOf = (): string => state.npcs.find((npc) => npc.id === hero.id)!.status;
    for (let night = 0; night < 60 && statusOf() !== "dead"; night += 1) {
      hero.status = "delving";
      hero.delve = { floor: 2, departedDay: state.day };
      hero.conditionHp = 1;
      sleepOneNight(state);
    }

    state.timeSlot = "morning";
    state.lastExpeditionDay = 0;
    beginExpedition(state);
    descend(state);
    const body = state.run!.bodies.find((entry) => entry.npcId === hero.id)!;
    state.run!.player = { ...body.pos };
    performDungeonCommand(state, { type: "lootBody", bodyId: body.id, itemId: blade.uuid });

    // 敵や同行者の行動がこのターンに起きても、取り戻した一行は残る。
    expect(state.message).toContain("取り戻した");
    expect(state.message).toContain(blade.currentName!);
  });
});
