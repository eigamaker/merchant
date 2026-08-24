import { describe, expect, it } from "vitest";
import {
  acceptQuest,
  ascend,
  beginExpedition,
  buildInitialEnemies,
  consultRing,
  createItem,
  createNewGame,
  descend,
  dropItem,
  generateDungeon,
  guardFee,
  guardRetreatThreshold,
  hireGuard,
  initialOffer,
  movePlayer,
  performDungeonCommand,
  reportQuest,
  resolveRing,
  returnHome,
  sellItem,
  shoveEnemy,
  tryPickup,
  tryStairs,
  useSmokeBomb,
  waitTurn,
} from "./engine";
import { migrateSaveState } from "./save";
import { restUntilMorning } from "./merchantSystems";
import { DUNGEON_ENTRANCE } from "./homeMap";
import type { DungeonFloorSnapshot, DungeonMap } from "./types";

function compactDungeonMap(width: number, height: number, stairsUp: { x: number; y: number }, stairsDown: { x: number; y: number }): DungeonMap {
  const tiles = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => x === 0 || y === 0 || x === width - 1 || y === height - 1 ? 1 : 0));
  return { width, height, tileSize: 16, tiles, stairsUp, stairsDown };
}

function emptyFloorSnapshot(floor: number, map: DungeonMap): DungeonFloorSnapshot {
  return { floor, map, player: { ...map.stairsUp }, enemies: [], items: [], chests: [], traps: [], bodies: [], adventurers: [], shoveCooldown: 0, turn: 0 };
}

function reachableTiles(map: ReturnType<typeof generateDungeon>): Set<string> {
  const visited = new Set<string>();
  const queue = [map.stairsUp];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const key = `${current.x},${current.y}`;
    if (visited.has(key)) continue;
    visited.add(key);
    for (const direction of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
      const next = { x: current.x + direction.x, y: current.y + direction.y };
      if (next.x >= 0 && next.y >= 0 && next.x < map.width && next.y < map.height && map.tiles[next.y]![next.x] === 0) queue.push(next);
    }
  }
  return visited;
}

