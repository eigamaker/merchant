import { describe, expect, it } from "vitest";
import { createNewGame } from "./engine";
import { ensureGuardProfile } from "./guardProfiles";
import { ADVENTURER_RANKS } from "./merchantContent";
import { escortFeeForNpc } from "./merchantEconomy";
import { PROMOTION_TALLY, applySurvivalGrowth, growthCap, nextRank, readyForPromotion, survivalTally } from "./adventurerGrowth";
import type { GameState, NpcRecord } from "./types";

function rosterMember(state: GameState): NpcRecord {
  return state.npcs.find((npc) => npc.adventurer && npc.rank === "E")!;
}

describe("growing an adventurer", () => {
  it("gives nothing for a stroll through the shallows", () => {
    const state = createNewGame();
    const npc = rosterMember(state);
    const profile = ensureGuardProfile(state, npc);
    const before = { maxHp: npc.maxHp, damage: npc.damage };

    // Eランクの推奨は地下2階。1階を往復しても身にはならない。
    for (let day = 1; day <= 30; day += 1) {
      state.day = day;
      applySurvivalGrowth(state, npc, profile, 1);
    }

    expect(npc.maxHp).toBe(before.maxHp);
    expect(npc.damage).toBe(before.damage);
  });

  it("grows from surviving the depths, and stops at the ceiling", () => {
    const state = createNewGame();
    const npc = rosterMember(state);
    const profile = ensureGuardProfile(state, npc);
    const cap = growthCap("E");

    for (let day = 1; day <= 80; day += 1) {
      state.day = day;
      profile.career.soloDelves += 1;
      applySurvivalGrowth(state, npc, profile, 2);
      if (npc.rank !== "E") break;
    }

    // Eのままなら上限で止まる。昇格していればそちらが先に来ている。
    if (npc.rank === "E") {
      expect(npc.maxHp!).toBeLessThanOrEqual(cap.maxHp);
      expect(npc.damage!).toBeLessThanOrEqual(cap.damage);
      expect(npc.maxHp!).toBeGreaterThan(ADVENTURER_RANKS.E.baseHp);
    } else {
      expect(npc.rank).toBe("D");
    }
  });

  it("reproduces the same growth from the same state", () => {
    const first = createNewGame();
    const second = JSON.parse(JSON.stringify(first)) as GameState;
    const grow = (state: GameState) => {
      const npc = rosterMember(state);
      const profile = ensureGuardProfile(state, npc);
      for (let day = 1; day <= 20; day += 1) {
        state.day = day;
        profile.career.soloDelves += 1;
        applySurvivalGrowth(state, npc, profile, 3);
      }
      return npc;
    };
    const a = grow(first);
    const b = grow(second);
    expect(b.maxHp).toBe(a.maxHp);
    expect(b.damage).toBe(a.damage);
    expect(b.rank).toBe(a.rank);
  });

  it("needs both the tally and the depth before it promotes", () => {
    const state = createNewGame();
    const npc = rosterMember(state);
    const profile = ensureGuardProfile(state, npc);

    profile.career.soloDelves = PROMOTION_TALLY.E;
    profile.career.soloDeepest = ADVENTURER_RANKS.E.recommendedFloor;
    expect(readyForPromotion(npc, profile)).toBe(false);   // 数は足りているが浅い

    profile.career.soloDelves = 1;
    profile.career.soloDeepest = ADVENTURER_RANKS.E.recommendedFloor + 2;
    expect(readyForPromotion(npc, profile)).toBe(false);   // 深いが数が足りない

    profile.career.soloDelves = PROMOTION_TALLY.E;
    expect(readyForPromotion(npc, profile)).toBe(true);
    expect(survivalTally(profile)).toBe(PROMOTION_TALLY.E);
  });

  it("re-prices a home-grown escort the moment they are promoted", () => {
    const state = createNewGame();
    const npc = rosterMember(state);
    const profile = ensureGuardProfile(state, npc);
    const feeBefore = escortFeeForNpc(state, npc);

    profile.career.soloDelves = PROMOTION_TALLY.E;
    profile.career.soloDeepest = ADVENTURER_RANKS.E.recommendedFloor + 2;
    const result = applySurvivalGrowth(state, npc, profile, 4);

    expect(result.promotedTo).toBe("D");
    expect(npc.rank).toBe("D");
    expect(npc.maxHp!).toBeGreaterThanOrEqual(ADVENTURER_RANKS.D.baseHp);
    // 育てた相手は高くなる。それが育てた証になる。
    expect(escortFeeForNpc(state, npc)).toBeGreaterThan(feeBefore);
    expect(state.events.some((event) => event.id.startsWith("promoted-"))).toBe(true);
  });

  it("has nowhere to promote an A rank", () => {
    expect(nextRank("A")).toBeUndefined();
    const state = createNewGame();
    const veteran = state.npcs.find((npc) => npc.adventurer && npc.rank === "A")!;
    const profile = ensureGuardProfile(state, veteran);
    profile.career.soloDelves = 100;
    profile.career.soloDeepest = 8;
    expect(readyForPromotion(veteran, profile)).toBe(false);
  });
});
