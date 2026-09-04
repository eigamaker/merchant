import { describe, expect, it } from "vitest";
import { DUNGEON_ACTIONS_PER_MEAL, PROVISIONS_PER_SLOT } from "./merchantSystems";
import {
  APOTHECARY_MEDICINE_IDS,
  RETURN_STONE_CHEST_CHANCE,
  RETURN_STONE_MIN_FLOOR,
  SHALLOW_GROUND_FLOORS,
  ascend,
  beginExpedition,
  buildInitialEnemies,
  buyMedicineAtApothecary,
  createItem,
  createNewGame,
  currentItemCount,
  itemCount,
  itemName,
  descend,
  dungeonMedicineNeedRatio,
  dungeonProvisionBuyPrice,
  dungeonProvisionDemand,
  generateDungeon,
  guardRetreatThreshold,
  movePlayer,
  performDungeonCommand,
  returnHome,
  returnStoneChestFor,
  shoveEnemy,
  tryOpenChest,
  tryPickup,
  tryStairs,
  useSmokeBomb,
  waitTurn,
} from "./engine";
import { migrateSaveState } from "./save";
import { MATERIAL_STACK_SIZE, MERCHANT_ITEM_DEFINITIONS } from "./merchantContent";
import { postEscortCommission } from "./merchantEconomy";
import { marketPrice } from "./pricing";
import { DUNGEON_ENTRANCE } from "./homeMap";
import type { DungeonFloorSnapshot, DungeonMap } from "./types";

function compactDungeonMap(width: number, height: number, stairsUp: { x: number; y: number }, stairsDown: { x: number; y: number }): DungeonMap {
  const tiles = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => x === 0 || y === 0 || x === width - 1 || y === height - 1 ? 1 : 0));
  return { width, height, tileSize: 16, tiles, stairsUp, stairsDown };
}