describe("canonical dungeon stairs", () => {
  it("uses the selected authored enemy roster with per-actor stats and random positions", () => {
    const map = compactDungeonMap(10, 8, { x: 1, y: 1 }, { x: 8, y: 6 });
    map.enemyRoster = ["slime1"];
    const enemies = buildInitialEnemies(map, 1, 42);
    expect(enemies).toHaveLength(7);
    expect(enemies.every((enemy) => enemy.actorId === "slime1" && enemy.name === "Slime1" && enemy.hp === 4 && enemy.damage === 1)).toBe(true);
    expect(new Set(enemies.map((enemy) => `${enemy.pos.x},${enemy.pos.y}`)).size).toBe(enemies.length);
  });

  it("returns to home from the first floor's up stairs", () => {
    const state = createNewGame();
    beginExpedition(state);
    state.run!.player = { ...state.run!.map.stairsUp };
    tryStairs(state);
    expect(state.location).toBe("home");
    expect(state.run).toBeUndefined();
    expect(state.homePos).toEqual({ x: DUNGEON_ENTRANCE.x * 16 + 8, y: DUNGEON_ENTRANCE.y * 16 + 8 });
  });

  it("counts stair travel as one of the thirty actions before a meal", () => {
    const state = createNewGame();
    beginExpedition(state);
    state.provisions = 1;
    state.run!.timeUnits = 29;
    state.run!.settledTimeBands = 0;
    state.run!.player = { ...state.run!.map.stairsDown! };

    tryStairs(state);

    expect(state.run?.timeUnits).toBe(30);
    expect(state.run?.settledTimeBands).toBe(1);
    expect(state.provisions).toBe(0);
  });

  it("does not charge a partial meal when returning before thirty actions", () => {
    const state = createNewGame();
    beginExpedition(state);
    state.provisions = 3;
    state.run!.timeUnits = 29;

    performDungeonCommand(state, { type: "return" });

    expect(state.location).toBe("home");
    expect(state.provisions).toBe(3);
  });

  it("snapshots a floor and restores defeated enemies after travelling back", () => {
    const state = createNewGame();
    beginExpedition(state);
    const first = state.run!;
    first.enemies[0]!.hp = 1;
    first.turn = 7;
    descend(state);
    expect(state.run?.floor).toBe(2);
    expect(state.run?.floorStates?.["1"]?.turn).toBe(7);
    ascend(state);
    expect(state.run?.floor).toBe(1);
    expect(state.run?.enemies[0]?.hp).toBe(1);
    expect(state.run?.turn).toBe(7);
  });

  it("keeps a carried guard in the party cell at the down-stair landing", () => {
    const state = createNewGame();
    beginExpedition(state);
    const run = state.run!;
    run.guard = { guardId: "rolf", pos: { x: 47, y: 35 }, hp: 3, maxHp: 8, damage: 2, mode: "covering", safeTurns: 0 };
    const targetMap = compactDungeonMap(6, 5, { x: 1, y: 1 }, { x: 4, y: 3 });
    run.floorStates["2"] = emptyFloorSnapshot(2, targetMap);

    descend(state);

    expect(state.run?.map.width).toBe(6);
    expect(state.run?.player).toEqual(targetMap.stairsUp);
    expect(state.run?.guard).toMatchObject({ hp: 3, maxHp: 8, damage: 2, pos: targetMap.stairsUp });
    expect(state.run?.guard?.pos).toEqual(state.run?.player);
  });

  it("keeps a carried guard in the party cell at the up-stair landing", () => {
    const state = createNewGame();
    beginExpedition(state);
    descend(state);
    const run = state.run!;
    run.guard = { guardId: "rolf", pos: { x: 47, y: 35 }, hp: 2, maxHp: 8, damage: 2, mode: "covering", safeTurns: 0 };
    const targetMap = compactDungeonMap(8, 6, { x: 1, y: 1 }, { x: 6, y: 4 });
    const target = emptyFloorSnapshot(1, targetMap);
    target.guard = { guardId: "rolf", pos: { x: 2, y: 2 }, hp: 8, maxHp: 8, damage: 2, mode: "covering", safeTurns: 0 };
    run.floorStates["1"] = target;

    ascend(state);

    expect(state.run?.map.width).toBe(8);
    expect(state.run?.player).toEqual(targetMap.stairsDown);
    expect(state.run?.guard).toMatchObject({ hp: 2, maxHp: 8, damage: 2, pos: targetMap.stairsDown });
    expect(state.run?.guard?.pos).toEqual(state.run?.player);
  });
});

describe("dungeon generator", () => {
  it("creates a town-sized dungeon with a useful amount of walkable space", () => {
    for (let seed = 1; seed <= 120; seed += 1) {
      const map = generateDungeon(seed, (seed % 8) + 1);
      const floorCount = map.tiles.flat().filter((tile) => tile === 0).length;
      expect(map.width).toBe(48);
      expect(map.height).toBe(36);
      expect(floorCount).toBeGreaterThan(260);
      expect(map.tiles[0]?.every((tile) => tile === 1)).toBe(true);
      expect(map.tiles.at(-1)?.every((tile) => tile === 1)).toBe(true);
    }
  });

  it("keeps the entrance and stairs connected across representative seeds", () => {
    for (let seed = 1; seed <= 120; seed += 1) {
      const map = generateDungeon(seed, (seed % 8) + 1, seed % 3 === 0);
      const reachable = reachableTiles(map);
      expect(reachable.has(`${map.stairsDown?.x},${map.stairsDown?.y}`)).toBe(true);
      if (map.specialRoom) expect(reachable.has(`${map.specialRoom.x},${map.specialRoom.y}`)).toBe(true);
    }
  });

  it("uses a new persistent seed every time an expedition begins", () => {
    const state = createNewGame();
    const signatures = new Set<string>();
    for (let visit = 0; visit < 30; visit += 1) {
      beginExpedition(state);
      const run = state.run;
      if (!run) throw new Error("run missing");
      signatures.add(`${run.seed}:${run.map.tiles.flat().join("")}`);
      returnHome(state, false);
      state.timeSlot = "morning";
    }
    expect(state.expeditionSerial).toBe(30);
    expect(signatures.size).toBe(30);
  });

  it("places dungeon entities on distinct walkable cells", () => {
    const state = createNewGame();
    beginExpedition(state);
    const run = state.run;
    if (!run) throw new Error("run missing");
    const positions = [
      run.map.stairsUp,
      run.map.stairsDown!,
      ...run.enemies.map((enemy) => enemy.pos),
      ...run.items.map((item) => item.pos),
      ...run.chests.map((chest) => chest.pos),
      ...run.traps,
      ...run.bodies.map((body) => body.pos),
      ...run.adventurers.map((adventurer) => adventurer.pos),
    ];
    expect(run.adventurers).toHaveLength(2);
    expect(run.adventurers.every((adventurer) => state.npcs.find((npc) => npc.id === adventurer.npcId)?.rank === "E")).toBe(true);
    const keys = positions.map((position) => `${position.x},${position.y}`);
    expect(new Set(keys).size).toBe(keys.length);
    positions.forEach((position) => expect(run.map.tiles[position.y]?.[position.x]).toBe(0));
  });
});

