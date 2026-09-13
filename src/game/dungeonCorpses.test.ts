import { describe, expect, it } from "vitest";
import { beginExpedition, createItem, createNewGame, performDungeonCommand, returnHome } from "./engine";
import { restUntilMorning } from "./merchantSystems";
import { CORPSE_PERSIST_DAYS, corpsesOnFloor, recordCorpse } from "./dungeonCorpses";
import { createExpedition } from "./expeditions";
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

describe("what makes a body worth coming back for", () => {
  /** 商人の手を離れた品を一つ持たせてから、画面外で死なせる。 */
  function dieCarrying(state: GameState, origin: "sold" | "entrusted", definitionId: string): NpcRecord {
    const victim = state.npcs.find((npc) => npc.adventurer && npc.status !== "dead")!;
    const item = createItem(state, definitionId);
    item.owner = victim.id;
    item.location = { kind: "npcInventory", npcId: victim.id };
    victim.inventoryIds.push(item.uuid);
    victim.gear = { armor: { itemId: item.uuid, since: state.day } };
    item.merchantOrigin = origin;
    victim.status = "delving";
    victim.expedition = createExpedition(victim, state.day, 2, 1);
    victim.conditionHp = 1;
    // 死ぬまで日を送る。単独潜行の決着は毎朝の町処理で起きる。
    const living = (): NpcRecord => state.npcs.find((npc) => npc.id === victim.id)!;
    for (let night = 0; night < 200 && living().status !== "dead"; night += 1) {
      const current = living();
      if (current.status !== "delving") {
        current.status = "delving";
        current.expedition = createExpedition(current, state.day, 2, 1);
        current.conditionHp = 1;
      }
      sleepOneNight(state);
    }
    expect(living().status).toBe("dead");
    return living();
  }

  // 地下2階では功績が段に届かないので、品は銘を得ない。銘を得た品はどちらでも形見になる
  // —— ここで分けたいのは「何も背負っていない売り物」と「託した品」である。
  it("does not make a corpse a keepsake just because a jerkin was sold", () => {
    const sold = createNewGame();
    const soldVictim = dieCarrying(sold, "sold", "leather-armor");
    expect(sold.dungeonCorpses.find((corpse) => corpse.npcId === soldVictim.id)?.keepsake).toBeUndefined();

    const entrusted = createNewGame();
    const entrustedVictim = dieCarrying(entrusted, "entrusted", "leather-armor");
    // 託した品なら、迷宮はしばらく待ってくれる。
    expect(entrusted.dungeonCorpses.find((corpse) => corpse.npcId === entrustedVictim.id)?.keepsake).toBe(true);
  });
});