function emptyFloorSnapshot(floor: number, map: DungeonMap): DungeonFloorSnapshot {
  return { floor, map, player: { ...map.stairsUp }, enemies: [], items: [], chests: [], bodies: [], adventurers: [], shoveCooldown: 0, turn: 0 };
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

  it("counts stair travel as one of the actions before a meal", () => {
    const state = createNewGame();
    beginExpedition(state);
    state.provisions = 1;
    state.run!.timeUnits = DUNGEON_ACTIONS_PER_MEAL - 1;
    state.run!.settledTimeBands = 0;
    state.run!.player = { ...state.run!.map.stairsDown! };

    tryStairs(state);

    expect(state.run?.timeUnits).toBe(DUNGEON_ACTIONS_PER_MEAL);
    expect(state.run?.settledTimeBands).toBe(1);
    expect(state.provisions).toBe(0);
  });

  it("does not charge a partial meal when returning before a full meal interval", () => {
    const state = createNewGame();
    beginExpedition(state);
    state.provisions = 3;
    state.returnStones = 1;
    state.run!.timeUnits = DUNGEON_ACTIONS_PER_MEAL - 1;

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
    run.guard = { guardId: "rolf", pos: { x: 47, y: 35 }, hp: 3, maxHp: 8, damage: 2, mode: "covering", safeTurns: 0, healingTrustGained: 0, retreatCount: 0 };
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
    run.guard = { guardId: "rolf", pos: { x: 47, y: 35 }, hp: 2, maxHp: 8, damage: 2, mode: "covering", safeTurns: 0, healingTrustGained: 0, retreatCount: 0 };
    const targetMap = compactDungeonMap(8, 6, { x: 1, y: 1 }, { x: 6, y: 4 });
    const target = emptyFloorSnapshot(1, targetMap);
    target.guard = { guardId: "rolf", pos: { x: 2, y: 2 }, hp: 8, maxHp: 8, damage: 2, mode: "covering", safeTurns: 0, healingTrustGained: 0, retreatCount: 0 };
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
      const map = generateDungeon(seed, (seed % 8) + 1);
      const reachable = reachableTiles(map);
      expect(reachable.has(`${map.stairsDown?.x},${map.stairsDown?.y}`)).toBe(true);
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
      returnHome(state);
      state.day += 1;
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
      ...run.bodies.map((body) => body.pos),
      ...run.adventurers.map((adventurer) => adventurer.pos),
    ];
    // 迷宮の冒険者は名簿から借りる。鋳造しないので、その日潜っている人数が上限になる。
    expect(run.adventurers.length).toBeLessThanOrEqual(2);
    expect(run.adventurers.every((adventurer) => state.npcs.find((npc) => npc.id === adventurer.npcId)?.status === "delving")).toBe(true);
    expect(run.adventurers.every((adventurer) => !adventurer.npcId.startsWith("generated-"))).toBe(true);
    const keys = positions.map((position) => `${position.x},${position.y}`);
    expect(new Set(keys).size).toBe(keys.length);
    positions.forEach((position) => expect(run.map.tiles[position.y]?.[position.x]).toBe(0));
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
    state.gold += 1000;
    expect(postEscortCommission(state, guardId)?.id).toBe(guardId);
  }


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
    const career = state.npcs.find((npc) => npc.id === guard.guardId)!.guardProfile!.career;
    expect(career.damageCovered).toBe(enemy.damage);
    expect(career.events.at(-1)?.type).toBe("covered");
  });

  it("prioritizes an adjacent enemy the guard can defeat", () => {
    const state = createNewGame();
    unlockAndHire(state);
    beginExpedition(state);
    const run = state.run!;
    const guard = run.guard!;
    state.npcs.find((npc) => npc.id === guard.guardId)!.guardProfile!.personality.discipline = 50;
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
    const career = state.npcs.find((npc) => npc.id === guard.guardId)!.guardProfile!.career;
    expect(career.enemiesDefeated).toBe(1);
    expect(career.events.some((event) => event.type === "kill")).toBe(true);
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
    Object.assign(state.npcs.find((npc) => npc.id === guard.guardId)!.guardProfile!, { trust: 20, stress: 0 });
    // 共感0で踏みとどまらず、忠義は十分あるので逃げもしない —— 後退だけを見る配役。
    Object.assign(state.npcs.find((npc) => npc.id === guard.guardId)!.guardProfile!.personality,
      { courage: 50, empathy: 0, integrity: 80, discipline: 60, greed: 20 });
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
    expect(guard.retreatCount).toBe(1);
    expect(state.hp).toBe(playerHp - 1);
    const profile = state.npcs.find((npc) => npc.id === guard.guardId)!.guardProfile!;
    expect(profile.stress).toBe(8);
    expect(profile.career.retreatCount).toBe(1);
  });

  it("holds the line to the death when devotion outweighs the wound", () => {
    const state = createNewGame();
    unlockAndHire(state);
    beginExpedition(state);
    const run = state.run!;
    const guard = run.guard!;
    const npc = state.npcs.find((entry) => entry.id === guard.guardId)!;
    // 共感の深い者は、自分の残量を無視して前に立ち続ける。止める手立ては商人にはない ——
    // 下がらせれば、次に死ぬのは商人のほうだからである。
    Object.assign(npc.guardProfile!, { trust: 60, stress: 0 });
    Object.assign(npc.guardProfile!.personality, { empathy: 95, courage: 60, integrity: 80, discipline: 60, greed: 20 });
    const enemy = run.enemies[0]!;
    run.player = { x: 5, y: 5 };
    guard.pos = { ...run.player };
    guard.hp = 2;
    enemy.pos = { x: 6, y: 5 };
    enemy.hp = 99;
    enemy.damage = 1;
    enemy.staggerTurns = 0;
    run.enemies = [enemy];
    const playerHp = state.hp;

    waitTurn(state);

    // 退かないので後退の記録は増えず、商人は一撃も受けない。
    expect(guard.mode).toBe("covering");
    expect(guard.retreatCount).toBe(0);
    expect(state.hp).toBe(playerHp);

    waitTurn(state);

    // そして次の一撃で死ぬ。忠義の代償はこれである。
    expect(run.guard).toBeUndefined();
    expect(npc.status).toBe("dead");
  });

  it("abandons the merchant at depth when loyalty runs out, and the guild records it", () => {
    const state = createNewGame();
    unlockAndHire(state);
    beginExpedition(state);
    const run = state.run!;
    const guard = run.guard!;
    const npc = state.npcs.find((entry) => entry.id === guard.guardId)!;
    // 強欲で不実な相手。踏みとどまりもしないし、退いて付き合いもしない。
    Object.assign(npc.guardProfile!, { trust: 0, stress: 40 });
    Object.assign(npc.guardProfile!.personality, { empathy: 10, courage: 50, integrity: 20, discipline: 30, greed: 90 });
    const enemy = run.enemies[0]!;
    run.player = { x: 5, y: 5 };
    guard.pos = { ...run.player };
    guard.hp = 2;
    enemy.pos = { x: 6, y: 5 };
    enemy.hp = 99;
    enemy.damage = 1;
    enemy.staggerTurns = 0;
    run.enemies = [enemy];

    waitTurn(state);

    // 契約ごと消える。護衛料は返らない。
    expect(run.guard).toBeUndefined();
    expect(state.hiredGuardId).toBeUndefined();
    expect(state.escortCommission).toBeUndefined();
    // 逃げ切った本人は生きている。失うのは信用のほうである。
    expect(npc.status).toBe("inTown");
    expect(npc.guardProfile!.career.abandonCount).toBe(1);
    expect(npc.guardProfile!.career.events.at(-1)?.type).toBe("abandoned");
    expect(npc.guardProfile!.trust).toBe(0);
    expect(npc.bonds?.at(-1)?.kind).toBe("abandoned");
    expect(state.message).toContain("取り残された");
  });

  it("resets unsafe recovery and resumes cover after two safe turns", () => {
    const state = createNewGame();
    unlockAndHire(state);
    beginExpedition(state);
    const run = state.run!;
    const guard = run.guard!;
    state.npcs.find((npc) => npc.id === guard.guardId)!.guardProfile!.personality.courage = 50;
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
    for (const guardId of ["mina", "rolf", "bastian"]) {
      const profile = state.npcs.find((npc) => npc.id === guardId)!.guardProfile!;
      Object.assign(profile.personality, { courage: 50, empathy: 0 });
      Object.assign(profile, { trust: 0, stress: 0 });
    }
    const threshold = (guardId: string, maxHp: number) => guardRetreatThreshold(state, { guardId, pos: { x: 1, y: 1 }, hp: maxHp, maxHp, damage: 1, mode: "covering", safeTurns: 0, healingTrustGained: 0, retreatCount: 0 });
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
    const profile = state.npcs.find((npc) => npc.id === guard.guardId)!.guardProfile!;
    expect(profile.trust).toBe(22);
    expect(profile.career.events.at(-1)?.type).toBe("healed");
  });

  it("caps medicine trust at four per expedition", () => {
    const state = createNewGame();
    unlockAndHire(state);
    beginExpedition(state);
    const guard = state.run!.guard!;
    state.run!.enemies = [];
    const profile = state.npcs.find((npc) => npc.id === guard.guardId)!.guardProfile!;
    for (let index = 0; index < 3; index += 1) {
      guard.hp = 1;
      const potion = createItem(state, "minor-healing-potion");
      state.inventory.push(potion);
      performDungeonCommand(state, { type: "useMedicine", itemId: potion.uuid, target: "guard" });
    }
    expect(profile.trust).toBe(24);
    expect(guard.healingTrustGained).toBe(4);
  });

  it("records the active guard's death day and floor once", () => {
    const state = createNewGame();
    unlockAndHire(state);
    beginExpedition(state);
    const run = state.run!;
    const guard = run.guard!;
    const npc = state.npcs.find((entry) => entry.id === guard.guardId)!;
    const enemy = run.enemies[0]!;
    run.player = { x: 5, y: 5 };
    guard.hp = 1;
    enemy.pos = { x: 6, y: 5 };
    enemy.hp = 99;
    enemy.damage = 2;
    run.enemies = [enemy];

    waitTurn(state);

    expect(run.guard).toBeUndefined();
    expect(npc.status).toBe("dead");
    expect(npc.guardProfile!.career.deathDay).toBe(state.day);
    expect(npc.guardProfile!.career.deathFloor).toBe(run.floor);
    expect(npc.guardProfile!.career.events.filter((event) => event.type === "died")).toHaveLength(1);
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
    adventurer.maxHp = 12;
    adventurer.hp = 2;
    const potion = createItem(state, "major-healing-potion");
    state.inventory.push(potion);

    performDungeonCommand(state, { type: "sellToAdventurer", npcId: npc.id, itemId: potion.uuid });

    expect(adventurer.hp).toBe(adventurer.maxHp);
    expect(potion.location).toEqual({ kind: "consumed", actorId: npc.id });
    expect(npc.inventoryIds).not.toContain(potion.uuid);
  });

  it("creates almost no supply demand in the shallows and sells batches at a deep-floor premium", () => {
    const state = createNewGame();
    const adventurer = placeBesidePlayer(state);
    const npc = state.npcs.find((entry) => entry.id === adventurer.npcId)!;
    const run = state.run!;
    // 端数が1枠を余分に使っている状態から始める。売れば枠がちょうど1つ空く。
    state.provisions = PROVISIONS_PER_SLOT + 1;
    adventurer.gold = 1000;
    const startingSlots = currentItemCount(state);

    expect(dungeonProvisionDemand(1)).toBe(0);
    const shallow = performDungeonCommand(state, { type: "sellProvisionsToAdventurer", npcId: npc.id });
    expect(shallow.consumedTurn).toBe(false);
    expect(state.provisions).toBe(PROVISIONS_PER_SLOT + 1);

    run.floor = 10;
    const demand = dungeonProvisionDemand(run.floor);
    const unitPrice = dungeonProvisionBuyPrice(run.floor);
    const startingGold = state.gold;
    const deep = performDungeonCommand(state, { type: "sellProvisionsToAdventurer", npcId: npc.id, unitPrice });

    expect(deep.consumedTurn).toBe(true);
    expect(demand).toBe(3);
    expect(state.provisions).toBe(PROVISIONS_PER_SLOT + 1 - demand);
    expect(currentItemCount(state)).toBe(startingSlots - 1);
    expect(state.gold).toBe(startingGold + unitPrice * demand);
    expect(adventurer.provisionsBought).toBe(demand);
    expect(state.message).toContain(`携行食料を${demand}個`);
    expect(dungeonProvisionBuyPrice(30)).toBeGreaterThan(unitPrice);
  });

  it("makes medicine demand begin earlier as adventurers go deeper", () => {
    expect(dungeonMedicineNeedRatio(1)).toBeLessThan(dungeonMedicineNeedRatio(30));
  });

  it("resumes exploring after combat but lets wounded adventurers and traders stop", () => {
    const state = createNewGame();
    const adventurer = placeBesidePlayer(state);
    const run = state.run!;
    run.nextTrafficTurn = 999;
    run.player = { x: 2, y: 2 };
    adventurer.pos = { x: 6, y: 5 };
    for (let y = 3; y <= 7; y += 1) for (let x = 4; x <= 8; x += 1) run.map.tiles[y]![x] = 0;
    const before = { ...adventurer.pos };

    waitTurn(state);
    expect(adventurer.pos).not.toEqual(before);

    adventurer.hp = Math.floor(adventurer.maxHp * 0.3);
    const woundedAt = { ...adventurer.pos };
    waitTurn(state);
    expect(adventurer.pos).toEqual(woundedAt);

    adventurer.hp = adventurer.maxHp;
    adventurer.pos = { x: run.player.x + 1, y: run.player.y };
    waitTurn(state);
    expect(adventurer.pos).toEqual({ x: run.player.x + 1, y: run.player.y });
  });
});