describe("merchant story loop", () => {
  it("schedules the black sword incident after selling to the duke", () => {
    const state = createNewGame();
    const blackSwordQuest = state.quests.find((quest) => quest.id === "black-sword");
    if (blackSwordQuest) blackSwordQuest.status = "available";
    acceptQuest(state, "black-sword");
    beginExpedition(state);
    descend(state);
    descend(state);
    const sword = state.run?.items.find((entry) => entry.item.definitionId === "black-sword")?.item;
    const duke = state.customers.find((customer) => customer.id === "duke");

    expect(sword).toBeDefined();
    expect(duke).toBeDefined();
    if (!sword || !duke) throw new Error("test setup failed");
    state.inventory.push(sword);
    state.story.blackSword = "found";
    expect(initialOffer(state, sword, duke)).toBeGreaterThan(0);

    const result = sellItem(state, sword, "duke");
    expect(result).toContain("売却した");
    expect(state.archive).toContain(sword);
    expect(state.events.some((event) => event.id === "black-sword-incident")).toBe(true);

    returnHome(state, false);
    state.timeSlot = "evening";
    restUntilMorning(state);
    expect(state.story.blackSword).toBe("incident");
    expect(state.quests.find((quest) => quest.id === "black-tomb")?.status).toBe("active");
  });

  it("does not lose unique or active-quest items during a rescue", () => {
    const state = createNewGame();
    const blackSwordQuest = state.quests.find((quest) => quest.id === "black-sword");
    if (blackSwordQuest) blackSwordQuest.status = "available";
    acceptQuest(state, "black-sword");
    beginExpedition(state);
    descend(state);
    descend(state);
    const runItems = state.run?.items.map((entry) => entry.item) ?? [];
    const sword = runItems.find((item) => item.definitionId === "black-sword");
    const ordinary = runItems.find((item) => item.definitionId !== "black-sword");
    if (!sword || !ordinary) throw new Error("test setup failed");
    state.inventory.push(sword, ordinary);

    returnHome(state, true);

    expect(state.inventory).toContain(sword);
    expect(state.inventory).not.toContain(ordinary);
  });
});

