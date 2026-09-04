import { describe, expect, it } from "vitest";
import { beginExpedition, createItem, createNewGame } from "./engine";
import { restUntilMorning } from "./merchantSystems";
import { FLOOR_ADVENTURER_MAX, announceSingularFind, preferredDelveFloor, resolveDelveOutcome, simulateTownDay } from "./townDay";
import { ensureGuardProfile } from "./guardProfiles";
import { ADVENTURER_ROSTER_TARGET } from "./npcRoster";
import { escortFeeForNpc } from "./merchantEconomy";
import { ADVENTURER_RANKS } from "./merchantContent";
import { DUNGEON_MAX_FLOOR } from "./dungeonDifficulty";
import type { GameState } from "./types";

/** 夜まで進めてから寝る。町の一日が回る唯一の入口。 */
function sleepUntilNextMorning(state: GameState): void {
  state.timeSlot = "evening";
  restUntilMorning(state);
}

describe("delve outcomes", () => {
  const base = { rank: "C" as const, floor: 12, hpRatio: 1, courage: 50, discipline: 50, roll: 0.06 };

  it("gets deadlier the further past the recommended depth they go", () => {
    // 同じ出目でも、深くなるほど悪い結末へ倒れる。
    expect(resolveDelveOutcome({ ...base, floor: 12 })).toBe("returned");
    expect(resolveDelveOutcome({ ...base, floor: 14 })).not.toBe("returned");
    expect(resolveDelveOutcome({ ...base, floor: 16, roll: 0.2 })).toBe("died");
  });

  it("rewards courage and discipline with survival", () => {
    const reckless = { ...base, floor: 16, courage: 10, discipline: 10, roll: 0.28 };
    expect(resolveDelveOutcome(reckless)).toBe("died");
    expect(resolveDelveOutcome({ ...reckless, courage: 95, discipline: 95 })).not.toBe("died");
  });

  it("makes a wounded delver likelier to die", () => {
    const wounded = { ...base, hpRatio: 0.2, roll: 0.06 };
    expect(resolveDelveOutcome(wounded)).toBe("died");
    expect(resolveDelveOutcome({ ...wounded, hpRatio: 1 })).not.toBe("died");
  });

  it("sends braver adventurers deeper than their rank suggests", () => {
    const state = createNewGame();
    const npc = state.npcs.find((entry) => entry.adventurer)!;
    npc.rank = "C";
    const profile = ensureGuardProfile(state, npc);
    profile.personality.courage = 95;
    const bold = preferredDelveFloor(npc, profile, 0.5);
    profile.personality.courage = 5;
    const timid = preferredDelveFloor(npc, profile, 0.5);
    expect(bold).toBeGreaterThan(timid);
    expect(preferredDelveFloor(npc, profile, 0)).toBeGreaterThanOrEqual(1);
    expect(preferredDelveFloor(npc, profile, 1)).toBeLessThanOrEqual(DUNGEON_MAX_FLOOR);
  });

  it("keeps even A-rank adventurers near their limit at the bottom", () => {
    expect(ADVENTURER_RANKS.A.recommendedFloor).toBeLessThan(DUNGEON_MAX_FLOOR);
    const result = resolveDelveOutcome({
      rank: "A",
      floor: DUNGEON_MAX_FLOOR,
      hpRatio: 1,
      courage: 75,
      discipline: 75,
      gearPower: 6,
      roll: 0.2,
    });
    expect(result).not.toBe("returned");
  });
});

describe("the town turns on its own", () => {
  it("starts each floor with half as many adventurers as before", () => {
    expect(FLOOR_ADVENTURER_MAX).toBe(1);
  });

  it("runs a given day exactly once", () => {
    const state = createNewGame();
    state.day += 1;
    simulateTownDay(state);
    const after = JSON.stringify(state.npcs);
    simulateTownDay(state);
    expect(JSON.stringify(state.npcs)).toBe(after);
  });

  it("reproduces the same day from the same save", () => {
    const first = createNewGame();
    const second = JSON.parse(JSON.stringify(first)) as GameState;
    first.day += 1;
    second.day += 1;
    simulateTownDay(first);
    simulateTownDay(second);
    expect(JSON.stringify(second.npcs)).toBe(JSON.stringify(first.npcs));
  });

  it("never resolves someone standing beside the merchant", () => {
    const state = createNewGame();
    expect(beginExpedition(state)).toBe(true);
    const run = state.run!;
    const beside = run.adventurers.map((entry) => entry.npcId);
    const guardId = run.guard?.guardId;
    const before = new Map(state.npcs.map((npc) => [npc.id, npc.status]));

    state.day += 1;
    simulateTownDay(state);

    for (const npcId of [...beside, ...(guardId ? [guardId] : [])]) {
      expect(state.npcs.find((npc) => npc.id === npcId)?.status).toBe(before.get(npcId));
    }
  });

  it("leaves nobody stuck on yesterday's plan", () => {
    const state = createNewGame();
    for (let night = 0; night < 6; night += 1) sleepUntilNextMorning(state);
    const stale = state.npcs.filter((npc) => npc.status === "delving" && (npc.delve?.departedDay ?? 0) < state.day);
    expect(stale).toEqual([]);
    expect(state.npcs.every((npc) => npc.status !== "delving" || npc.delve !== undefined)).toBe(true);
  });

  it("keeps people moving between the town and the dungeon", () => {
    const state = createNewGame();
    for (let night = 0; night < 8; night += 1) sleepUntilNextMorning(state);
    const statuses = new Set(state.npcs.filter((npc) => npc.adventurer).map((npc) => npc.status));
    // 町が空にも満員にもならず、潜っている者と町にいる者が同時にいる。
    expect(statuses.has("delving")).toBe(true);
    expect(statuses.has("inTown")).toBe(true);
    const inTown = state.npcs.filter((npc) => npc.adventurer && npc.status === "inTown").length;
    expect(inTown).toBeGreaterThanOrEqual(5);
  });
});