describe("rare return stones and town medicine", () => {
  it("removes the starting return stone and only rolls one in deep-floor chests", () => {
    const state = createNewGame();
    expect(state.returnStones).toBe(0);
    expect(RETURN_STONE_MIN_FLOOR).toBe(13);
    expect(RETURN_STONE_CHEST_CHANCE).toBe(0.05);
    for (let seed = 0; seed < 100; seed += 1) {
      expect(returnStoneChestFor(seed, RETURN_STONE_MIN_FLOOR - 1)).toBe(false);
    }
    const deepFinds = Array.from({ length: 1000 }, (_, seed) => returnStoneChestFor(seed, RETURN_STONE_MIN_FLOOR)).filter(Boolean).length;
    expect(deepFinds).toBeGreaterThan(20);
    expect(deepFinds).toBeLessThan(100);
  });

  it("adds the rare return stone when its deep chest is opened", () => {
    const state = createNewGame();
    beginExpedition(state);
    const run = state.run!;
    const chest = run.chests[0]!;
    chest.returnStone = true;
    run.player = { ...chest.pos };

    const result = tryOpenChest(state, chest.id);

    expect(result.consumedTurn).toBe(true);
    expect(state.returnStones).toBe(1);
    expect(state.message).toContain("帰還石");
  });

  it("buys identified healing medicine from the apothecary as a normal bag item", () => {
    const state = createNewGame();
    state.gold = 1_000;
    const beforeSlots = currentItemCount(state);
    const definitionId = APOTHECARY_MEDICINE_IDS[0];
    const price = MERCHANT_ITEM_DEFINITIONS[definitionId].baseValue;

    expect(buyMedicineAtApothecary(state, definitionId)).toBe(true);

    const bought = state.inventory.at(-1)!;
    expect(bought.definitionId).toBe(definitionId);
    expect(bought.knowledge).toBe("identified");
    expect(currentItemCount(state)).toBe(beforeSlots + 1);
    expect(state.gold).toBe(1_000 - price);
  });
});