describe("merchant survival actions", () => {
  function lineUpEnemy(state: ReturnType<typeof createNewGame>, blocked = false): NonNullable<typeof state.run>["enemies"][number] {
    beginExpedition(state);
    const run = state.run;
    const enemy = run?.enemies[0];
    if (!run || !enemy) throw new Error("test setup failed");
    const player = { x: 5, y: 5 };
    run.player = player;
    run.map.tiles[5]![5] = 0;
    run.map.tiles[5]![6] = 0;
    run.map.tiles[5]![7] = blocked ? 1 : 0;
    enemy.pos = { x: 6, y: 5 };
    enemy.staggerTurns = 8;
    run.enemies = [enemy];
    return enemy;
  }

  it("does not attack when movement is blocked by an enemy", () => {
    const state = createNewGame();
    const enemy = lineUpEnemy(state);
    const hp = enemy.hp;
    const turn = state.run!.turn;

    const result = movePlayer(state, { x: 1, y: 0 });

    expect(result.consumedTurn).toBe(false);
    expect(enemy.hp).toBe(hp);
    expect(state.run!.player).toEqual({ x: 5, y: 5 });
    expect(state.run!.turn).toBe(turn);
  });

  it("shoves without damage, staggers once, and needs two other turns to recover", () => {
    const state = createNewGame();
    const enemy = lineUpEnemy(state);
    const hp = enemy.hp;

    const result = shoveEnemy(state, { x: 1, y: 0 });

    expect(result.consumedTurn).toBe(true);
    expect(enemy.pos).toEqual({ x: 7, y: 5 });
    expect(enemy.hp).toBe(hp);
    expect(state.run!.shoveCooldown).toBe(2);
    waitTurn(state);
    expect(state.run!.shoveCooldown).toBe(1);
    waitTurn(state);
    expect(state.run!.shoveCooldown).toBe(0);
  });

  it("spends a turn and cooldown when a shove is blocked", () => {
    const state = createNewGame();
    const enemy = lineUpEnemy(state, true);

    const result = shoveEnemy(state, { x: 1, y: 0 });

    expect(result.consumedTurn).toBe(true);
    expect(enemy.pos).toEqual({ x: 6, y: 5 });
    expect(state.run!.shoveCooldown).toBe(2);
  });
});

