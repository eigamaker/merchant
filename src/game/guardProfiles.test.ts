import { describe, expect, it } from "vitest";
import { NPC_SEEDS } from "./merchantContent";
import {
  assessGuardDescent,
  beginExpedition,
  canBeginExpedition,
  createItem,
  createNewGame,
  guardRecoveryTurns,
  guardRetreatRatio,
  moveInventoryItems,
  moveStoreItemsToInventory,
  performDungeonCommand,
  returnHome,
  setDisplayedItems,
  toggleDisplay,
} from "./engine";
import { guardObservationLines, guardTrustLabel, initializeGuardProfiles } from "./guardProfiles";
import { acceptCustomerPurchaseRequest, escortFeeForNpc, postEscortCommission, prepareCustomerPurchaseRequest } from "./merchantEconomy";
import { advanceTime, canReorganizeHomeInventory, closeShopSession, consumeDungeonTime, equipBag, resetDailySystems } from "./merchantSystems";

function fixedCampaign(id = "guard-profile-test") {
  const state = createNewGame();
  state.campaignId = id;
  for (const npc of state.npcs) npc.guardProfile = undefined;
  initializeGuardProfiles(state);
  return state;
}

function hireMina() {
  const state = fixedCampaign();
  state.gold = 1_000;
  const npc = state.npcs.find((entry) => entry.id === "mina")!;
  postEscortCommission(state, npc.id);
  expect(beginExpedition(state)).toBe(true);
  return { state, npc, guard: state.run!.guard! };
}

const SEED_ADVENTURER_IDS = new Set(NPC_SEEDS.filter((seed) => seed.adventurer).map((seed) => seed.id));