describe("inventory choices and early story", () => {
  it("keeps weapons, trinkets and nameless corpses out of the shallow floors", () => {
    const shallow = new Set<string>();
    const deep = new Set<string>();
    let shallowBodies = 0;
    let deepBodies = 0;
    for (let seed = 0; seed < 30; seed += 1) {
      const state = createNewGame();
      state.campaignId = `spawn-${seed}`;
      // 迷宮のシードは日付と遠征通し番号から作られる。日を変えないと同じ階を30回見ることになる。
      state.day = seed + 1;
      beginExpedition(state);
      const first = state.run!;
      for (const entry of first.items) shallow.add(entry.item.definitionId);
      for (const chest of first.chests) shallow.add(chest.item.definitionId);
      shallowBodies += first.bodies.length;
      descend(state);
      descend(state);
      descend(state);
      const fourth = state.run!;
      expect(fourth.floor).toBe(4);
      for (const entry of fourth.items) deep.add(entry.item.definitionId);
      for (const chest of fourth.chests) deep.add(chest.item.definitionId);
      deepBodies += fourth.bodies.length;
    }

    // 地下1階は素材と薬だけの仕入れ場。武器が転がっているのは、そこまで担いで死んだ者がいた深さから。
    const shallowCategories = new Set([...shallow].map((id) => MERCHANT_ITEM_DEFINITIONS[id]!.category));
    expect(shallowCategories).toEqual(new Set(["material", "medicine"]));
    expect(deep.size).toBeGreaterThan(0);
    expect([...deep].some((id) => MERCHANT_ITEM_DEFINITIONS[id]!.category === "weapon")).toBe(true);

    // 身元の分からない遺体も地下4階から。1階で人がたくさん死んでいるのはおかしい。
    expect(shallowBodies).toBe(0);
    expect(deepBodies).toBeGreaterThan(0);
  });

  it("thickens the shallow floors with materials and thins the deeper ones", () => {
    for (let seed = 0; seed < 12; seed += 1) {
      const state = createNewGame();
      state.campaignId = `density-${seed}`;
      state.day = seed + 1;
      beginExpedition(state);
      const run = state.run!;
      // 地下1〜3階は素材の稼ぎ場。床の品を厚く置く。
      expect(run.items.length).toBeGreaterThanOrEqual(5);
      expect(run.items.length).toBeLessThanOrEqual(8);
      // 床に落ちているのは素材だけ。珍しいものは宝箱にしか入っていない。
      for (const entry of run.items) {
        expect(MERCHANT_ITEM_DEFINITIONS[entry.item.definitionId]!.category).toBe("material");
      }
      expect(run.chests).toHaveLength(1);
    }
  });

  it("leaves only a handful of finds below the shallow band", () => {
    const state = createNewGame();
    beginExpedition(state);
    for (let step = 0; step < SHALLOW_GROUND_FLOORS; step += 1) descend(state);
    const deep = state.run!;
    expect(deep.floor).toBe(SHALLOW_GROUND_FLOORS + 1);
    // 拾い集めて鞄を満たせるほどの数は落ちていない。深層の実りは宝箱にある。
    expect(deep.items.length).toBeGreaterThanOrEqual(1);
    expect(deep.items.length).toBeLessThanOrEqual(3);
    expect(deep.chests).toHaveLength(1);
  });

  it("bundles materials into one slot and starts a new bundle when the first is full", () => {
    const state = createNewGame();
    beginExpedition(state);
    const run = state.run!;
    state.inventory = [];
    const limit = MATERIAL_STACK_SIZE;

    // 同じ素材を一束ぶん拾う。枠は1つしか使わない。
    for (let picked = 0; picked < limit; picked += 1) {
      run.items.push({ item: createItem(state, "moon-fungus", 1), pos: { ...run.player } });
      expect(tryPickup(state).consumedTurn).toBe(true);
      expect(state.inventory).toHaveLength(1);
      expect(itemCount(state.inventory[0]!)).toBe(picked + 1);
    }

    // 一束を超えた分は新しい束になる。ここで初めて枠がもう1つ要る。
    run.items.push({ item: createItem(state, "moon-fungus", 1), pos: { ...run.player } });
    expect(tryPickup(state).consumedTurn).toBe(true);
    expect(state.inventory).toHaveLength(2);
    expect(state.inventory.map(itemCount)).toEqual([limit, 1]);

    // 束へ合流した実体は世界から落とす。セーブに死んだIDを残さない。
    const merged = createItem(state, "moon-fungus", 1);
    run.items.push({ item: merged, pos: { ...run.player } });
    tryPickup(state);
    expect(state.itemsById[merged.uuid]).toBeUndefined();
    expect(state.inventory.map(itemCount)).toEqual([limit, 2]);

    // 名前も値も、数まで含めて動く。
    expect(itemName(state.inventory[0]!)).toContain(`×${limit}`);
    expect(marketPrice(state.inventory[0]!)).toBe(marketPrice(state.inventory[1]!) / 2 * limit);
  });

  it("keeps a multi-charge flask in the bag until its last draught", () => {
    const state = createNewGame();
    beginExpedition(state);
    state.inventory = [];
    const flask = createItem(state, "field-flask", 6);
    state.inventory.push(flask);
    const total = MERCHANT_ITEM_DEFINITIONS["field-flask"]!.charges!;
    const full = marketPrice(flask);
    state.hp = 1;

    // 一度使っても鞄に残る。深層の薬が強いのは量ではなく回数である。
    expect(performDungeonCommand(state, { type: "useMedicine", itemId: flask.uuid, target: "player" }).consumedTurn).toBe(true);
    expect(state.inventory).toContain(flask);
    expect(itemName(flask)).toContain(`残${total - 1}`);
    // 使いかけはそのぶん安い。使うか売るかが、その場の判断になる。
    expect(marketPrice(flask)).toBeLessThan(full);

    for (let draught = 1; draught < total; draught += 1) {
      state.hp = 1;
      performDungeonCommand(state, { type: "useMedicine", itemId: flask.uuid, target: "player" });
    }
    expect(state.inventory).not.toContain(flask);
    expect(flask.location?.kind).toBe("consumed");
  });

  it("never bundles a weapon, because a story lives on the individual piece", () => {
    const state = createNewGame();
    beginExpedition(state);
    const run = state.run!;
    state.inventory = [];
    for (let picked = 0; picked < 2; picked += 1) {
      run.items.push({ item: createItem(state, "iron-sword", 3), pos: { ...run.player } });
      expect(tryPickup(state).consumedTurn).toBe(true);
    }
    expect(state.inventory).toHaveLength(2);
    expect(state.inventory.every((item) => itemCount(item) === 1)).toBe(true);
  });

  it("holds exactly what the starting cloth wrap holds, regardless of item type", () => {
    const state = createNewGame();
    beginExpedition(state);
    const run = state.run!;
    // 風呂敷は12枠。食料10個で1枠、品物は1点で1枠。
    state.provisions = 10;
    state.inventory = Array.from({ length: 10 }, () => createItem(state, "bronze-spear", 1));
    const ground = run.items[0]!;
    run.player = { ...ground.pos };

    const result = tryPickup(state);

    expect(result.consumedTurn).toBe(true);
    expect(state.inventory).toHaveLength(11);
    expect(currentItemCount(state)).toBe(12);
    expect(state.inventory).toContain(ground.item);
  });

  it("swaps one carried item for a ground item when all twenty-four slots are full", () => {
    const state = createNewGame();
    beginExpedition(state);
    const run = state.run!;
    state.smokeBombs = 0;
    state.returnStones = 0;
    state.provisions = 0;
    state.inventory = Array.from({ length: 24 }, () => createItem(state, "bronze-spear", 1));
    const ground = run.items[0]!;
    run.player = { ...ground.pos };
    const swap = state.inventory[0]!;

    const result = tryPickup(state, swap.uuid);

    expect(result.consumedTurn).toBe(true);
    expect(state.inventory.some((item) => item.uuid === ground.item.uuid)).toBe(true);
    expect(state.inventory).not.toContain(swap);
    expect(run.items.some((entry) => entry.item.uuid === swap.uuid && entry.pos.x === run.player.x && entry.pos.y === run.player.y)).toBe(true);
  });




});