describe("automatic guards", () => {
  function unlockAndHire(state: ReturnType<typeof createNewGame>, guardId = "rolf"): void {
    state.story.early.guardHiringUnlocked = true;
    state.guards.forEach((guard) => { guard.unlocked = true; });
    expect(hireGuard(state, guardId)).toBe(true);
  }

  it("hires one named guard and refunds the prior contract when switching", () => {
    const state = createNewGame();
    unlockAndHire(state);
    expect(state.gold).toBe(200);
    expect(hireGuard(state, "mina")).toBe(true);
    expect(state.hiredGuardId).toBe("mina");
    expect(state.gold).toBe(160);
  });

  it("lets the guard attack first and draw adjacent enemy attacks", () => {
    const state = createNewGame();
    unlockAndHire(state);
    beginExpedition(state);
    const run = state.run!;
    const guard = run.guard!;
    const enemy = run.enemies[0]!;
    run.enemies = [enemy];
    run.player = { x: 5, y: 5 };
    guard.pos = { ...run.player };
    enemy.pos = { x: 6, y: 5 };
    run.map.tiles[5]![5] = run.map.tiles[5]![6] = 0;
    enemy.hp = 10;
    const playerHp = state.hp;
    const guardHp = guard.hp;

    waitTurn(state);

    expect(enemy.hp).toBe(10 - guard.damage);
    expect(guard.hp).toBe(guardHp - enemy.damage);
    expect(state.hp).toBe(playerHp);
  });

  it("prioritizes an adjacent enemy the guard can defeat", () => {
    const state = createNewGame();
    unlockAndHire(state);
    beginExpedition(state);
    const run = state.run!;
    const guard = run.guard!;
    const [killable, dangerous] = run.enemies;
    if (!killable || !dangerous) throw new Error("test setup failed");
    run.player = { x: 5, y: 5 };
    guard.pos = { ...run.player };
    killable.pos = { x: 6, y: 5 };
    killable.hp = guard.damage;
    killable.damage = 1;
    dangerous.pos = { x: 5, y: 6 };
    dangerous.hp = 20;
    dangerous.damage = 5;
    run.enemies = [dangerous, killable];

    waitTurn(state);

    expect(run.enemies.some((enemy) => enemy.id === killable.id)).toBe(false);
    expect(run.enemies.some((enemy) => enemy.id === dangerous.id)).toBe(true);
  });

  it("removes a defeated guard for two full town days", () => {
    const state = createNewGame();
    unlockAndHire(state);
    beginExpedition(state);
    const run = state.run!;
    const guard = run.guard!;
    const enemy = run.enemies[0]!;
    run.enemies = [enemy];
    run.player = { x: 5, y: 5 };
    guard.pos = { ...run.player };
    guard.hp = 1;
    enemy.pos = { x: 6, y: 5 };
    enemy.hp = 20;
    enemy.damage = 2;
    run.map.tiles[5]![5] = run.map.tiles[5]![6] = 0;

    waitTurn(state);

    expect(run.guard).toBeUndefined();
    expect(state.npcs.find((entry) => entry.id === "rolf")?.status).toBe("dead");
    expect(run.bodies.some((body) => body.npcId === "rolf")).toBe(true);
  });

  it("gains relation and floor experience only after a safe return", () => {
    const state = createNewGame();
    unlockAndHire(state);
    beginExpedition(state);
    descend(state);
    descend(state);

    returnHome(state, false);

    const record = state.guards.find((entry) => entry.id === "rolf")!;
    expect(record.relation).toBe(1);
    expect(record.experience).toBe(3);
    expect(record.level).toBe(2);
  });

  it("applies the family guild discount to future contracts", () => {
    const state = createNewGame();
    state.story.early.guardHiringUnlocked = true;
    state.guards[0]!.unlocked = true;
    expect(guardFee(state, "rolf")).toBe(100);
    state.guildReputation = 2;
    expect(guardFee(state, "rolf")).toBe(80);
  });

  it("moves the guard in the same party cell as the merchant", () => {
    const state = createNewGame();
    unlockAndHire(state);
    beginExpedition(state);
    const run = state.run!;
    run.enemies = [];
    run.player = { x: 5, y: 5 };
    run.guard!.pos = { x: 9, y: 9 };
    run.map.tiles[5]![5] = run.map.tiles[5]![6] = 0;

    movePlayer(state, { x: 1, y: 0 });

    expect(run.player).toEqual({ x: 6, y: 5 });
    expect(run.guard?.pos).toEqual(run.player);
  });

  it("retreats immediately at the NPC threshold and sends later attacks to the merchant", () => {
    const state = createNewGame();
    unlockAndHire(state);
    beginExpedition(state);
    const run = state.run!;
    const guard = run.guard!;
    const [first, second] = run.enemies;
    if (!first || !second) throw new Error("test setup failed");
    run.player = { x: 5, y: 5 };
    guard.pos = { ...run.player };
    guard.hp = 4;
    first.pos = { x: 6, y: 5 };
    second.pos = { x: 5, y: 6 };
    first.hp = second.hp = 20;
    first.damage = second.damage = 1;
    first.staggerTurns = second.staggerTurns = 0;
    run.enemies = [first, second];
    const playerHp = state.hp;

    waitTurn(state);

    expect(guard.hp).toBe(3);
    expect(guard.mode).toBe("retreated");
    expect(state.hp).toBe(playerHp - 1);
  });

  it("resets unsafe recovery and resumes cover after two safe turns", () => {
    const state = createNewGame();
    unlockAndHire(state);
    beginExpedition(state);
    const run = state.run!;
    const guard = run.guard!;
    guard.mode = "retreated";
    guard.safeTurns = 1;
    const enemy = run.enemies[0]!;
    enemy.pos = { x: run.player.x + 4, y: run.player.y };
    enemy.staggerTurns = 2;
    run.enemies = [enemy];

    waitTurn(state);
    expect(guard.safeTurns).toBe(0);
    expect(guard.mode).toBe("retreated");

    run.enemies = [];
    waitTurn(state);
    expect(guard.safeTurns).toBe(1);
    waitTurn(state);
    expect(guard.mode).toBe("covering");
    expect(guard.safeTurns).toBe(0);
  });

  it("uses the configured retreat threshold for each named adventurer", () => {
    const state = createNewGame();
    const threshold = (guardId: string, maxHp: number) => guardRetreatThreshold(state, { guardId, pos: { x: 1, y: 1 }, hp: maxHp, maxHp, damage: 1, mode: "covering", safeTurns: 0 });
    expect(threshold("mina", 6)).toBe(3);
    expect(threshold("rolf", 8)).toBe(3);
    expect(threshold("bastian", 10)).toBe(2);
    expect(threshold("future-adventurer", 8)).toBe(2);
  });

  it("uses a healing item on the active guard and consumes one dungeon turn", () => {
    const state = createNewGame();
    unlockAndHire(state);
    beginExpedition(state);
    const guard = state.run!.guard!;
    state.run!.enemies = [];
    guard.hp = 1;
    const potion = createItem(state, "minor-healing-potion");
    state.inventory.push(potion);
    const beforeTurn = state.run!.turn;

    const result = performDungeonCommand(state, { type: "useMedicine", itemId: potion.uuid, target: "guard" });

    expect(result.consumedTurn).toBe(true);
    expect(guard.hp).toBe(5);
    expect(state.run!.turn).toBe(beforeTurn + 1);
    expect(state.inventory).not.toContain(potion);
    expect(potion.location).toEqual({ kind: "consumed", actorId: guard.guardId });
  });
});