describe("guard personality and reputation", () => {
  it("assigns a deterministic balanced roster for each campaign", () => {
    const first = fixedCampaign("balanced-a");
    const second = fixedCampaign("balanced-a");
    const other = fixedCampaign("balanced-b");
    const snapshot = (state: ReturnType<typeof createNewGame>) => state.npcs
      .filter((npc) => npc.adventurer && SEED_ADVENTURER_IDS.has(npc.id))
      .map((npc) => [npc.id, npc.guardProfile!.personality] as const);

    expect(snapshot(second)).toEqual(snapshot(first));
    expect(snapshot(other)).not.toEqual(snapshot(first));
    const counts = new Map<string, number>();
    for (const [, personality] of snapshot(first)) counts.set(personality.archetype, (counts.get(personality.archetype) ?? 0) + 1);
    expect([...counts.values()].sort()).toEqual([2, 2, 2, 2, 2]);
    for (const [, personality] of snapshot(first)) {
      for (const value of [personality.courage, personality.discipline, personality.empathy, personality.integrity, personality.greed]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });

  it("reveals qualitative observations at one, three, and five hires", () => {
    const state = fixedCampaign();
    const npc = state.npcs.find((entry) => entry.id === "mina")!;
    npc.guardProfile!.career.hireCount = 0;
    expect(guardObservationLines(npc)).toEqual([]);
    npc.guardProfile!.career.hireCount = 1;
    expect(guardObservationLines(npc)).toHaveLength(1);
    npc.guardProfile!.career.hireCount = 3;
    expect(guardObservationLines(npc)).toHaveLength(3);
    // 5回目で、深手を負ったときに何を選ぶ人なのかまで見当がつく。
    npc.guardProfile!.career.hireCount = 5;
    expect(guardObservationLines(npc)).toHaveLength(6);
    expect(guardTrustLabel(80)).toBe("固い絆");
    expect(JSON.stringify(guardObservationLines(npc))).not.toMatch(/courage|discipline|empathy|integrity|greed|\d{2}/);
  });

  it("applies personality, reputation, and trust to the escort fee", () => {
    const state = fixedCampaign();
    const npc = state.npcs.find((entry) => entry.id === "mina")!;
    const profile = npc.guardProfile!;
    profile.personality.greed = 50;
    profile.career.deepestFloor = 5;
    profile.career.successfulReturns = 4;
    profile.trust = 60;
    const expected = Math.floor(100 * 1 * 1.14 * 0.88);
    expect(escortFeeForNpc(state, npc)).toBe(expected);
  });

  it("uses trust, stress, courage, and empathy in the retreat ratio", () => {
    const state = fixedCampaign();
    const npc = state.npcs.find((entry) => entry.id === "mina")!;
    Object.assign(npc.guardProfile!.personality, { courage: 50, empathy: 80 });
    npc.guardProfile!.trust = 60;
    npc.guardProfile!.stress = 50;
    const expected = (npc.retreatHpRatio ?? 0.25) + 0.1 - 0.08;
    expect(guardRetreatRatio(state, npc.id)).toBeCloseTo(expected);
  });

  it("uses courage boundaries for retreat recovery", () => {
    const state = fixedCampaign();
    const npc = state.npcs.find((entry) => entry.id === "mina")!;
    npc.guardProfile!.personality.courage = 70;
    expect(guardRecoveryTurns(state, npc.id)).toBe(1);
    npc.guardProfile!.personality.courage = 50;
    expect(guardRecoveryTurns(state, npc.id)).toBe(2);
    npc.guardProfile!.personality.courage = 30;
    expect(guardRecoveryTurns(state, npc.id)).toBe(3);
  });

  it("decays stress only for guards resting in town", () => {
    const state = fixedCampaign();
    const town = state.npcs.find((entry) => entry.id === "mina")!;
    const dungeon = state.npcs.find((entry) => entry.id === "rolf")!;
    town.guardProfile!.stress = dungeon.guardProfile!.stress = 50;
    dungeon.status = "delving";
    resetDailySystems(state);
    expect(town.guardProfile!.stress).toBe(38);
    expect(dungeon.guardProfile!.stress).toBe(50);
  });

  it("records a completed contract once and applies trust and stress recovery", () => {
    const { state, npc } = hireMina();
    npc.guardProfile!.stress = 18;
    returnHome(state);
    expect(npc.guardProfile!.career.successfulReturns).toBe(1);
    expect(npc.guardProfile!.trust).toBe(28);
    expect(npc.guardProfile!.stress).toBe(8);
    expect(npc.guardProfile!.career.events.filter((event) => event.type === "returned")).toHaveLength(1);
  });

  it("applies food-shortage trust and stress consequences to the active guard", () => {
    const { state, npc } = hireMina();
    state.provisions = 0;
    consumeDungeonTime(state, 30);
    expect(npc.guardProfile!.trust).toBe(14);
    expect(npc.guardProfile!.stress).toBe(15);
    expect(npc.guardProfile!.career.events.at(-1)?.type).toBe("starved");
  });
});

describe("daily expedition and shop locks", () => {
  it("advances time on entry and allows only one expedition per current or return day", () => {
    const state = fixedCampaign();
    expect(canBeginExpedition(state).allowed).toBe(true);
    expect(beginExpedition(state)).toBe(true);
    expect(state.timeSlot).toBe("afternoon");
    expect(state.lastExpeditionDay).toBe(1);
    returnHome(state);
    const serial = state.expeditionSerial;
    const blockedTime = state.timeSlot;
    expect(beginExpedition(state)).toBe(false);
    expect(state.expeditionSerial).toBe(serial);
    expect(state.timeSlot).toBe(blockedTime);
    advanceTime(state, 3);
    expect(state.day).toBe(2);
    expect(beginExpedition(state)).toBe(true);

    state.provisions = 10;
    consumeDungeonTime(state, 90);
    returnHome(state);
    expect(state.lastExpeditionDay).toBe(state.day);
    expect(beginExpedition(state)).toBe(false);
  });

  it.each(["movingToCounter", "waiting", "serving"] as const)("locks all home inventory changes while %s", (status) => {
    const state = fixedCampaign();
    const sword = createItem(state, "iron-sword");
    const ring = createItem(state, "old-ring");
    const sack = createItem(state, "shoulder-sack");
    state.inventory.push(sword, sack);
    ring.owner = "store";
    ring.location = { kind: "homeStorage" };
    state.store.push(ring);
    const carriedBefore = state.equipment.bagItemId;
    state.shopSession.status = status;
    expect(canReorganizeHomeInventory(state)).toBe(false);
    expect(equipBag(state, sack.uuid)).toBe(false);
    expect(state.equipment.bagItemId).toBe(carriedBefore);
    expect(moveInventoryItems(state, [sword.uuid], "storage")).toBe(0);
    expect(moveStoreItemsToInventory(state, [ring.uuid])).toBe(0);
    toggleDisplay(state, ring);
    expect(state.display).not.toContain(ring.uuid);
    expect(setDisplayedItems(state, [ring.uuid])).toBe(0);
    expect(state.inventory).toContain(sword);
    expect(state.store).toContain(ring);
    expect(state.message).toContain("営業中");
    closeShopSession(state);
    expect(moveInventoryItems(state, [sword.uuid], "storage")).toBe(1);
  });

  it("still permits the current customer purchase while inventory is locked", () => {
    const state = fixedCampaign();
    const buyer = state.npcs.find((npc) => npc.id === "godwin")!;
    const sword = createItem(state, "iron-sword");
    sword.location = { kind: "shopStock" };
    state.store.push(sword);
    state.display.push(sword.uuid);
    buyer.status = "visiting";
    state.shopSession = { day: state.day, status: "serving", queueNpcIds: [], currentNpcId: buyer.id, servedNpcIds: [] };
    expect(prepareCustomerPurchaseRequest(state, buyer.id)).toBeDefined();
    expect(acceptCustomerPurchaseRequest(state).accepted).toBe(true);
  });
});

describe("guard depth decisions", () => {
  it("warns without consuming a turn, then records a forced descent", () => {
    const { state, npc, guard } = hireMina();
    npc.guardProfile!.personality.courage = 30;
    Object.assign(npc.guardProfile!, { trust: 20, stress: 0 });
    state.provisions = 3;
    state.run!.floor = 2;
    state.run!.player = { ...state.run!.map.stairsDown! };
    guard.hp = guard.maxHp;
    state.hp = state.maxHp;
    expect(assessGuardDescent(state, 3)?.severity).toBe("warn");
    const time = state.run!.timeUnits;
    const prompt = performDungeonCommand(state, { type: "stairs" });
    expect(prompt.consumedTurn).toBe(false);
    expect(prompt.guardDescent?.severity).toBe("warn");
    expect(state.run!.timeUnits).toBe(time);

    const result = performDungeonCommand(state, { type: "stairs", guardResponse: "continue" });
    expect(result.consumedTurn).toBe(true);
    expect(state.run!.floor).toBe(3);
    expect(npc.guardProfile!.trust).toBe(18);
    expect(npc.guardProfile!.stress).toBe(5);
    expect(npc.guardProfile!.career.warningsIgnored).toBe(1);
  });

  it("lets a refusing guard return safely while the merchant descends alone", () => {
    const { state, npc, guard } = hireMina();
    npc.guardProfile!.personality.courage = 0;
    Object.assign(npc.guardProfile!, { trust: 20, stress: 100 });
    state.provisions = 0;
    state.run!.floor = 2;
    state.run!.player = { ...state.run!.map.stairsDown! };
    guard.hp = 1;
    state.hp = 1;
    expect(assessGuardDescent(state, 3)?.severity).toBe("refuse");
    const result = performDungeonCommand(state, { type: "stairs", guardResponse: "dismiss" });
    expect(result.consumedTurn).toBe(true);
    expect(state.run!.floor).toBe(3);
    expect(state.run!.guard).toBeUndefined();
    // HP1で帰した相手は、翌日すぐには雇えない。
    expect(npc.status).toBe("recovering");
    expect(npc.conditionHp).toBe(1);
    expect(npc.guardProfile!.trust).toBe(15);
    expect(npc.guardProfile!.career.earlyDepartures).toBe(1);
    expect(state.escortCommission).toBeUndefined();
  });
});
