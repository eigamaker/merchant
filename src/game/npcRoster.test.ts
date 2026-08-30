import { describe, expect, it } from "vitest";
import { createNewGame } from "./engine";
import { ADVENTURER_ROSTER_TARGET, ROSTER_RANK_SHAPE, createRosterAdventurer, ensureRosterPopulation, livingAdventurersByRank, thinnestRank } from "./npcRoster";
import { NPC_SEEDS, npcAppearanceSprite } from "./merchantContent";
import { ACTOR_CATALOG, applyActorSettings, currentActorSettings, npcActorIds } from "./actorCatalog";

describe("the adventurer roster", () => {
  it("fills the guild to its intended shape", () => {
    const state = createNewGame();
    expect(livingAdventurersByRank(state)).toEqual(ROSTER_RANK_SHAPE);
    expect(state.npcs.filter((npc) => npc.adventurer)).toHaveLength(ADVENTURER_ROSTER_TARGET);
    // 台本のある15人はそのまま名簿の一部になる。
    for (const seed of NPC_SEEDS) expect(state.npcs.some((npc) => npc.id === seed.id)).toBe(true);
  });

  it("builds the same person from the same state every time", () => {
    // campaignId は毎回ランダムなので、二つ作って比べると既存の名前の並びが揃わない。
    // 同じ状態を複製して、同じ入力から同じ人物が出ることを見る。
    const first = createNewGame();
    const second = JSON.parse(JSON.stringify(first)) as typeof first;

    const a = createRosterAdventurer(first, { rank: "B" });
    const b = createRosterAdventurer(second, { rank: "B" });

    expect(b.name).toBe(a.name);
    expect(b.maxHp).toBe(a.maxHp);
    expect(b.damage).toBe(a.damage);
    expect(b.id).toBe(a.id);
    expect(b.guardProfile!.personality).toEqual(a.guardProfile!.personality);
  });

  it("makes higher ranks meaningfully stronger", () => {
    const state = createNewGame();
    const novice = createRosterAdventurer(state, { rank: "E" });
    const veteran = createRosterAdventurer(state, { rank: "A" });
    expect(veteran.maxHp!).toBeGreaterThan(novice.maxHp!);
    expect(veteran.damage!).toBeGreaterThan(novice.damage!);
  });

  it("gives a newcomer no permanent belongings", () => {
    const state = createNewGame();
    const before = Object.keys(state.itemsById).length;
    const newcomer = createRosterAdventurer(state, { rank: "C" });
    // 名簿を増やしてもアイテムは増えない。迷宮の在庫はその探索限りで配られる。
    expect(newcomer.inventoryIds).toEqual([]);
    expect(Object.keys(state.itemsById)).toHaveLength(before);
  });

  it("refills the thinnest band after losses", () => {
    const state = createNewGame();
    for (const npc of state.npcs.filter((entry) => entry.adventurer && entry.rank === "C")) npc.status = "dead";
    expect(thinnestRank(state)).toBe("C");

    ensureRosterPopulation(state);

    expect(livingAdventurersByRank(state).C).toBe(ROSTER_RANK_SHAPE.C);
  });

  it("marks a famous arrival with a record worth paying for", () => {
    const state = createNewGame();
    const famous = createRosterAdventurer(state, { rank: "A", famous: true, status: "traveling" });
    expect(famous.famous).toBe(true);
    expect(famous.status).toBe("traveling");
    expect(famous.guardProfile!.career.deepestFloor).toBeGreaterThanOrEqual(6);
    // 実績はあっても、まだ一度も雇っていない。
    expect(famous.guardProfile!.career.hireCount).toBe(0);
  });
});

describe("who a generated adventurer looks like", () => {
  it("only ever wears a sheet marked as an adventurer", () => {
    const approved = new Set(npcActorIds("adventurer"));
    expect(approved.size).toBeGreaterThan(0);
    const state = createNewGame();
    const generated = state.npcs.filter((npc) => npc.id.startsWith("adventurer-"));
    expect(generated.length).toBeGreaterThan(0);
    for (const npc of generated) {
      expect(approved.has(npc.appearanceId)).toBe(true);
      expect(npcAppearanceSprite(npc.appearanceId)).toBe(npc.appearanceId);
    }
  });

  it("spreads the roster across every approved sheet", () => {
    const state = createNewGame();
    const worn = new Set(state.npcs.filter((npc) => npc.id.startsWith("adventurer-")).map((npc) => npc.appearanceId));
    // Thirty people over three sheets: a table this small should use them all.
    expect(worn).toEqual(new Set(npcActorIds("adventurer")));
  });

  it("falls back to the seed's own appearance when nothing is marked", () => {
    const settings = currentActorSettings();
    // Strip the role from every sheet that carries it, as an author would by
    // clearing the checkboxes, and check the roster still produces people.
    const cleared = { version: 1 as const, actors: { ...settings.actors } };
    for (const actor of Object.values(ACTOR_CATALOG)) {
      if (!actor.roles?.includes("adventurer")) continue;
      cleared.actors[actor.id] = { ...cleared.actors[actor.id], roles: actor.roles.filter((role) => role !== "adventurer") };
    }
    try {
      applyActorSettings(cleared);
      expect(npcActorIds("adventurer")).toEqual([]);
      const state = createNewGame();
      const generated = state.npcs.filter((npc) => npc.id.startsWith("adventurer-"));
      expect(generated.length).toBeGreaterThan(0);
      // Back to the seed's appearance id, which the authored table still answers.
      expect(generated.every((npc) => Boolean(npcAppearanceSprite(npc.appearanceId)))).toBe(true);
    } finally {
      applyActorSettings(settings);
    }
  });
});