describe("independent dungeon adventurers", () => {
  function placeBesidePlayer(state: ReturnType<typeof createNewGame>): NonNullable<typeof state.run>["adventurers"][number] {
    beginExpedition(state);
    const run = state.run!;
    const adventurer = run.adventurers[0]!;
    run.player = { x: 5, y: 5 };
    adventurer.pos = { x: 6, y: 5 };
    run.map.tiles[5]![5] = run.map.tiles[5]![6] = run.map.tiles[5]![7] = 0;
    run.enemies = [];
    return adventurer;
  }

  it("lets the merchant buy and sell with a nearby adventurer", () => {
    const state = createNewGame();
    const adventurer = placeBesidePlayer(state);
    const npc = state.npcs.find((entry) => entry.id === adventurer.npcId)!;
    const stock = state.itemsById[npc.inventoryIds[0]!]!;
    const startingGold = state.gold;

    performDungeonCommand(state, { type: "buyFromAdventurer", npcId: npc.id, itemId: stock.uuid });
    expect(state.inventory).toContain(stock);
    expect(npc.inventoryIds).not.toContain(stock.uuid);
    expect(state.gold).toBeLessThan(startingGold);

    const wantedDefinition = ({ weapon: "iron-sword", armor: "leather-armor", medicine: "minor-healing-potion", material: "moon-fungus", curio: "old-ring" } as const)[npc.interests[0] as "weapon" | "armor" | "medicine" | "material" | "curio"];
    const wanted = createItem(state, wantedDefinition);
    state.inventory.push(wanted);
    const resaleGold = state.gold;
    performDungeonCommand(state, { type: "sellToAdventurer", npcId: npc.id, itemId: wanted.uuid });
    expect(state.inventory).not.toContain(wanted);
    expect(npc.inventoryIds).toContain(wanted.uuid);
    expect(state.gold).toBeGreaterThan(resaleGold);
  });

  it("allows an adventurer to die in combat and leaves their remaining inventory on the body", () => {
    const state = createNewGame();
    const adventurer = placeBesidePlayer(state);
    const run = state.run!;
    const npc = state.npcs.find((entry) => entry.id === adventurer.npcId)!;
    const enemy = { ...run.enemies[0] } as NonNullable<typeof run.enemies[number]>;
    const template = createNewGame();
    beginExpedition(template);
    const sourceEnemy = template.run!.enemies[0]!;
    Object.assign(enemy, sourceEnemy, { pos: { x: 7, y: 5 }, hp: 99, maxHp: 99, damage: adventurer.maxHp, staggerTurns: 0 });
    adventurer.hp = adventurer.maxHp;
    run.enemies = [enemy];
    const lootIds = [...npc.inventoryIds];

    waitTurn(state);

    expect(run.adventurers.some((entry) => entry.npcId === npc.id)).toBe(false);
    expect(npc.status).toBe("dead");
    const body = run.bodies.find((entry) => entry.npcId === npc.id);
    expect(body?.loot.map((item) => item.uuid).sort()).toEqual(lootIds.sort());
  });

  it("uses a healing item sold to a wounded adventurer on that turn", () => {
    const state = createNewGame();
    const adventurer = placeBesidePlayer(state);
    const npc = state.npcs.find((entry) => entry.id === adventurer.npcId)!;
    npc.inventoryIds = npc.inventoryIds.filter((id) => state.itemsById[id]?.definitionId !== "minor-healing-potion");
    adventurer.hp = Math.max(1, adventurer.maxHp - 10);
    const potion = createItem(state, "major-healing-potion");
    state.inventory.push(potion);

    performDungeonCommand(state, { type: "sellToAdventurer", npcId: npc.id, itemId: potion.uuid });

    expect(adventurer.hp).toBe(adventurer.maxHp);
    expect(potion.location).toEqual({ kind: "consumed", actorId: npc.id });
    expect(npc.inventoryIds).not.toContain(potion.uuid);
  });
});