describe("newcomers arrive to fill the gaps", () => {
  it("never invites more people than the roster is short of", () => {
    const state = createNewGame();
    for (let night = 0; night < 20; night += 1) {
      sleepUntilNextMorning(state);
      // 道中の新人を含めても、名簿は目標人数を超えない。満員の町へ新人は来ない。
      const committed = state.npcs.filter((npc) => npc.adventurer && npc.status !== "dead").length;
      expect(committed).toBeLessThanOrEqual(ADVENTURER_ROSTER_TARGET);
    }
  });

  it("announces a newcomer before they walk in", () => {
    const state = createNewGame();
    // 名簿を大きく削り、補充が必ず起きる状態にする。
    for (const npc of state.npcs.filter((entry) => entry.adventurer).slice(0, 14)) npc.status = "dead";

    let arrival: { npcId: string } | undefined;
    for (let night = 0; night < 12 && !arrival; night += 1) {
      sleepUntilNextMorning(state);
      const event = state.events.find((entry) => entry.effect?.kind === "arrival");
      if (event?.effect?.kind === "arrival") arrival = event.effect;
    }
    expect(arrival).toBeDefined();

    // 到着日までは町の一員ではない。護衛候補にも客にも出てこない。
    const traveller = state.npcs.find((npc) => npc.id === arrival!.npcId)!;
    expect(traveller.status).toBe("traveling");

    for (let night = 0; night < 6 && traveller.status === "traveling"; night += 1) sleepUntilNextMorning(state);
    expect(traveller.status).toBe("inTown");
  });

  it("keeps a long campaign staffed", () => {
    const state = createNewGame();
    for (let night = 0; night < 60; night += 1) sleepUntilNextMorning(state);
    const living = state.npcs.filter((npc) => npc.adventurer && npc.status !== "dead").length;
    expect(living).toBeGreaterThanOrEqual(20);
    expect(living).toBeLessThanOrEqual(40);
    expect(JSON.stringify(state).length).toBeLessThan(60_000);
  });
});

describe("famous newcomers", () => {
  it("lets a rumour reach town before the person does", () => {
    // 有名枠は低確率なので、キャンペーンを振り直して一件見つける。
    let found: { state: GameState; npcId: string } | undefined;
    for (let attempt = 0; attempt < 40 && !found; attempt += 1) {
      const state = createNewGame();
      state.campaignId = `famous-${attempt}`;
      for (const npc of state.npcs.filter((entry) => entry.adventurer).slice(0, 16)) npc.status = "dead";
      for (let night = 0; night < 20 && !found; night += 1) {
        sleepUntilNextMorning(state);
        const famous = state.npcs.find((npc) => npc.famous);
        if (famous) found = { state, npcId: famous.id };
      }
    }
    expect(found).toBeDefined();

    const { state, npcId } = found!;
    const newcomer = state.npcs.find((npc) => npc.id === npcId)!;
    // 噂が先に立っている：雇う前から実績があり、その分だけ護衛料が高い。
    expect(["A", "B"]).toContain(newcomer.rank);
    expect(newcomer.guardProfile!.career.successfulReturns).toBeGreaterThan(0);
    expect(newcomer.guardProfile!.career.deepestFloor).toBeGreaterThanOrEqual(6);
    // 評判はあっても面識はない。観察記録は雇うまで開かない。
    expect(newcomer.guardProfile!.career.hireCount).toBe(0);
    expect(escortFeeForNpc(state, newcomer)).toBeGreaterThan(ADVENTURER_RANKS[newcomer.rank!].escortFee);
  });
});

describe("一品物の噂", () => {
  it("初めて持ち帰った日に噂が立ち、蒐集家が町へ向かう", () => {
    const state = createNewGame();
    const blade = createItem(state, "nameless-black-blade", 7);

    expect(announceSingularFind(state, blade)).toBe(true);
    const collector = state.npcs.find((npc) => npc.profession === "collector");
    expect(collector).toBeDefined();
    // 噂が本人より先に届く。訪ねてくるのは数日後。
    expect(collector!.status).toBe("traveling");
    expect(state.events.some((event) => event.id.startsWith("singular-rumour-"))).toBe(true);
    const arrival = state.events.find((event) => event.effect?.kind === "arrival" && event.effect.npcId === collector!.id);
    expect(arrival?.dueDay).toBeGreaterThan(state.day);

    // 二人目は来ない。一品物が客層を開くのは、その一度だけである。
    expect(announceSingularFind(state, blade)).toBe(false);
    expect(state.npcs.filter((npc) => npc.profession === "collector")).toHaveLength(1);
  });

  it("ありふれた品では誰も動かない", () => {
    const state = createNewGame();
    const sword = createItem(state, "iron-sword", 3);
    expect(announceSingularFind(state, sword)).toBe(false);
    expect(state.npcs.some((npc) => npc.profession === "collector")).toBe(false);
  });
});
