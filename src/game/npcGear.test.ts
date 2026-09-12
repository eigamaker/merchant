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
  markMerchantGoods,
  merchantMedicine,
  npcCombatStats,
  reclaimGear,
  recordGearDeed,
  refusesToReturnGear,
  retainerReady,
  updateRetainer,
} from "./npcGear";
import { hasBond, principalBond } from "./npcBonds";
import { MERCHANT_TRACE_LIMIT, escortFeeForNpc, pruneCampaignRecords } from "./merchantEconomy";
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
function findDay(state: GameState, npc: NpcRecord, refusing: boolean, slot: "weapon" | "armor" = "weapon"): number {
  for (let day = state.day + 1; day < state.day + 200; day += 1) {
    const probe = { ...state, day };
    if (refusesToReturnGear(probe as GameState, npc, slot) === refusing) return day;
  }
  throw new Error("該当する日が見つからなかった");
}

describe("entrusting gear", () => {
  it("moves the item out of the merchant's hands and into the slot", () => {
    const state = createNewGame();
    const favourite = rosterFavourite(state);
    const sword = giveMerchantItem(state, "iron-sword");

    const result = entrustGear(state, favourite, sword.uuid);

    expect(result.ok).toBe(true);
    expect(state.inventory).not.toContain(sword);
    expect(favourite.gear?.weapon).toMatchObject({ itemId: sword.uuid, since: state.day });
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
    expect(entrustGear(state, favourite, potion.uuid).ok).toBe(false);
    expect(hasEntrustedGear(state, favourite)).toBe(false);
  });

  it("keeps one weapon and one armour per person", () => {
    const state = createNewGame();
    const favourite = rosterFavourite(state);
    expect(entrustGear(state, favourite, giveMerchantItem(state, "iron-sword").uuid).ok).toBe(true);
    expect(entrustGear(state, favourite, giveMerchantItem(state, "bronze-spear").uuid).ok).toBe(false);
    expect(entrustGear(state, favourite, giveMerchantItem(state, "leather-armor").uuid).ok).toBe(true);
    expect(carriedGearItems(state, favourite)).toHaveLength(2);
  });

  it("forces the merchant to pick favourites", () => {
    const state = createNewGame();
    for (let index = 0; index < ENTRUSTED_NPC_LIMIT; index += 1) {
      const npc = rosterFavourite(state, index);
      expect(entrustGear(state, npc, giveMerchantItem(state, "iron-sword").uuid).ok).toBe(true);
    }
    const oneTooMany = rosterFavourite(state, ENTRUSTED_NPC_LIMIT);
    expect(entrustGear(state, oneTooMany, giveMerchantItem(state, "iron-sword").uuid).ok).toBe(false);
    expect(entrustedNpcCount(state)).toBe(ENTRUSTED_NPC_LIMIT);
  });

  it("adds the gear's numbers without touching an unequipped roster member", () => {
    const state = createNewGame();
    const bare = rosterFavourite(state, 0);
    const armed = rosterFavourite(state, 1);
    const before = npcCombatStats(state, bare);
    expect(before).toEqual({ maxHp: bare.maxHp, damage: bare.damage, defense: 0 });
    expect(gearPower(state, bare)).toBe(0);

    entrustGear(state, armed, giveMerchantItem(state, "bronze-spear").uuid);   // attack 3
    entrustGear(state, armed, giveMerchantItem(state, "round-shield").uuid);   // defense 3

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
    expect(entrustGear(state, favourite, blade.uuid).ok).toBe(true);

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

describe("asking for it back", () => {
  it("will not pull gear out of the dungeon", () => {
    const state = createNewGame();
    const favourite = rosterFavourite(state);
    const entrusted = giveMerchantItem(state, "iron-sword");
    entrustGear(state, favourite, entrusted.uuid);
    // 返す気のある相手に固定する。ここで見たいのは場所の条件だけである。
    Object.assign(favourite.guardProfile!.personality, { integrity: 100, greed: 0 });
    favourite.guardProfile!.trust = 100;
    state.day = findDay(state, favourite, false);

    favourite.status = "delving";
    expect(reclaimGear(state, favourite, "weapon").ok).toBe(false);
    favourite.status = "inTown";
    expect(reclaimGear(state, favourite, "weapon").ok).toBe(true);
    expect(state.store.some((item) => item.uuid === entrusted.uuid)).toBe(true);
    expect(favourite.inventoryIds).not.toContain(entrusted.uuid);
    expect(hasEntrustedGear(state, favourite)).toBe(false);
  });

  it("hands it back when the merchant asks", () => {
    const state = createNewGame();
    const holder = rosterFavourite(state);
    Object.assign(holder.guardProfile!.personality, { integrity: 100, greed: 0 });
    holder.guardProfile!.trust = 100;
    const entrusted = giveMerchantItem(state, "iron-sword");
    entrustGear(state, holder, entrusted.uuid);

    state.day = findDay(state, holder, false);
    expect(reclaimGear(state, holder, "weapon").ok).toBe(true);

    expect(hasEntrustedGear(state, holder)).toBe(false);
    expect(state.store.some((item) => item.uuid === entrusted.uuid)).toBe(true);
    // 託した事実は縁として残る。
    expect(hasBond(holder)).toBe(true);
  });

  it("refuses to give it back, and remembers being asked", () => {
    const state = createNewGame();
    const holder = rosterFavourite(state);
    const entrusted = giveMerchantItem(state, "iron-sword");
    entrustGear(state, holder, entrusted.uuid);
    Object.assign(holder.guardProfile!.personality, { integrity: 0, greed: 100 });
    holder.guardProfile!.trust = 0;
    const relationBefore = holder.relation;

    state.day = findDay(state, holder, true);
    expect(reclaimGear(state, holder, "weapon").ok).toBe(false);

    expect(holder.gear?.weapon?.withheld).toBe(true);
    expect(holder.inventoryIds).toContain(entrusted.uuid);
    expect(holder.relation).toBe(relationBefore - 8);
    expect(state.events.some((event) => event.id.startsWith("withheld-"))).toBe(true);
    // 二度は頼めない。同じ返事を何度も取り立てない。
    state.day = findDay(state, holder, false);
    expect(reclaimGear(state, holder, "weapon").ok).toBe(false);
    expect(state.events.filter((event) => event.id.startsWith("withheld-"))).toHaveLength(1);
  });

  it("answers for one slot at a time", () => {
    const state = createNewGame();
    const holder = rosterFavourite(state);
    entrustGear(state, holder, giveMerchantItem(state, "iron-sword").uuid);
    entrustGear(state, holder, giveMerchantItem(state, "leather-armor").uuid);
    Object.assign(holder.guardProfile!.personality, { integrity: 0, greed: 100 });
    holder.guardProfile!.trust = 0;

    // 剣を断られた日でも、盾の返事は別に引く。
    state.day = findDay(state, holder, true, "weapon");
    expect(reclaimGear(state, holder, "weapon").ok).toBe(false);
    expect(holder.gear?.weapon?.withheld).toBe(true);
    expect(holder.gear?.armor?.withheld).toBeUndefined();
  });

  it("stays with its holder night after night until the merchant asks", () => {
    const state = createNewGame();
    const holder = rosterFavourite(state);
    Object.assign(holder.guardProfile!.personality, { integrity: 0, greed: 100 });
    holder.guardProfile!.trust = 0;
    const entrusted = giveMerchantItem(state, "iron-sword");
    entrustGear(state, holder, entrusted.uuid);

    // 自動では戻らない。日が過ぎるだけで手元へ帰ってくることはもう無い。
    // 毎晩、町にいる状態へ戻してから寝る —— 旧規則が精算していたのはまさにこの状態で、
    // 自分で潜って死ぬかどうかはここで見たい話ではない。
    for (let night = 0; night < 8; night += 1) {
      holder.status = "inTown";
      delete holder.delve;
      sleepOneNight(state);
    }

    expect(hasEntrustedGear(state, holder)).toBe(true);
    expect(holder.gear?.weapon?.withheld).toBeUndefined();
    expect(state.store.some((item) => item.uuid === entrusted.uuid)).toBe(false);
  });
});

describe("the whole chain", () => {
  it("carries a blade to fame, loses it with its owner, and gives it back inscribed", () => {
    const state = createNewGame();
    const hero = rosterFavourite(state);
    const blade = giveMerchantItem(state, "nameless-black-blade", 8);
    expect(entrustGear(state, hero, blade.uuid).ok).toBe(true);

    // 深くまで担がれ、銘が育つ。
    recordGearDeed(state, hero, { floor: 8 });
    const earnedName = blade.currentName;
    expect(earnedName).toBeDefined();
    expect(blade.deeds!.deepestFloor).toBe(8);

    // 商人の見ていないところで死ぬ。
    Object.assign(hero.guardProfile!.personality, { courage: 0, discipline: 0 });
    // sleepOneNight の中で状態が変わるので、毎回名簿から読み直す。
    const statusOf = (): string => state.npcs.find((npc) => npc.id === hero.id)!.status;
    for (let night = 0; night < 60 && statusOf() !== "dead"; night += 1) {
      hero.status = "delving";
      hero.delve = { floor: 2, departedDay: state.day };
      hero.conditionHp = 1;
      sleepOneNight(state);
    }
    expect(statusOf()).toBe("dead");
    // 同じ朝に何件も届くと一行の要約に畳まれるので、訃報そのものは日誌から読む。
    const deathNotice = state.knowledge.received.find((entry) => entry.id === `death-${hero.id}`)?.text ?? "";

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
    entrustGear(state, npc, giveMerchantItem(state, "iron-sword").uuid);
    const profile = npc.guardProfile!;
    profile.trust = RETAINER_TRUST;
    profile.career.successfulReturns = RETAINER_SURVIVALS;
    return npc;
  }

  it("asks for gear still in their hands, deep trust and a record of coming home", () => {
    const state = createNewGame();
    const npc = rosterFavourite(state);
    Object.assign(npc.guardProfile!.personality, { integrity: 100, greed: 0 });
    entrustGear(state, npc, giveMerchantItem(state, "iron-sword").uuid);
    npc.guardProfile!.trust = 100;
    npc.guardProfile!.career.successfulReturns = 20;
    expect(retainerReady(state, npc)).toBe(true);

    // 返せと言ってしまえば、その関係は積み上がらない。
    state.day = findDay(state, npc, false);
    expect(reclaimGear(state, npc, "weapon").ok).toBe(true);
    expect(retainerReady(state, npc)).toBe(false);

    const held = readyRetainer(createNewGame());
    expect(held.retainedSince).toBeUndefined();
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
      entrustGear(state, npc, giveMerchantItem(state, "bronze-spear", 6).uuid);
      entrustGear(state, npc, giveMerchantItem(state, "round-shield", 6).uuid);
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
    entrustGear(state, hero, blade.uuid);
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

describe("goods the merchant handed over", () => {
  /** 台本の冒険者と、その人が最初から鞄に持っている得物。 */
  function scripted(state: GameState): { npc: NpcRecord; sword: NonNullable<ReturnType<typeof createItem>> } {
    const npc = state.npcs.find((entry) => entry.profession === "swordsman" && entry.adventurer)!;
    const sword = npc.inventoryIds.map((id) => state.itemsById[id]!).find((item) => item.definitionId === "iron-sword")!;
    return { npc, sword };
  }

  it("arms a sold sword, and leaves a scripted adventurer's own kit alone", () => {
    const state = createNewGame();
    const { npc, sword } = scripted(state);
    // 最初から持っている剣は鞄の中の私物。能力値には一切乗らない。
    expect(npc.gear).toBeUndefined();
    expect(gearPower(state, npc)).toBe(0);

    markMerchantGoods(state, npc, sword, "sold");

    // 同じ剣でも、商人から買ったものなら担いで潜る。
    expect(npc.gear?.weapon?.itemId).toBe(sword.uuid);
    expect(gearPower(state, npc)).toBe(2);
    expect(npcCombatStats(state, npc).damage).toBe((npc.damage ?? 1) + 2);
    // それでも「託した」相手ではない。囲いの話にはならない。
    expect(hasEntrustedGear(state, npc)).toBe(false);
  });

  it("does not arm someone who bought a sword to resell", () => {
    const state = createNewGame();
    const dealer = state.npcs.find((npc) => npc.profession === "merchant")!;
    const sword = createItem(state, "iron-sword");
    dealer.inventoryIds.push(sword.uuid);

    markMerchantGoods(state, dealer, sword, "sold");

    expect(sword.merchantOrigin).toBe("sold");
    expect(dealer.gear).toBeUndefined();
  });

  it("does not let a sale take a slot the merchant already filled", () => {
    const state = createNewGame();
    const favourite = rosterFavourite(state);
    const spear = giveMerchantItem(state, "bronze-spear");
    entrustGear(state, favourite, spear.uuid);

    const bought = createItem(state, "iron-sword");
    favourite.inventoryIds.push(bought.uuid);
    markMerchantGoods(state, favourite, bought, "sold");

    // 託した槍のまま。買った剣は鞄で眠る。
    expect(favourite.gear?.weapon?.itemId).toBe(spear.uuid);
    expect(gearPower(state, favourite)).toBe(3);
  });

  it("will not take back something that was paid for", () => {
    const state = createNewGame();
    const favourite = rosterFavourite(state);
    const sword = createItem(state, "iron-sword");
    favourite.inventoryIds.push(sword.uuid);
    markMerchantGoods(state, favourite, sword, "sold");
    const relationBefore = favourite.relation;

    const result = reclaimGear(state, favourite, "weapon");

    expect(result.ok).toBe(false);
    expect(favourite.gear?.weapon?.itemId).toBe(sword.uuid);
    // 頼むほうが筋違いなので、断られた記録にもならない。
    expect(favourite.gear?.weapon?.withheld).toBeUndefined();
    expect(favourite.relation).toBe(relationBefore);
  });

  it("remembers one flask per person, and the one that would be drunk first", () => {
    const state = createNewGame();
    const favourite = rosterFavourite(state);
    const drained = createItem(state, "field-flask");
    drained.chargesLeft = 1;
    const full = createItem(state, "field-flask");
    for (const item of [drained, full]) {
      favourite.inventoryIds.push(item.uuid);
      markMerchantGoods(state, favourite, item, "sold");
    }

    // 残量の多い一本を選ぶ。剪定が覚えておくのも同じ一本である。
    expect(merchantMedicine(state, favourite)?.uuid).toBe(full.uuid);
    full.chargesLeft = 0;
    expect(merchantMedicine(state, favourite)?.uuid).toBe(drained.uuid);
  });

  it("holds under sixty kilobytes after sixty nights of selling gear", () => {
    const state = createNewGame();
    for (let night = 0; night < 60; night += 1) {
      // 台本の15人は町で買った品をずっと持っている（既存の規則）。上限が効くのは
      // 人数の決まっていない名簿側で、売った数だけ膨らむのはそちらである。
      const buyers = state.npcs.filter((npc) => npc.adventurer && npc.status !== "dead" && npc.id.startsWith("adventurer-"));
      const buyer = buyers[night % buyers.length]!;
      const sold = createItem(state, night % 2 === 0 ? "iron-sword" : "leather-armor");
      buyer.inventoryIds.push(sold.uuid);
      markMerchantGoods(state, buyer, sold, "sold");
      sleepOneNight(state);
      pruneCampaignRecords(state);
    }

    const remembered = Object.values(state.itemsById)
      .filter((item) => item.merchantOrigin === "sold" && typeof item.owner === "string" && item.owner.startsWith("adventurer-"));
    expect(remembered.length).toBeLessThanOrEqual(MERCHANT_TRACE_LIMIT);
    expect(JSON.stringify(state).length).toBeLessThan(60_000);
    // 忘れた品を枠が指し続けていない。
    for (const npc of state.npcs) {
      for (const slot of gearSlots(npc)) expect(state.itemsById[slot.itemId]).toBeDefined();
    }
  });
});