describe("inventory choices and early story", () => {
  it("holds twenty-four items regardless of item type", () => {
    const state = createNewGame();
    beginExpedition(state);
    const run = state.run!;
    state.inventory = Array.from({ length: 23 }, () => createItem(state, "bronze-spear", 1));
    const ground = run.items[0]!;
    run.player = { ...ground.pos };

    const result = tryPickup(state);

    expect(result.consumedTurn).toBe(true);
    expect(state.inventory).toHaveLength(24);
    expect(state.inventory).toContain(ground.item);
  });

  it("swaps one carried item for a ground quest item when all twenty-four slots are full", () => {
    const state = createNewGame();
    beginExpedition(state);
    const run = state.run!;
    state.smokeBombs = 0;
    state.returnStones = 0;
    state.provisions = 0;
    state.inventory = Array.from({ length: 24 }, () => createItem(state, "bronze-spear", 1));
    const herb = run.items.find((entry) => entry.item.definitionId === "herb")!;
    run.player = { ...herb.pos };
    const swap = state.inventory[0]!;

    const result = tryPickup(state, swap.uuid);

    expect(result.consumedTurn).toBe(true);
    expect(state.inventory.some((item) => item.definitionId === "herb")).toBe(true);
    expect(state.inventory).not.toContain(swap);
    expect(run.items.some((entry) => entry.item.uuid === swap.uuid && entry.pos.x === run.player.x && entry.pos.y === run.player.y)).toBe(true);
  });

  it("returns a dropped quest objective to active and makes it recoverable", () => {
    const state = createNewGame();
    beginExpedition(state);
    const run = state.run!;
    const herb = run.items.find((entry) => entry.item.definitionId === "herb")!;
    run.player = { ...herb.pos };
    tryPickup(state);
    expect(state.quests.find((quest) => quest.id === "herb")?.status).toBe("readyToReport");

    dropItem(state, herb.item.uuid);

    expect(state.quests.find((quest) => quest.id === "herb")?.status).toBe("active");
    expect(run.items.some((entry) => entry.item.uuid === herb.item.uuid)).toBe(true);
  });

  it("keeps Aron's body reachable and respawns unclaimed heirlooms on a new map", () => {
    const state = createNewGame();
    const missing = state.quests.find((quest) => quest.id === "missing")!;
    missing.status = "active";
    beginExpedition(state);
    descend(state);
    const first = state.run!.bodies.find((body) => body.id === "aron")!;
    expect(reachableTiles(state.run!.map).has(`${first.pos.x},${first.pos.y}`)).toBe(true);
    expect(first.loot.map((item) => item.definitionId).sort()).toEqual(["adventurer-badge", "old-ring"]);
    const firstSeed = state.run!.seed;

    returnHome(state, false);
    beginExpedition(state);
    descend(state);
    const second = state.run!.bodies.find((body) => body.id === "aron")!;
    expect(state.run!.seed).not.toBe(firstSeed);
    expect(second.loot.map((item) => item.definitionId).sort()).toEqual(["adventurer-badge", "old-ring"]);
  });

  it("plays the four early quests in order and unlocks the black sword", () => {
    const state = createNewGame();
    const completeCollection = (questId: string, itemId: string): void => {
      const quest = state.quests.find((entry) => entry.id === questId)!;
      quest.status = "readyToReport";
      state.inventory.push(createItem(state, itemId, quest.targetFloor));
      expect(reportQuest(state, questId)).toBe(true);
    };

    completeCollection("herb", "herb");
    expect(state.gold).toBe(380);
    expect(state.quests.find((quest) => quest.id === "lost-sword")?.status).toBe("available");
    acceptQuest(state, "lost-sword");
    completeCollection("lost-sword", "rusted-sword");
    expect(state.gold).toBe(500);
    expect(state.story.early.guardHiringUnlocked).toBe(true);
    expect(state.quests.find((quest) => quest.id === "missing")?.status).toBe("available");
    acceptQuest(state, "missing");
    completeCollection("missing", "adventurer-badge");
    expect(state.gold).toBe(700);
    expect(state.quests.find((quest) => quest.id === "old-ring")?.status).toBe("active");

    state.inventory.push(createItem(state, "old-ring", 2));
    consultRing(state, "scholar");
    consultRing(state, "jeweler");
    consultRing(state, "duke");
    expect(state.quests.find((quest) => quest.id === "old-ring")?.status).toBe("readyToReport");
    resolveRing(state, "family");

    expect(state.guildReputation).toBe(2);
    expect(state.gold).toBe(950);
    expect(state.story.early.stage).toBe("complete");
    expect(state.quests.find((quest) => quest.id === "black-sword")?.status).toBe("available");
  });

  it.each([
    ["family", 250, "guild"],
    ["scholar", 700, "scholar"],
    ["jeweler", 1300, "jeweler"],
  ] as const)("resolves the ring once via %s", (resolution, reward, effect) => {
    const state = createNewGame();
    const quest = state.quests.find((entry) => entry.id === "old-ring")!;
    quest.status = "readyToReport";
    state.story.early.ringConsulted = ["scholar", "jeweler", "duke"];
    state.inventory.push(createItem(state, "old-ring", 2));
    const before = state.gold;

    resolveRing(state, resolution);
    const repeat = resolveRing(state, resolution);

    expect(state.gold).toBe(before + reward);
    expect(repeat).toContain("まだ決められない");
    if (effect === "guild") expect(state.guildReputation).toBe(2);
    else expect(state.customers.find((customer) => customer.id === effect)?.relation).toBe(2);
  });

  it("prevents normal sale of active quest items", () => {
    const state = createNewGame();
    const herb = createItem(state, "herb", 1);
    state.inventory.push(herb);
    const before = state.gold;

    const result = sellItem(state, herb, "merchant");

    expect(result).toContain("通常売却できない");
    expect(state.gold).toBe(before);
    expect(state.inventory).toContain(herb);
  });
});

