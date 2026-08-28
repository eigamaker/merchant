import { describe, expect, it } from "vitest";
import { beginExpedition, createNewGame, performDungeonCommand, returnHome } from "./engine";
import { restUntilMorning } from "./merchantSystems";
import { CORPSE_PERSIST_DAYS, corpsesOnFloor, recordCorpse } from "./dungeonCorpses";
import type { GameState, NpcRecord } from "./types";

function sleepOneNight(state: GameState): void {
  state.timeSlot = "evening";
  restUntilMorning(state);
}

/** その日、確実に迷宮へ出発できる状態にする。 */
function departFresh(state: GameState): void {
  state.timeSlot = "morning";
  state.lastExpeditionDay = 0;
  expect(beginExpedition(state)).toBe(true);
}

function killOffscreen(state: GameState, floor: number): NpcRecord {
  const victim = state.npcs.find((npc) => npc.adventurer && npc.status !== "dead")!;
  victim.status = "dead";
  recordCorpse(state, victim.id, floor, [], false);
  return victim;
}

describe("the corpse ledger", () => {
  it("puts a named body on the floor days after the death", () => {
    const state = createNewGame();
    const victim = killOffscreen(state, 1);
    sleepOneNight(state);

    departFresh(state);
    const body = state.run!.bodies.find((entry) => entry.npcId === victim.id);

    expect(body).toBeDefined();
    expect(body!.name).toContain(victim.name);
    // 誰にも見つけられなかった遺体は、行き当たった時に中身が決まる。
    expect(body!.loot.length).toBeGreaterThan(0);
    expect(state.dungeonCorpses.find((corpse) => corpse.npcId === victim.id)?.stocked).toBe(true);
  });

  it("keeps the same body findable on a later expedition until it is emptied", () => {
    const state = createNewGame();
    const victim = killOffscreen(state, 1);
    sleepOneNight(state);
    departFresh(state);
    const first = state.run!.bodies.find((entry) => entry.npcId === victim.id)!;
    const lootId = first.loot[0]!.uuid;
    returnHome(state);
    sleepOneNight(state);

    departFresh(state);
    const again = state.run!.bodies.find((entry) => entry.npcId === victim.id);
    expect(again).toBeDefined();
    expect(again!.loot.map((item) => item.uuid)).toContain(lootId);

    // 遺品を取り尽くすと台帳から外れ、遺体はもう現れない。
    state.run!.player = { ...again!.pos };
    performDungeonCommand(state, { type: "inspectBody", bodyId: again!.id });
    for (const item of [...again!.loot]) {
      performDungeonCommand(state, { type: "lootBody", bodyId: again!.id, itemId: item.uuid });
    }
    expect(state.inventory.some((item) => item.uuid === lootId)).toBe(true);
    returnHome(state);
    expect(state.dungeonCorpses.some((corpse) => corpse.npcId === victim.id)).toBe(false);
  });

  it("lets the dungeon swallow a body nobody came for", () => {
    const state = createNewGame();
    const victim = killOffscreen(state, 1);
    for (let night = 0; night <= CORPSE_PERSIST_DAYS + 1; night += 1) sleepOneNight(state);

    expect(corpsesOnFloor(state, 1).some((corpse) => corpse.npcId === victim.id)).toBe(false);
    departFresh(state);
    expect(state.run!.bodies.some((entry) => entry.npcId === victim.id)).toBe(false);
  });

  it("never leaves the recovered loot dangling after the return home", () => {
    const state = createNewGame();
    const victim = killOffscreen(state, 1);
    sleepOneNight(state);
    departFresh(state);
    const body = state.run!.bodies.find((entry) => entry.npcId === victim.id)!;
    const lootIds = body.loot.map((item) => item.uuid);

    returnHome(state);

    // 未回収の遺品は剪定を生き延びる。次に潜ったとき同じ品が置かれている。
    for (const id of lootIds) expect(state.itemsById[id]).toBeDefined();
  });
});
