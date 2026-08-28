import { describe, expect, it } from "vitest";
import { beginExpedition, createItem, createNewGame, performDungeonCommand, returnHome } from "./engine";
import {
  BOND_MEMORY_PER_NPC,
  REMEMBERED_ABSENT_LIMIT,
  bondSummary,
  hasBond,
  latestBondDay,
  npcBonds,
  principalBond,
  recordBond,
  retainedNpcIds,
} from "./npcBonds";
import type { GameState, NpcRecord } from "./types";

function npc(id: string, bonds: NpcRecord["bonds"] = []): NpcRecord {
  return {
    id,
    name: id,
    profession: "swordsman",
    appearanceId: "profession.adventurer.swordsman.01",
    adventurer: true,
    status: "inTown",
    relation: 0,
    interests: [],
    budget: 100,
    inventoryIds: [],
    bonds,
  };
}

/** 迷宮で最初に出会う冒険者の隣へ立ち、取引できる状態にする。 */
function standBesideAdventurer(state: GameState): NpcRecord {
  const run = state.run!;
  const adventurer = run.adventurers[0]!;
  adventurer.pos = { x: run.player.x + 1, y: run.player.y };
  adventurer.hp = 1;
  run.map.tiles[run.player.y]![run.player.x] = 0;
  run.map.tiles[adventurer.pos.y]![adventurer.pos.x] = 0;
  return state.npcs.find((entry) => entry.id === adventurer.npcId)!;
}

describe("npc bonds", () => {
  it("keeps only the most recent bonds for one person", () => {
    const state = createNewGame();
    const person = npc("someone");
    for (let index = 0; index < BOND_MEMORY_PER_NPC + 4; index += 1) {
      state.day = index + 1;
      recordBond(state, person, "traded", `取引 ${index}`);
    }
    expect(npcBonds(person)).toHaveLength(BOND_MEMORY_PER_NPC);
    expect(npcBonds(person)[0]?.detail).toBe("取引 4");
    expect(latestBondDay(person)).toBe(BOND_MEMORY_PER_NPC + 4);
  });

  it("headlines the bond that carries the most weight, not the newest", () => {
    const person = npc("someone", [
      { day: 1, kind: "aided", detail: "薬を譲った", floor: 4 },
      { day: 9, kind: "traded", detail: "石を買った", floor: 2 },
    ]);
    expect(principalBond(person)?.kind).toBe("aided");
    expect(bondSummary(person)).toBe("地下4階で薬を譲った相手（縁 2件）");
  });

  it("reads as a single line when only one thing has passed between them", () => {
    expect(bondSummary(npc("a", [{ day: 3, kind: "foughtTogether", detail: "共に生還", floor: 5 }])))
      .toBe("地下5階で背中を預けた相手");
    expect(bondSummary(npc("b", [{ day: 3, kind: "served", detail: "買っていった" }])))
      .toBe("店で品を買ってくれた客");
    expect(bondSummary(npc("c"))).toBeUndefined();
    expect(hasBond(npc("c"))).toBe(false);
  });

  it("remembers the newest acquaintances and forgets the oldest", () => {
    const strangers = [
      npc("old", [{ day: 2, kind: "traded", detail: "" }]),
      npc("mid", [{ day: 5, kind: "traded", detail: "" }]),
      npc("new", [{ day: 9, kind: "traded", detail: "" }]),
    ];
    expect(retainedNpcIds(strangers, 2)).toEqual(new Set(["new", "mid"]));
    expect(retainedNpcIds(strangers, 0).size).toBe(0);
  });

  it("breaks ties on the same day by id so the same save always prunes the same way", () => {
    const sameDay = [
      npc("zeta", [{ day: 4, kind: "traded", detail: "" }]),
      npc("alpha", [{ day: 4, kind: "traded", detail: "" }]),
    ];
    expect(retainedNpcIds(sameDay, 1)).toEqual(new Set(["alpha"]));
  });
});

describe("bonds survive the return home", () => {
  it("remembers an adventurer rescued with medicine in the dungeon", () => {
    const state = createNewGame();
    beginExpedition(state);
    const met = standBesideAdventurer(state);
    const potion = createItem(state, "minor-healing-potion");
    state.inventory.push(potion);

    performDungeonCommand(state, { type: "sellToAdventurer", npcId: met.id, itemId: potion.uuid });
    returnHome(state);

    const remembered = state.npcs.find((entry) => entry.id === met.id);
    expect(remembered).toBeDefined();
    expect(principalBond(remembered!)?.kind).toBe("aided");
    expect(bondSummary(remembered!)).toContain("薬を譲った相手");
  });

  it("remembers an adventurer we merely traded with", () => {
    const state = createNewGame();
    state.gold = 5000;
    beginExpedition(state);
    const met = standBesideAdventurer(state);
    const stockId = met.inventoryIds[0]!;

    performDungeonCommand(state, { type: "buyFromAdventurer", npcId: met.id, itemId: stockId });
    returnHome(state);

    const remembered = state.npcs.find((entry) => entry.id === met.id);
    expect(remembered).toBeDefined();
    expect(principalBond(remembered!)?.kind).toBe("traded");
  });

  it("keeps an adventurer we passed without a word, but records no bond", () => {
    const state = createNewGame();
    beginExpedition(state);
    const ignored = state.npcs.find((entry) => entry.id === state.run!.adventurers[0]!.npcId)!;

    returnHome(state);

    // すれ違っただけの相手も町の住人。明日には店に来るかもしれないし、雇えるかもしれない。
    const stillListed = state.npcs.find((entry) => entry.id === ignored.id);
    expect(stillListed).toBeDefined();
    expect(hasBond(stillListed!)).toBe(false);
    expect(bondSummary(stillListed!)).toBeUndefined();
  });

  it("holds the save flat by remembering a fixed number of acquaintances", () => {
    const state = createNewGame();
    for (let visit = 0; visit < 12; visit += 1) {
      state.gold = 5000;
      state.day = visit + 1;
      state.timeSlot = "morning";
      state.lastExpeditionDay = 0;
      expect(beginExpedition(state)).toBe(true);
      const met = standBesideAdventurer(state);
      if (met.inventoryIds.length) {
        performDungeonCommand(state, { type: "buyFromAdventurer", npcId: met.id, itemId: met.inventoryIds[0]! });
      }
      returnHome(state);
      state.inventory = [];
    }

    const strangers = state.npcs.filter((entry) => entry.id.startsWith("generated-adventurer-"));
    expect(strangers.length).toBeLessThanOrEqual(REMEMBERED_ABSENT_LIMIT);
    expect(strangers.every((entry) => hasBond(entry))).toBe(true);
    expect(JSON.stringify(state).length).toBeLessThan(40_000);
  });
});