describe("save migration", () => {
  it("migrates a version 1 run and supplements all version 2 fields", () => {
    const current = createNewGame();
    beginExpedition(current);
    const run = current.run!;
    const legacy = {
      ...current,
      version: 1 as const,
      guildReputation: undefined,
      guards: undefined,
      story: { blackSword: "locked" as const },
      quests: current.quests.map((quest) => ({ ...quest, status: quest.id === "herb" ? "complete" as const : "available" as const })),
      run: {
        ...run,
        enemies: run.enemies.map(({ staggerTurns: _staggerTurns, ...enemy }) => enemy),
        chests: run.chests.map((chest) => chest.pos),
        bodies: run.bodies.map((body) => body.pos),
        guard: undefined,
        shoveCooldown: undefined,
        highestFloor: undefined,
      },
    };

    const migrated = migrateSaveState(legacy as never);

    expect(migrated.version).toBe(7);
    expect(migrated.guildReputation).toBe(0);
    expect(migrated.guards).toHaveLength(2);
    expect(migrated.story.early.stage).toBe("lostSword");
    expect(migrated.run?.shoveCooldown).toBe(0);
    expect(migrated.run?.enemies.every((enemy) => enemy.staggerTurns === 0)).toBe(true);
    expect(migrated.run?.chests[0]?.pos).toBeDefined();
  });
});

describe("escape tools", () => {
  it("breaks pursuit with a smoke bomb", () => {
    const state = createNewGame();
    beginExpedition(state);
    const enemy = state.run?.enemies[0];
    if (!enemy || !state.run) throw new Error("test setup failed");
    enemy.pos = { x: state.run.player.x + 1, y: state.run.player.y };
    enemy.state = "chase";

    useSmokeBomb(state);

    expect(state.smokeBombs).toBe(0);
    expect(enemy.state).toBe("patrol");
  });
});