describe("save migration", () => {
  it("migrates a version 1 run and drops the retired campaign fields", () => {
    const current = createNewGame();
    beginExpedition(current);
    const run = current.run!;
    const legacy = {
      ...current,
      version: 1 as const,
      guildReputation: 3,
      guards: [{ id: "rolf", unlocked: true, relation: 0, experience: 0, level: 1 }],
      story: { blackSword: "locked" as const },
      quests: [{ id: "herb", status: "complete" as const }],
      refusedOffers: { mina: 2 },
      run: {
        ...run,
        traps: [{ x: 2, y: 2 }],
        enemies: run.enemies.map(({ staggerTurns: _staggerTurns, ...enemy }) => enemy),
        chests: run.chests.map((chest) => chest.pos),
        bodies: run.bodies.map((body) => body.pos),
        guard: undefined,
        shoveCooldown: undefined,
        highestFloor: undefined,
      },
    };

    const migrated = migrateSaveState(legacy as never);
    const carried = migrated as unknown as Record<string, unknown>;

    expect(migrated.version).toBe(14);
    for (const key of ["quests", "customers", "guards", "story", "refusedOffers", "guildReputation"]) {
      expect(carried[key]).toBeUndefined();
    }
    expect((migrated.run as unknown as Record<string, unknown>).traps).toBeUndefined();
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
