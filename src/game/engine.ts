import { canTraverse, isWalkableCell, samePosition } from "./dungeonRules";
import { Rng } from "./rng";
import { HOME_SPAWN, createHomeMap } from "./homeMap";
import { compileMap, loadTrialMapPack } from "./mapDocument";
import { createDefaultMapPack } from "./defaultMapPack";
import { actorDefinition } from "./actorCatalog";
import { MERCHANT_ITEM_DEFINITIONS } from "./merchantContent";
import { createGeneratedAdventurer, createGeneratedDeadAdventurer, initializeMerchantWorld, pruneCampaignRecords, registerWorldItem } from "./merchantEconomy";
import { consumeDungeonTime, inventoryItemCount, playerAttackPower, playerDefensePower, resetDailySystems, unequipIfNeeded } from "./merchantSystems";
import type {
  ActiveGuard,
  DungeonBody,
  DungeonAdventurer,
  DungeonCommand,
  DungeonEvent,
  DungeonMap,
  DungeonRun,
  Enemy,
  GameState,
  GroundItem,
  ItemDefinition,
  ItemInstance,
  TurnResult,
  Vec,
} from "./types";

export const DUNGEON_WIDTH = 48;
export const DUNGEON_HEIGHT = 36;
export const INVENTORY_CAPACITY = 24;
export const DISPLAY_CAPACITY = 8;
const FLOOR = 0;
const WALL = 1;

export type DungeonGenerationMode = "fixed" | "procedural" | "manual";

/** The authored fixed map is the stable normal route.  Procedural remains an
 * explicit development comparison and manual is reserved for editor trials. */
export function dungeonGenerationMode(): DungeonGenerationMode {
  if (typeof window === "undefined") return "fixed";
  const mode = new URLSearchParams(window.location.search).get("dungeon");
  if (mode === "manual" || mode === "procedural") return mode;
  return new URLSearchParams(window.location.search).get("autostart") === "world" && loadTrialMapPack() ? "manual" : "fixed";
}

export function createDungeonMap(mode: DungeonGenerationMode, seed: number, floor: number): DungeonMap {
  if (mode === "manual") {
    const trial = typeof window !== "undefined" ? loadTrialMapPack()?.dungeons.find((map) => map.floor === floor) : undefined;
    if (trial) return compileMap(trial);
  }
  if (mode === "fixed") {
    const authored = createDefaultMapPack().dungeons.find((map) => map.floor === floor);
    if (authored) return compileMap(authored);
  }
  return generateDungeon(seed, floor);
}

const clone = <T>(value: T): T => structuredClone(value);
const emptyResult = (): TurnResult => ({ consumedTurn: false, events: [] });

export const DIRECTION: Record<"up" | "down" | "left" | "right", Vec> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function createNewGame(): GameState {
  const state: GameState = {
    version: 8,
    campaignId: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `campaign-${Date.now()}`,
    status: "active",
    day: 1,
    timeSlot: "morning",
    gold: 300,
    hp: 12,
    maxHp: 12,
    returnStones: 1,
    smokeBombs: 1,
    provisions: 3,
    equipment: {},
    shopSession: { day: 1, status: "closed", queueNpcIds: [], servedNpcIds: [] },
    dailySupplyStock: { day: 1, smokeBombs: 2, returnStones: 1, provisions: 6 },
    location: "home",
    homePos: { x: HOME_SPAWN.x * 16 + 8, y: HOME_SPAWN.y * 16 + 8 },
    expeditionSerial: 0,
    inventory: [],
    store: [],
    archive: [],
    display: [],
    events: [],
    message: "商品を探しにダンジョンへ向かおう。護衛は探索準備から募集できる。",
    nextItemId: 1,
    nextNpcId: 1,
    itemsById: {},
    npcs: [],
    visitorNpcIds: [],
    singularItemIds: [],
  };
  initializeMerchantWorld(state);
  resetDailySystems(state);
  for (const npc of state.npcs.filter((entry) => entry.adventurer)) {
    const definitionId = npc.profession === "scout" ? "antidote" : npc.profession === "mercenary" ? "bronze-spear" : "iron-sword";
    const gear = createItem(state, definitionId);
    gear.owner = npc.id;
    gear.location = { kind: "npcInventory", npcId: npc.id };
    npc.inventoryIds.push(gear.uuid);
  }
  return state;
}

export function itemDefinition(item: ItemInstance): ItemDefinition {
  const definition = MERCHANT_ITEM_DEFINITIONS[item.definitionId];
  if (!definition) throw new Error(`未定義アイテム: ${item.definitionId}`);
  return definition;
}

export function itemName(item: ItemInstance): string {
  if (item.currentName) return item.currentName;
  if (item.singular && !item.namedByNpcId) return "？？？の剣";
  const definition = itemDefinition(item);
  if (item.knowledge === "identified") return definition.trueName;
  if (item.knowledge === "suspected") return definition.suspectedName;
  return definition.unknownName;
}

export function currentItemCount(state: GameState): number {
  return inventoryItemCount(state);
}

export function createItem(state: GameState, definitionId: string, floor?: number): ItemInstance {
  const definition = MERCHANT_ITEM_DEFINITIONS[definitionId];
  if (!definition) throw new Error(`未定義アイテム: ${definitionId}`);
  if (definition.singular && state.singularItemIds.includes(definitionId)) throw new Error(`一点ものは既に生成済み: ${definitionId}`);
  const instance: ItemInstance = {
    uuid: `item-${state.nextItemId++}`,
    definitionId,
    discoveredDay: state.day,
    discoveredFloor: floor,
    knowledge: "unknown",
    clues: [],
    owner: "player",
    history: [{ day: state.day, type: "found", detail: floor ? `地下${floor}階で発見` : "家で入手" }],
    visualId: definition.visualId,
    rarity: definition.rarity,
    location: floor ? { kind: "dungeonGround", floor, pos: { x: 0, y: 0 } } : { kind: "playerBag" },
    singular: definition.singular,
    historyV2: [{ day: state.day, type: "created", detail: floor ? `地下${floor}階で生成` : "家で生成" }],
  };
  if (definition.singular) state.singularItemIds.push(definitionId);
  return registerWorldItem(state, instance);
}

function carveRoom(tiles: number[][], x: number, y: number, width: number, height: number): Vec {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) tiles[yy]![xx] = FLOOR;
  }
  return { x: Math.floor(x + width / 2), y: Math.floor(y + height / 2) };
}

function carveCorridor(tiles: number[][], from: Vec, to: Vec): void {
  let x = from.x;
  let y = from.y;
  while (x !== to.x) {
    tiles[y]![x] = FLOOR;
    x += Math.sign(to.x - x);
  }
  while (y !== to.y) {
    tiles[y]![x] = FLOOR;
    y += Math.sign(to.y - y);
  }
  tiles[y]![x] = FLOOR;
}

type Room = { x: number; y: number; width: number; height: number; center: Vec };
type Region = { x: number; y: number; width: number; height: number };

function createRooms(tiles: number[][], rng: Rng): Room[] {
  const target = rng.int(12, 16);
  const regions: Region[] = [{ x: 1, y: 1, width: DUNGEON_WIDTH - 2, height: DUNGEON_HEIGHT - 2 }];
  while (regions.length < target) {
    const candidates = regions
      .map((region, index) => ({ region, index }))
      .filter(({ region }) => region.width >= 14 || region.height >= 14)
      .sort((a, b) => b.region.width * b.region.height - a.region.width * a.region.height);
    const selected = candidates[0];
    if (!selected) break;
    const { region, index } = selected;
    const vertical = region.width >= 14 && (region.height < 14 || region.width / region.height > 1.2 || rng.next() < 0.5);
    const first: Region = { ...region };
    const second: Region = { ...region };
    if (vertical) {
      const cut = rng.int(7, region.width - 7);
      first.width = cut;
      second.x += cut;
      second.width -= cut;
    } else {
      const cut = rng.int(7, region.height - 7);
      first.height = cut;
      second.y += cut;
      second.height -= cut;
    }
    regions.splice(index, 1, first, second);
  }
  return regions.map((region) => {
    const width = rng.int(4, Math.min(9, region.width - 2));
    const height = rng.int(4, Math.min(7, region.height - 2));
    const x = rng.int(region.x + 1, region.x + region.width - width - 1);
    const y = rng.int(region.y + 1, region.y + region.height - height - 1);
    return { x, y, width, height, center: carveRoom(tiles, x, y, width, height) };
  });
}

function connectRooms(tiles: number[][], rooms: Room[], rng: Rng): void {
  if (rooms.length < 2) return;
  const connected = [rooms[0]!];
  const remaining = rooms.slice(1);
  while (remaining.length > 0) {
    let bestConnected = 0;
    let bestRemaining = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    connected.forEach((source, sourceIndex) => remaining.forEach((target, targetIndex) => {
      const candidate = Math.abs(source.center.x - target.center.x) + Math.abs(source.center.y - target.center.y);
      if (candidate < bestDistance) {
        bestDistance = candidate;
        bestConnected = sourceIndex;
        bestRemaining = targetIndex;
      }
    }));
    const targetRoom = remaining.splice(bestRemaining, 1)[0]!;
    const sourceRoom = connected[bestConnected]!;
    if (rng.next() < 0.5) carveCorridor(tiles, sourceRoom.center, targetRoom.center);
    else carveCorridor(tiles, targetRoom.center, sourceRoom.center);
    connected.push(targetRoom);
  }
  for (let index = 0; index < rng.int(2, 4); index += 1) {
    const source = rng.pick(rooms);
    carveCorridor(tiles, source.center, rng.pick(rooms.filter((room) => room !== source)).center);
  }
}

function freeFloor(map: DungeonMap, rng: Rng, occupied: Vec[]): Vec {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const candidate = { x: rng.int(1, map.width - 2), y: rng.int(1, map.height - 2) };
    if (isWalkableCell(map, candidate) && !occupied.some((pos) => samePosition(pos, candidate))) return candidate;
  }
  const fallback = map.tiles.flatMap((row, y) => row.map((tile, x) => ({ tile, pos: { x, y } })))
    .find(({ pos }) => isWalkableCell(map, pos) && !occupied.some((entry) => samePosition(entry, pos)));
  return fallback ? fallback.pos : { ...map.stairsUp };
}

export function generateDungeon(seed: number, floor: number): DungeonMap {
  const rng = new Rng(seed + floor * 7919);
  const tiles = Array.from({ length: DUNGEON_HEIGHT }, () => Array.from({ length: DUNGEON_WIDTH }, () => WALL));
  const rooms = createRooms(tiles, rng);
  connectRooms(tiles, rooms, rng);
  const entranceRoom = rooms[0];
  if (!entranceRoom) throw new Error("ダンジョンの部屋を生成できませんでした。");
  const entrance = { ...entranceRoom.center };
  const byDistance = [...rooms].sort((a, b) => distance(b.center, entrance) - distance(a.center, entrance));
  const stairs = { ...(byDistance[0]?.center ?? entrance) };
  return {
    width: DUNGEON_WIDTH,
    height: DUNGEON_HEIGHT,
    tiles,
    formatVersion: 2,
    heights: Array.from({ length: DUNGEON_HEIGHT }, () => Array<0 | 1 | 2>(DUNGEON_WIDTH).fill(0)),
    hardEdges: [],
    ledgeEdges: [],
    traversalLinks: [],
    stairsUp: entrance,
    stairsDown: stairs,
    enemyRoster: [...defaultEnemyRoster(floor)],
  };
}

function distance(a: Vec, b: Vec): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}




function randomItemId(state: GameState, rng: Rng, floor: number): string {
  const definitions = Object.values(MERCHANT_ITEM_DEFINITIONS).filter((definition) => {
    if (definition.singular && state.singularItemIds.includes(definition.id)) return false;
    if (definition.rarity === "legendary" && floor < 6) return false;
    return true;
  });
  const weighted = definitions.flatMap((definition) => {
    const rarityWeight = definition.rarity === "common" ? Math.max(2, 9 - floor)
      : definition.rarity === "uncommon" ? 5
        : definition.rarity === "rare" ? Math.max(1, floor - 1)
          : floor >= 6 ? 1 : 0;
    return Array<string>(rarityWeight).fill(definition.id);
  });
  return rng.pick(weighted);
}

/**
 * 手描きの階が用意されるまで、手続き生成の階も同じ craftpix の敵を使う。
 * 深いほど種類が入れ替わり、1階と2階で敵の系統が変わらない。
 */
export function defaultEnemyRoster(floor: number): readonly string[] {
  if (floor >= 7) return ["plant3", "vampire2", "vampire3", "orc3"];
  if (floor >= 5) return ["orc3", "plant2", "vampire1"];
  if (floor >= 3) return ["slime2", "orc2", "plant1"];
  return ["slime1", "orc1"];
}

function buildEnemies(rng: Rng, map: DungeonMap, floor: number, occupied: Vec[]): Enemy[] {
  const roster = Array.isArray(map.enemyRoster) && map.enemyRoster.length ? map.enemyRoster : defaultEnemyRoster(floor);
  const authored = roster.map((actorId) => ({ actorId, actor: actorDefinition(actorId) })).filter((entry) => entry.actor?.enemyStats);
  if (!authored.length) return [];
  return Array.from({ length: 6 + Math.min(floor, 6) }, (_, index) => {
    const selected = rng.pick(authored);
    const stats = selected.actor!.enemyStats!;
    const pos = freeFloor(map, rng, occupied);
    occupied.push(pos);
    return {
      id: `${selected.actorId}-${floor}-${index}`,
      actorId: selected.actorId,
      name: selected.actor!.label,
      hp: stats.baseHp + floor * stats.hpPerFloor,
      maxHp: stats.baseHp + floor * stats.hpPerFloor,
      damage: stats.damage,
      state: "patrol" as const,
      staggerTurns: 0,
      pos,
    };
  });
}

/** Deterministic entry point used by the map-editor trial and regression tests. */
export function buildInitialEnemies(map: DungeonMap, floor: number, seed = 1): Enemy[] {
  const occupied: Vec[] = [map.stairsUp, ...(map.stairsDown ? [map.stairsDown] : [])];
  return buildEnemies(new Rng(seed + floor * 997), map, floor, occupied);
}


function activeGuardName(state: GameState, guardId: string): string {
  return state.npcs.find((entry) => entry.id === guardId)?.name ?? "護衛";
}

function initialGuard(state: GameState, map: DungeonMap): ActiveGuard | undefined {
  if (!state.hiredGuardId) return undefined;
  const npc = state.npcs.find((entry) => entry.id === state.hiredGuardId && entry.adventurer && entry.status !== "dead");
  if (!npc) return undefined;
  const maxHp = npc.maxHp ?? 6;
  return { guardId: npc.id, pos: { ...map.stairsUp }, hp: maxHp, maxHp, damage: npc.damage ?? 1, mode: "covering", safeTurns: 0 };
}


function buildRun(state: GameState, floor: number, seed: number, carriedGuard?: ActiveGuard | null, highestFloor = floor, floorStates: NonNullable<DungeonRun["floorStates"]> = {}): DungeonRun {
  const map = createDungeonMap(dungeonGenerationMode(), seed, floor);
  const rng = new Rng(seed + floor * 997);
  const occupied: Vec[] = [map.stairsUp, ...(map.stairsDown ? [map.stairsDown] : [])];
  const items: GroundItem[] = [];

  for (let index = items.length; index < 7; index += 1) {
    const pos = freeFloor(map, rng, occupied);
    occupied.push(pos);
    const generated = createItem(state, randomItemId(state, rng, floor), floor);
    generated.location = { kind: "dungeonGround", floor, pos: { ...pos } };
    items.push({ item: generated, pos });
  }

  const guard = carriedGuard === null
    ? undefined
    : carriedGuard
      ? { ...carriedGuard, pos: { ...map.stairsUp } }
      : initialGuard(state, map);

  const enemies = buildEnemies(rng, map, floor, occupied);
  const occupiedEntities = [...occupied, ...enemies.map((enemy) => enemy.pos)];
  const chests = Array.from({ length: 2 }, (_, index) => {
    const pos = freeFloor(map, rng, occupiedEntities);
    occupiedEntities.push(pos);
    return { id: `chest-${floor}-${index}`, pos, item: createItem(state, randomItemId(state, rng, floor), floor) };
  });
  const bodies: DungeonBody[] = [];
  const adventurers: DungeonAdventurer[] = [];
  const corpseChance = Math.min(0.6, 0.25 + (floor - 1) * 0.05);
  if (rng.next() < corpseChance) {
    const deadNpc = createGeneratedDeadAdventurer(state, floor);
    const pos = freeFloor(map, rng, occupiedEntities);
    occupiedEntities.push(pos);
    const loot = Array.from({ length: rng.int(1, 3) }, () => createItem(state, randomItemId(state, rng, floor), floor));
    for (const found of loot) {
      found.owner = deadNpc.id;
      found.location = { kind: "corpse", npcId: deadNpc.id, floor };
      found.historyV2 ??= [];
      found.historyV2.push({ day: state.day, type: "ownerDied", npcId: deadNpc.id, detail: `${deadNpc.name}が地下${floor}階で死亡` });
      deadNpc.inventoryIds.push(found.uuid);
    }
    bodies.push({ id: `body-${deadNpc.id}`, npcId: deadNpc.id, name: `冒険者${deadNpc.name}`, pos, loot, inspected: false });
  }

  // Every floor has another party with its own survival and trading loop.
  // Generated NPC records make their name, inventory and eventual death part
  // of the persistent merchant world rather than a disposable visual effect.
  for (let index = 0; index < 2; index += 1) {
    const roamingNpc = createGeneratedAdventurer(state, floor);
    const roamingPos = freeFloor(map, rng, occupiedEntities);
    occupiedEntities.push(roamingPos);
    const stockIds = index === 0
      ? ["minor-healing-potion", randomItemId(state, rng, floor)]
      : [randomItemId(state, rng, floor)];
    for (const definitionId of stockIds) {
      const stock = createItem(state, definitionId, floor);
      stock.owner = roamingNpc.id;
      stock.location = { kind: "npcInventory", npcId: roamingNpc.id };
      roamingNpc.inventoryIds.push(stock.uuid);
    }
    adventurers.push({
      npcId: roamingNpc.id,
      pos: roamingPos,
      hp: roamingNpc.maxHp ?? 6,
      maxHp: roamingNpc.maxHp ?? 6,
      damage: roamingNpc.damage ?? 1,
      gold: Math.max(200, Math.floor(roamingNpc.budget * 0.6)),
    });
  }

  return {
    seed,
    floor,
    map,
    player: { ...map.stairsUp },
    enemies,
    items,
    chests,
    bodies,
    adventurers,
    guard,
    shoveCooldown: 0,
    highestFloor: Math.max(highestFloor, floor),
    turn: 0,
    timeUnits: 0,
    settledTimeBands: 0,
    floorStates,
  };
}

export function beginExpedition(state: GameState): void {
  if (state.location !== "home" || state.timeSlot === "night" || state.shopSession.status === "movingToCounter" || state.shopSession.status === "waiting" || state.shopSession.status === "serving") {
    state.message = state.timeSlot === "night" ? "夜はダンジョンへ出発できない。休んで朝を待とう。" : "今はダンジョンへ出発できない。";
    return;
  }
  state.expeditionSerial += 1;
  const params = typeof window === "undefined" ? undefined : new URLSearchParams(window.location.search);
  const querySeed = Number.parseInt(params?.get("dungeonSeed") ?? "", 10);
  const queryFloor = Number.parseInt(params?.get("dungeonFloor") ?? "", 10);
  const seed = Number.isFinite(querySeed) && querySeed > 0
    ? querySeed
    : Math.imul(state.day, 104729) ^ Math.imul(state.expeditionSerial, 0x9e3779b1);
  const floor = Number.isFinite(queryFloor) ? Math.min(8, Math.max(1, queryFloor)) : 1;
  state.location = "dungeon";
  state.run = buildRun(state, floor, seed, undefined, floor);
  if (state.escortCommission?.status === "accepted" && state.escortCommission.npcId) {
    state.escortCommission.status = "active";
    const npc = state.npcs.find((entry) => entry.id === state.escortCommission?.npcId);
    if (npc) npc.status = "dungeon";
  }
  state.message = state.run.guard
    ? `${activeGuardName(state, state.run.guard.guardId)}とダンジョンへ入った。護衛は同じ隊列で敵を自動的にカバーする。`
    : "ダンジョンへ入った。Spaceで正面の敵を攻撃し、Qで押し返せる。";
}

function snapshotFloor(run: DungeonRun): import("./types").DungeonFloorSnapshot {
  return {
    floor: run.floor,
    map: clone(run.map),
    player: clone(run.player),
    enemies: clone(run.enemies),
    items: clone(run.items),
    chests: clone(run.chests),
    bodies: clone(run.bodies),
    adventurers: clone(run.adventurers),
    guard: run.guard ? clone(run.guard) : undefined,
    shoveCooldown: run.shoveCooldown,
    turn: run.turn,
  };
}

function restoreFloor(snapshot: import("./types").DungeonFloorSnapshot, seed: number, floorStates: NonNullable<DungeonRun["floorStates"]>, highestFloor: number, player: Vec, carriedGuard: ActiveGuard | undefined, timeUnits: number, settledTimeBands: number): DungeonRun {
  const restored = clone(snapshot);
  return {
    ...restored, seed,
    player: { ...player },
    guard: carriedGuard ? { ...clone(carriedGuard), pos: { ...player } } : undefined,
    highestFloor,
    timeUnits,
    settledTimeBands,
    floorStates,
  };
}

function manualFloorExists(floor: number): boolean {
  return typeof window !== "undefined" && Boolean(loadTrialMapPack()?.dungeons.some((map) => map.floor === floor));
}

export function descend(state: GameState): void {
  const run = state.run;
  if (!run) return;
  if (!run.map.stairsDown) {
    state.message = "この階に下り階段はない。";
    return;
  }
  if (run.floor >= 8 && dungeonGenerationMode() !== "manual") {
    state.message = "この探索で到達できる最深部だ。帰還石か階段で戻ろう。";
    return;
  }
  const nextFloor = run.floor + 1;
  if (dungeonGenerationMode() === "manual" && !manualFloorExists(nextFloor)) {
    state.message = "この探索パックには次の階がない。";
    return;
  }
  const floorStates = { ...(run.floorStates ?? {}), [String(run.floor)]: snapshotFloor(run) };
  const highestFloor = Math.max(run.highestFloor, nextFloor);
  const previous = floorStates[String(nextFloor)];
  state.run = previous
    ? restoreFloor(previous, run.seed, floorStates, highestFloor, previous.map.stairsUp, run.guard, run.timeUnits, run.settledTimeBands)
    : buildRun(state, nextFloor, run.seed, run.guard ?? null, highestFloor, floorStates);
  state.run.timeUnits = run.timeUnits;
  state.run.settledTimeBands = run.settledTimeBands;
  state.message = `地下${nextFloor}階へ降りた。`;
}

export function ascend(state: GameState): void {
  const run = state.run;
  if (!run) return;
  if (run.floor === 1) {
    returnHome(state, "dungeonEntrance");
    return;
  }
  const nextFloor = run.floor - 1;
  const floorStates = { ...(run.floorStates ?? {}), [String(run.floor)]: snapshotFloor(run) };
  const previous = floorStates[String(nextFloor)];
  if (previous) {
    const landing = previous.map.stairsDown ?? previous.map.stairsUp;
    state.run = restoreFloor(previous, run.seed, floorStates, run.highestFloor, landing, run.guard, run.timeUnits, run.settledTimeBands);
  } else {
    const map = createDungeonMap(dungeonGenerationMode(), run.seed, nextFloor);
    state.run = buildRun(state, nextFloor, run.seed, run.guard ?? null, run.highestFloor, floorStates);
    state.run.player = { ...(map.stairsDown ?? map.stairsUp) };
    if (state.run.guard) state.run.guard.pos = { ...state.run.player };
    state.run.timeUnits = run.timeUnits;
    state.run.settledTimeBands = run.settledTimeBands;
  }
  state.message = `地下${nextFloor}階へ上がった。`;
}

function guardPhase(state: GameState, events: DungeonEvent[]): void {
  const run = state.run;
  const guard = run?.guard;
  if (!run || !guard) return;
  guard.pos = { ...run.player };
  if (guard.mode === "retreated") return;
  const adjacent = run.enemies
    .filter((enemy) => distance(enemy.pos, run.player) === 1)
    .sort((a, b) => {
      const aKillable = Number(a.hp <= guard.damage);
      const bKillable = Number(b.hp <= guard.damage);
      return bKillable - aKillable || b.damage - a.damage || a.hp - b.hp || a.id.localeCompare(b.id);
    });
  const target = adjacent[0];
  if (target) {
    target.hp -= guard.damage;
    events.push({ type: "attack", attackerId: guard.guardId, targetId: target.id, damage: guard.damage });
    state.message = `${activeGuardName(state, guard.guardId)}が${target.name}へ${guard.damage}ダメージ。`;
    if (target.hp <= 0) {
      run.enemies = run.enemies.filter((enemy) => enemy.id !== target.id);
      events.push({ type: "defeated", actorId: target.id, pos: { ...target.pos } });
      state.message = `${activeGuardName(state, guard.guardId)}が${target.name}を退けた。`;
    }
  }
}

function adventurerName(state: GameState, npcId: string): string {
  return state.npcs.find((npc) => npc.id === npcId)?.name ?? "名もなき冒険者";
}

function consumeNpcMedicine(state: GameState, adventurer: DungeonAdventurer): boolean {
  if (adventurer.hp > Math.ceil(adventurer.maxHp / 2)) return false;
  const npc = state.npcs.find((entry) => entry.id === adventurer.npcId);
  const medicine = npc?.inventoryIds
    .map((id) => state.itemsById[id])
    .find((item) => item && (itemDefinition(item).healing ?? 0) > 0);
  if (!npc || !medicine) return false;
  const healing = itemDefinition(medicine).healing ?? 0;
  adventurer.hp = Math.min(adventurer.maxHp, adventurer.hp + healing);
  npc.inventoryIds = npc.inventoryIds.filter((id) => id !== medicine.uuid);
  medicine.location = { kind: "consumed", actorId: adventurer.npcId };
  state.message = `${npc.name}は${itemName(medicine)}を使い、HPを${healing}回復した。`;
  return true;
}

function moveToward(from: Vec, target: Vec, run: DungeonRun, blocked: Vec[], rng: Rng): Vec {
  const horizontal = { x: Math.sign(target.x - from.x), y: 0 };
  const vertical = { x: 0, y: Math.sign(target.y - from.y) };
  const preferred = rng.next() > 0.5 ? [horizontal, vertical] : [vertical, horizontal];
  for (const direction of preferred) {
    if (direction.x === 0 && direction.y === 0) continue;
    const next = { x: from.x + direction.x, y: from.y + direction.y };
    if (canTraverse(run.map, from, next) && !blocked.some((pos) => samePosition(pos, next))) return next;
  }
  return from;
}

function adventurerPhase(state: GameState, events: DungeonEvent[]): void {
  const run = state.run;
  if (!run) return;
  const rng = new Rng(run.seed + run.turn * 53 + run.floor * 11);
  for (const adventurer of [...run.adventurers]) {
    if (consumeNpcMedicine(state, adventurer)) continue;
    const target = [...run.enemies]
      .sort((a, b) => distance(a.pos, adventurer.pos) - distance(b.pos, adventurer.pos) || a.hp - b.hp)[0];
    if (!target) continue;
    if (distance(target.pos, adventurer.pos) === 1) {
      target.hp -= adventurer.damage;
      events.push({ type: "attack", attackerId: adventurer.npcId, targetId: target.id, damage: adventurer.damage });
      state.message = `${adventurerName(state, adventurer.npcId)}が${target.name}へ${adventurer.damage}ダメージ。`;
      if (target.hp <= 0) {
        run.enemies = run.enemies.filter((enemy) => enemy.id !== target.id);
        events.push({ type: "defeated", actorId: target.id, pos: { ...target.pos } });
        state.message = `${adventurerName(state, adventurer.npcId)}が${target.name}を倒した。`;
      }
      continue;
    }
    const from = { ...adventurer.pos };
    const blocked = [run.player, ...run.enemies.map((enemy) => enemy.pos), ...run.adventurers.filter((other) => other.npcId !== adventurer.npcId).map((other) => other.pos)];
    adventurer.pos = moveToward(adventurer.pos, target.pos, run, blocked, rng);
    if (!samePosition(from, adventurer.pos)) events.push({ type: "move", actorId: adventurer.npcId, from, to: { ...adventurer.pos } });
  }
}

function moveEnemy(enemy: Enemy, run: DungeonRun, rng: Rng, target: Vec = run.player): void {
  const dist = distance(enemy.pos, target);
  if (dist <= 6) {
    enemy.state = "chase";
    enemy.target = { ...target };
  } else if (enemy.state === "chase") {
    enemy.state = "search";
  }
  let directions: Vec[];
  if (enemy.state === "chase" && enemy.target) {
    const horizontal = { x: Math.sign(enemy.target.x - enemy.pos.x), y: 0 };
    const vertical = { x: 0, y: Math.sign(enemy.target.y - enemy.pos.y) };
    directions = rng.next() > 0.5 ? [horizontal, vertical] : [vertical, horizontal];
  } else {
    directions = [...Object.values(DIRECTION)].sort(() => rng.next() - 0.5);
  }
  for (const direction of directions) {
    if (direction.x === 0 && direction.y === 0) continue;
    const next = { x: enemy.pos.x + direction.x, y: enemy.pos.y + direction.y };
    const collision = run.enemies.some((other) => other.id !== enemy.id && samePosition(other.pos, next))
      || run.adventurers.some((adventurer) => samePosition(adventurer.pos, next));
    if (canTraverse(run.map, enemy.pos, next)
      && !collision
      && !samePosition(next, run.player)) {
      enemy.pos = next;
      break;
    }
  }
}

function enemyPhase(state: GameState, events: DungeonEvent[]): void {
  const run = state.run;
  if (!run) return;
  const rng = new Rng(run.seed + run.turn * 37 + run.floor);
  for (const enemy of [...run.enemies]) {
    if (!state.run) break;
    if (enemy.staggerTurns > 0) {
      enemy.staggerTurns -= 1;
      state.message = `${enemy.name}は体勢を崩している。`;
      continue;
    }
    const guard = run.guard;
    if (guard?.mode === "covering" && distance(enemy.pos, run.player) === 1) {
      guard.hp -= enemy.damage;
      events.push({ type: "attack", attackerId: enemy.id, targetId: guard.guardId, damage: enemy.damage });
      state.message = `${enemy.name}が${activeGuardName(state, guard.guardId)}へ${enemy.damage}ダメージ。`;
      if (guard.hp <= 0) {
        const npc = state.npcs.find((entry) => entry.id === guard.guardId);
        if (npc) {
          npc.status = "dead";
          const loot = npc.inventoryIds.map((id) => state.itemsById[id]).filter((item): item is ItemInstance => Boolean(item));
          for (const item of loot) {
            item.location = { kind: "corpse", npcId: npc.id, floor: run.floor };
            item.historyV2 ??= [];
            item.historyV2.push({ day: state.day, type: "ownerDied", npcId: npc.id, detail: `${npc.name}が地下${run.floor}階で死亡` });
          }
          run.bodies.push({ id: `body-${npc.id}`, npcId: npc.id, name: `冒険者${npc.name}`, pos: { ...guard.pos }, loot, inspected: false });
        }
        events.push({ type: "defeated", actorId: guard.guardId, pos: { ...guard.pos } });
        state.message = npc ? `${npc.name}は死亡し、その場に所持品を残した。` : `${activeGuardName(state, guard.guardId)}は倒れた。`;
        run.guard = undefined;
      } else if (guard.hp <= guardRetreatThreshold(state, guard)) {
        guard.mode = "retreated";
        guard.safeTurns = 0;
        events.push({ type: "guardMode", guardId: guard.guardId, mode: "retreated" });
        state.message = `${activeGuardName(state, guard.guardId)}は危険を感じ、隊列の後方へ下がった。`;
      }
      continue;
    }
    const adjacentAdventurer = run.adventurers.find((adventurer) => distance(enemy.pos, adventurer.pos) === 1);
    if (adjacentAdventurer) {
      adjacentAdventurer.hp -= enemy.damage;
      events.push({ type: "attack", attackerId: enemy.id, targetId: adjacentAdventurer.npcId, damage: enemy.damage });
      state.message = `${enemy.name}が${adventurerName(state, adjacentAdventurer.npcId)}へ${enemy.damage}ダメージ。`;
      if (adjacentAdventurer.hp <= 0) defeatDungeonAdventurer(state, adjacentAdventurer, events);
      continue;
    }
    if (distance(enemy.pos, run.player) === 1) {
      const damage = Math.max(1, enemy.damage - playerDefensePower(state));
      state.hp -= damage;
      events.push({ type: "attack", attackerId: enemy.id, targetId: "player", damage });
      state.message = `${enemy.name}の攻撃。${damage}ダメージ。`;
      if (state.hp <= 0) {
        merchantGameOver(state, `${enemy.name}の攻撃で命を落とした。`);
        break;
      }
      continue;
    }
    const from = { ...enemy.pos };
    const targets = [run.player, ...run.adventurers.map((adventurer) => adventurer.pos)];
    const target = [...targets].sort((a, b) => distance(enemy.pos, a) - distance(enemy.pos, b))[0] ?? run.player;
    moveEnemy(enemy, run, rng, target);
    if (!samePosition(from, enemy.pos)) events.push({ type: "move", actorId: enemy.id, from, to: { ...enemy.pos } });
  }
}

function defeatDungeonAdventurer(state: GameState, adventurer: DungeonAdventurer, events: DungeonEvent[]): void {
  const run = state.run;
  if (!run) return;
  const npc = state.npcs.find((entry) => entry.id === adventurer.npcId);
  if (!npc) return;
  npc.status = "dead";
  const loot = npc.inventoryIds.map((id) => state.itemsById[id]).filter((item): item is ItemInstance => Boolean(item));
  for (const item of loot) {
    item.location = { kind: "corpse", npcId: npc.id, floor: run.floor };
    item.historyV2 ??= [];
    item.historyV2.push({ day: state.day, type: "ownerDied", npcId: npc.id, detail: `${npc.name}が地下${run.floor}階で死亡` });
  }
  run.bodies.push({ id: `body-${npc.id}`, npcId: npc.id, name: `冒険者${npc.name}`, pos: { ...adventurer.pos }, loot, inspected: false });
  run.adventurers = run.adventurers.filter((entry) => entry.npcId !== adventurer.npcId);
  events.push({ type: "defeated", actorId: adventurer.npcId, pos: { ...adventurer.pos } });
  state.message = `${npc.name}は敵に倒され、所持品をその場に残した。`;
}

function updateGuardRecovery(state: GameState, events: DungeonEvent[]): void {
  const run = state.run;
  const guard = run?.guard;
  if (!run || !guard || guard.mode !== "retreated") return;
  const safe = run.enemies.every((enemy) => distance(enemy.pos, run.player) > 6);
  guard.safeTurns = safe ? guard.safeTurns + 1 : 0;
  if (guard.safeTurns < 2) return;
  guard.mode = "covering";
  guard.safeTurns = 0;
  events.push({ type: "guardMode", guardId: guard.guardId, mode: "covering" });
  state.message = `${activeGuardName(state, guard.guardId)}は周囲の安全を確認し、カバーへ戻った。`;
}

function finishTurn(state: GameState, events: DungeonEvent[], decrementCooldown = true): TurnResult {
  const run = state.run;
  if (!run) return { consumedTurn: true, events };
  if (decrementCooldown && run.shoveCooldown > 0) run.shoveCooldown -= 1;
  guardPhase(state, events);
  adventurerPhase(state, events);
  enemyPhase(state, events);
  updateGuardRecovery(state, events);
  if (state.run) {
    state.run.turn += 1;
    consumeDungeonTime(state, 1);
  }
  return { consumedTurn: true, events };
}

function performAttack(state: GameState, direction: Vec): TurnResult {
  const run = state.run;
  if (!run) return emptyResult();
  const targetPos = { x: run.player.x + direction.x, y: run.player.y + direction.y };
  const enemy = run.enemies.find((candidate) => samePosition(candidate.pos, targetPos));
  if (!enemy) {
    state.message = "正面に攻撃できる敵はいない。";
    return emptyResult();
  }
  const damage = playerAttackPower(state);
  enemy.hp -= damage;
  const events: DungeonEvent[] = [{ type: "attack", attackerId: "player", targetId: enemy.id, damage }];
  state.message = `${enemy.name}へ${damage}ダメージ。`;
  if (enemy.hp <= 0) {
    run.enemies = run.enemies.filter((entry) => entry.id !== enemy.id);
    events.push({ type: "defeated", actorId: enemy.id, pos: { ...enemy.pos } });
    state.message = `${enemy.name}を倒した。`;
  }
  return finishTurn(state, events);
}

function performMove(state: GameState, direction: Vec): TurnResult {
  const run = state.run;
  if (!run) return emptyResult();
  const next = { x: run.player.x + direction.x, y: run.player.y + direction.y };
  const enemy = run.enemies.find((candidate) => samePosition(candidate.pos, next));
  if (enemy) {
    state.message = `${enemy.name}が進路を塞いでいる。Spaceから「押し返す」を選ぼう。`;
    return emptyResult();
  }
  const adventurer = run.adventurers.find((candidate) => samePosition(candidate.pos, next));
  if (adventurer) {
    state.message = `${adventurerName(state, adventurer.npcId)}がいる。正面から調べると取引できる。`;
    return emptyResult();
  }
  if (!canTraverse(run.map, run.player, next)) {
    state.message = "壁が行く手を阻んでいる。";
    return emptyResult();
  }
  const from = { ...run.player };
  run.player = next;
  const events: DungeonEvent[] = [{ type: "move", actorId: "player", from, to: { ...next } }];
  if (run.guard) {
    run.guard.pos = { ...next };
    events.push({ type: "move", actorId: run.guard.guardId, from, to: { ...next } });
  }
  state.message = "足音を殺して進む。";
  return finishTurn(state, events);
}

function performShove(state: GameState, direction: Vec): TurnResult {
  const run = state.run;
  if (!run) return emptyResult();
  if (run.shoveCooldown > 0) {
    state.message = `息を整えるまで、あと${run.shoveCooldown}ターン必要だ。`;
    return emptyResult();
  }
  const targetPos = { x: run.player.x + direction.x, y: run.player.y + direction.y };
  const enemy = run.enemies.find((candidate) => samePosition(candidate.pos, targetPos));
  if (!enemy) {
    state.message = "正面に押し返せる敵はいない。";
    return emptyResult();
  }
  const from = { ...enemy.pos };
  const destination = { x: enemy.pos.x + direction.x, y: enemy.pos.y + direction.y };
  const blocked = !canTraverse(run.map, enemy.pos, destination)
    || run.enemies.some((candidate) => candidate.id !== enemy.id && samePosition(candidate.pos, destination))
    || samePosition(run.player, destination);
  run.shoveCooldown = 2;
  const events: DungeonEvent[] = [];
  if (blocked) {
    state.message = `${enemy.name}の後ろが塞がっている。押し返しに失敗した。`;
    events.push({ type: "shove", enemyId: enemy.id, from, to: from, success: false });
  } else {
    enemy.pos = destination;
    enemy.staggerTurns = Math.max(enemy.staggerTurns, 1);
    state.message = `${enemy.name}を1マス押し返した。今が逃げる機会だ。`;
    events.push({ type: "shove", enemyId: enemy.id, from, to: { ...destination }, success: true });
  }
  return finishTurn(state, events, false);
}

function swapCandidate(state: GameState, swapOutId?: string): ItemInstance | undefined | null {
  if (currentItemCount(state) < INVENTORY_CAPACITY) return undefined;
  if (!swapOutId) return null;
  const swap = state.inventory.find((item) => item.uuid === swapOutId);
  if (!swap) return null;
  return swap;
}

function carryItem(state: GameState, incoming: ItemInstance, swapOutId: string | undefined, onSwap: (item: ItemInstance) => void): boolean {
  const swap = swapCandidate(state, swapOutId);
  if (swap === null) {
    state.message = `持ち物が${INVENTORY_CAPACITY}個でいっぱいだ。1個置いて入れ替えよう。`;
    return false;
  }
  if (swap) {
    state.inventory = state.inventory.filter((item) => item.uuid !== swap.uuid);
    swap.owner = "ground";
    if (state.run) swap.location = { kind: "dungeonGround", floor: state.run.floor, pos: { ...state.run.player } };
    onSwap(swap);
  }
  incoming.owner = "player";
  incoming.location = { kind: "playerBag" };
  state.inventory.push(incoming);
  return true;
}



function performPickup(state: GameState, swapOutId?: string): TurnResult {
  const run = state.run;
  if (!run) return emptyResult();
  const groundIndex = run.items.findIndex((entry) => samePosition(entry.pos, run.player));
  if (groundIndex < 0) {
    state.message = "ここには拾えるものがない。";
    return emptyResult();
  }
  const ground = run.items[groundIndex]!;
  if (!carryItem(state, ground.item, swapOutId, (item) => run.items.push({ item, pos: { ...run.player } }))) return emptyResult();
  run.items.splice(groundIndex, 1);
  state.message = `${itemName(ground.item)}を拾った。所持数 ${currentItemCount(state)}/${INVENTORY_CAPACITY}`;
  return finishTurn(state, [{ type: "pickup", itemId: ground.item.uuid }]);
}

function performOpenChest(state: GameState, chestId: string, swapOutId?: string): TurnResult {
  const run = state.run;
  if (!run) return emptyResult();
  const index = run.chests.findIndex((chest) => chest.id === chestId && samePosition(chest.pos, run.player));
  if (index < 0) return emptyResult();
  const chest = run.chests[index]!;
  if (!carryItem(state, chest.item, swapOutId, (item) => run.items.push({ item, pos: { ...run.player } }))) return emptyResult();
  run.chests.splice(index, 1);
  state.message = `宝箱から${itemName(chest.item)}を見つけた。`;
  return finishTurn(state, [{ type: "pickup", itemId: chest.item.uuid }]);
}

function performInspectBody(state: GameState, bodyId: string): TurnResult {
  const run = state.run;
  const body = run?.bodies.find((entry) => entry.id === bodyId && samePosition(entry.pos, run.player));
  if (!run || !body) return emptyResult();
  if (body.inspected) return emptyResult();
  body.inspected = true;
  const deadNpc = body.npcId ? state.npcs.find((npc) => npc.id === body.npcId) : undefined;
  state.message = deadNpc
    ? `${deadNpc.name}という冒険者だ。${body.loot.length}個の所持品が残されている。`
    : "古い遺体だ。身元を示す物は残っていない。";
  return finishTurn(state, [{ type: "message", text: state.message }]);
}

function performLootBody(state: GameState, bodyId: string, itemId: string, swapOutId?: string): TurnResult {
  const run = state.run;
  const body = run?.bodies.find((entry) => entry.id === bodyId && samePosition(entry.pos, run.player));
  const item = body?.loot.find((entry) => entry.uuid === itemId);
  if (!run || !body || !item) return emptyResult();
  if (!carryItem(state, item, swapOutId, (dropped) => run.items.push({ item: dropped, pos: { ...run.player } }))) return emptyResult();
  body.loot = body.loot.filter((entry) => entry.uuid !== item.uuid);
  const npcId = body.npcId;
  if (npcId) {
    const npc = state.npcs.find((entry) => entry.id === npcId);
    if (npc) npc.inventoryIds = npc.inventoryIds.filter((id) => id !== item.uuid);
    item.historyV2 ??= [];
    item.historyV2.push({ day: state.day, type: "lootedFromCorpse", npcId, detail: `${body.name}の遺体から回収` });
  }
  item.history.push({ day: state.day, type: "recovered", detail: `${body.name}の遺品として回収` });
  state.message = `${body.name}から${itemName(item)}を回収した。`;
  return finishTurn(state, [{ type: "pickup", itemId: item.uuid }]);
}

function performDrop(state: GameState, itemId: string): TurnResult {
  const run = state.run;
  const item = state.inventory.find((entry) => entry.uuid === itemId);
  if (!run || !item) return emptyResult();
  unequipIfNeeded(state, item.uuid);
  state.inventory = state.inventory.filter((entry) => entry.uuid !== item.uuid);
  item.owner = "ground";
  item.location = { kind: "dungeonGround", floor: run.floor, pos: { ...run.player } };
  run.items.push({ item, pos: { ...run.player } });
  state.message = `${itemName(item)}を足元に置いた。`;
  return finishTurn(state, [{ type: "message", text: state.message }]);
}

function nearbyAdventurer(state: GameState, npcId: string): DungeonAdventurer | undefined {
  const run = state.run;
  return run?.adventurers.find((entry) => entry.npcId === npcId && distance(entry.pos, run.player) === 1);
}

function performUseMedicine(state: GameState, itemId: string, target: "player" | "guard"): TurnResult {
  const item = state.inventory.find((entry) => entry.uuid === itemId);
  const healing = item ? itemDefinition(item).healing ?? 0 : 0;
  const guard = target === "guard" ? state.run?.guard : undefined;
  const actor = target === "guard" ? guard : state;
  if (!item || healing <= 0 || !actor) {
    state.message = target === "guard" ? "回復できる護衛がいない。" : "その品は回復に使えない。";
    return emptyResult();
  }
  if (actor.hp >= actor.maxHp) {
    state.message = target === "guard" ? "護衛は負傷していない。" : "体力は満タンだ。";
    return emptyResult();
  }
  const recovered = Math.min(healing, actor.maxHp - actor.hp);
  actor.hp += recovered;
  state.inventory = state.inventory.filter((entry) => entry.uuid !== item.uuid);
  unequipIfNeeded(state, item.uuid);
  item.location = { kind: "consumed", actorId: guard?.guardId ?? "player" };
  state.message = `${itemName(item)}を${guard ? activeGuardName(state, guard.guardId) : "自分"}に使い、HPを${recovered}回復した。`;
  return finishTurn(state, [{ type: "message", text: state.message }]);
}

export function dungeonAdventurerSellPrice(item: ItemInstance): number {
  return Math.max(1, Math.ceil(itemDefinition(item).baseValue * 0.8));
}

export function dungeonAdventurerBuyPrice(item: ItemInstance): number {
  return Math.max(1, Math.floor(itemDefinition(item).baseValue * 0.6));
}

function performBuyFromAdventurer(state: GameState, npcId: string, itemId: string, swapOutId?: string): TurnResult {
  const adventurer = nearbyAdventurer(state, npcId);
  const npc = state.npcs.find((entry) => entry.id === npcId);
  const item = npc?.inventoryIds.includes(itemId) ? state.itemsById[itemId] : undefined;
  if (!adventurer || !npc || !item) return emptyResult();
  const price = dungeonAdventurerSellPrice(item);
  if (state.gold < price) { state.message = "所持金が足りない。"; return emptyResult(); }
  if (!carryItem(state, item, swapOutId, (dropped) => state.run?.items.push({ item: dropped, pos: { ...state.run!.player } }))) return emptyResult();
  state.gold -= price;
  adventurer.gold += price;
  npc.inventoryIds = npc.inventoryIds.filter((id) => id !== item.uuid);
  item.history.push({ day: state.day, type: "found", detail: `${npc.name}から${price}Gで購入` });
  state.message = `${npc.name}から${itemName(item)}を${price}Gで買った。`;
  return finishTurn(state, [{ type: "pickup", itemId: item.uuid }]);
}

function performSellToAdventurer(state: GameState, npcId: string, itemId: string): TurnResult {
  const adventurer = nearbyAdventurer(state, npcId);
  const npc = state.npcs.find((entry) => entry.id === npcId);
  const item = state.inventory.find((entry) => entry.uuid === itemId);
  if (!adventurer || !npc || !item) return emptyResult();
  const definition = itemDefinition(item);
  const needsMedicine = adventurer.hp < adventurer.maxHp && (definition.healing ?? 0) > 0;
  if (!npc.interests.includes(definition.category) && !needsMedicine) { state.message = `${npc.name}はその品を探していない。`; return emptyResult(); }
  const price = dungeonAdventurerBuyPrice(item);
  if (adventurer.gold < price) { state.message = `${npc.name}の手持ちでは買い取れない。`; return emptyResult(); }
  state.inventory = state.inventory.filter((entry) => entry.uuid !== item.uuid);
  unequipIfNeeded(state, item.uuid);
  state.gold += price;
  adventurer.gold -= price;
  npc.inventoryIds.push(item.uuid);
  item.owner = npc.id;
  item.location = { kind: "npcInventory", npcId: npc.id };
  item.history.push({ day: state.day, type: "sold", detail: `${npc.name}へダンジョン内で売却`, value: price });
  state.message = `${npc.name}へ${itemName(item)}を${price}Gで売った。`;
  return finishTurn(state, [{ type: "message", text: state.message }]);
}

function performSmoke(state: GameState): TurnResult {
  const run = state.run;
  if (!run || state.smokeBombs <= 0) {
    state.message = "煙玉は残っていない。";
    return emptyResult();
  }
  state.smokeBombs -= 1;
  let affected = 0;
  for (const enemy of run.enemies) {
    if (distance(enemy.pos, run.player) <= 5) {
      enemy.state = "patrol";
      enemy.target = undefined;
      affected += 1;
    }
  }
  state.message = affected > 0 ? `煙玉を割った。${affected}体の追跡を断った。` : "煙玉を割ったが、近くに敵はいない。";
  return finishTurn(state, [{ type: "message", text: state.message }]);
}

function performReturnStone(state: GameState): TurnResult {
  if (!state.run || state.returnStones <= 0) {
    state.message = "帰還石はもうない。入口まで戻ろう。";
    return emptyResult();
  }
  state.returnStones -= 1;
  returnHome(state);
  return { consumedTurn: true, events: [{ type: "message", text: state.message }] };
}

function performStairs(state: GameState): TurnResult {
  const run = state.run;
  if (!run) return emptyResult();
  if (run.map.stairsDown && samePosition(run.player, run.map.stairsDown)) {
    consumeDungeonTime(state, 1);
    if (state.status === "gameOver") return { consumedTurn: true, events: [{ type: "message", text: state.message }] };
    descend(state);
    return { consumedTurn: true, events: [{ type: "message", text: state.message }] };
  }
  if (samePosition(run.player, run.map.stairsUp)) {
    consumeDungeonTime(state, 1);
    if (state.status === "gameOver") return { consumedTurn: true, events: [{ type: "message", text: state.message }] };
    ascend(state);
    return { consumedTurn: true, events: [{ type: "message", text: state.message }] };
  }
  state.message = "階段はここにはない。";
  return emptyResult();
}

export function performDungeonCommand(state: GameState, command: DungeonCommand): TurnResult {
  switch (command.type) {
    case "move": return performMove(state, command.direction);
    case "attack": return performAttack(state, command.direction);
    case "shove": return performShove(state, command.direction);
    case "wait":
      state.message = "息を整え、周囲の動きを見る。";
      return finishTurn(state, [{ type: "message", text: state.message }]);
    case "smoke": return performSmoke(state);
    case "return": return performReturnStone(state);
    case "pickup": return performPickup(state, command.swapOutId);
    case "openChest": return performOpenChest(state, command.chestId, command.swapOutId);
    case "inspectBody": return performInspectBody(state, command.bodyId);
    case "lootBody": return performLootBody(state, command.bodyId, command.itemId, command.swapOutId);
    case "drop": return performDrop(state, command.itemId);
    case "useMedicine": return performUseMedicine(state, command.itemId, command.target);
    case "buyFromAdventurer": return performBuyFromAdventurer(state, command.npcId, command.itemId, command.swapOutId);
    case "sellToAdventurer": return performSellToAdventurer(state, command.npcId, command.itemId);
    case "stairs": return performStairs(state);
  }
}

export function movePlayer(state: GameState, direction: Vec): TurnResult {
  return performDungeonCommand(state, { type: "move", direction });
}

export function shoveEnemy(state: GameState, direction: Vec): TurnResult {
  return performDungeonCommand(state, { type: "shove", direction });
}

export function waitTurn(state: GameState): TurnResult {
  return performDungeonCommand(state, { type: "wait" });
}

export function tryPickup(state: GameState, swapOutId?: string): TurnResult {
  return performDungeonCommand(state, { type: "pickup", swapOutId });
}

export function tryOpenChest(state: GameState, chestId?: string, swapOutId?: string): TurnResult {
  const run = state.run;
  const chest = chestId
    ? run?.chests.find((entry) => entry.id === chestId)
    : run?.chests.find((entry) => samePosition(entry.pos, run.player));
  return chest ? performDungeonCommand(state, { type: "openChest", chestId: chest.id, swapOutId }) : emptyResult();
}

export function inspectBody(state: GameState, bodyId: string): TurnResult {
  return performDungeonCommand(state, { type: "inspectBody", bodyId });
}

export function lootBodyItem(state: GameState, bodyId: string, itemId: string, swapOutId?: string): TurnResult {
  return performDungeonCommand(state, { type: "lootBody", bodyId, itemId, swapOutId });
}

export function dropItem(state: GameState, itemId: string): TurnResult {
  return performDungeonCommand(state, { type: "drop", itemId });
}

export function useSmokeBomb(state: GameState): TurnResult {
  return performDungeonCommand(state, { type: "smoke" });
}

export function tryStairs(state: GameState): TurnResult {
  return performDungeonCommand(state, { type: "stairs" });
}

export function merchantGameOver(state: GameState, cause: string): void {
  if (state.status === "gameOver") return;
  state.hp = 0;
  state.status = "gameOver";
  state.message = `${cause} 商人の物語はここで終わった。`;
}

/** Return stones use homeSpawn; the first-floor up stair arrives at dungeonEntrance. */
export function returnHome(state: GameState, arrival: "homeSpawn" | "dungeonEntrance" = "homeSpawn"): void {
  const completedRun = state.run;
  if (completedRun) {
    const survivorIds = new Set([
      ...completedRun.adventurers.map((entry) => entry.npcId),
      ...Object.values(completedRun.floorStates).flatMap((floor) => floor.adventurers.map((entry) => entry.npcId)),
    ]);
    for (const npc of state.npcs) if (survivorIds.has(npc.id) && npc.status === "dungeon") npc.status = "departed";
  }
  state.message = "家へ帰還した。棚の商品を並べ替え、次の護衛を指定できる。";
  if (completedRun?.guard) {
    const npc = state.npcs.find((entry) => entry.id === completedRun.guard?.guardId);
    if (npc && npc.status !== "dead") {
      npc.status = "inTown";
      npc.relation = Math.min(100, npc.relation + 1);
    }
  }
  state.location = "home";
  const home = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("autostart") === "world"
    ? loadTrialMapPack()?.home ?? createHomeMap()
    : createHomeMap();
  const homeMarker = home.markers.find((marker) => marker.kind === arrival) ?? home.markers.find((marker) => marker.kind === "homeSpawn") ?? { ...HOME_SPAWN };
  state.homePos = { x: homeMarker.x * home.tileSize + home.tileSize / 2, y: homeMarker.y * home.tileSize + home.tileSize / 2 };
  state.run = undefined;
  state.hiredGuardId = undefined;
  state.hiredGuardFee = undefined;
  state.escortCommission = undefined;
  // 探索を1回終えるごとに、もう誰も参照しない床の品と通りすがりの冒険者を捨てる。
  pruneCampaignRecords(state);
  processDayEvents(state);
}


export function guardRetreatRatio(state: GameState, guardId: string): number {
  return state.npcs.find((entry) => entry.id === guardId)?.retreatHpRatio ?? 0.25;
}

export function guardRetreatThreshold(state: GameState, guard: ActiveGuard): number {
  return Math.max(1, Math.ceil(guard.maxHp * guardRetreatRatio(state, guard.guardId)));
}













export function moveToStore(state: GameState, item: ItemInstance): void {
  unequipIfNeeded(state, item.uuid);
  state.inventory = state.inventory.filter((entry) => entry.uuid !== item.uuid);
  item.owner = "store";
  item.location = { kind: "homeStorage" };
  item.historyV2 ??= [];
  item.historyV2.push({ day: state.day, type: "stored", detail: "自宅保管庫へ移動" });
  state.store.push(item);
  state.message = `${itemName(item)}を店の保管庫へ移した。`;
}

export function moveInventoryItems(state: GameState, itemIds: readonly string[], destination: "storage" | "display"): number {
  const selectedIds = new Set(itemIds);
  const selected = state.inventory.filter((item) => selectedIds.has(item.uuid));
  if (destination === "display" && selected.length > DISPLAY_CAPACITY - state.display.length) {
    state.message = `展示台の空きは${Math.max(0, DISPLAY_CAPACITY - state.display.length)}枠だ。`;
    return 0;
  }
  for (const item of selected) {
    moveToStore(state, item);
    if (destination === "display") toggleDisplay(state, item);
  }
  if (selected.length) state.message = `${selected.length}点を${destination === "display" ? "販売品として店頭へ出した" : "保管庫へ移した"}。`;
  return selected.length;
}

export function moveStoreItemsToInventory(state: GameState, itemIds: readonly string[]): number {
  const selectedIds = new Set(itemIds);
  const selected = state.store.filter((item) => selectedIds.has(item.uuid));
  const available = INVENTORY_CAPACITY - inventoryItemCount(state);
  if (selected.length > available) {
    state.message = `鞄の空きは${Math.max(0, available)}枠だ。`;
    return 0;
  }
  for (const item of selected) {
    state.store = state.store.filter((entry) => entry.uuid !== item.uuid);
    state.display = state.display.filter((id) => id !== item.uuid);
    item.owner = "player";
    item.location = { kind: "playerBag" };
    item.history.push({ day: state.day, type: "recovered", detail: "自宅保管庫から鞄へ移動" });
    state.inventory.push(item);
  }
  if (selected.length) state.message = `${selected.length}点を保管庫から鞄へ戻した。`;
  return selected.length;
}

export function toggleDisplay(state: GameState, item: ItemInstance): void {
  if (!state.store.some((entry) => entry.uuid === item.uuid)) return;
  const showing = state.display.includes(item.uuid);
  if (showing) {
    state.display = state.display.filter((uuid) => uuid !== item.uuid);
    item.location = { kind: "homeStorage" };
    state.message = "展示を取り下げた。";
  } else if (state.display.length >= DISPLAY_CAPACITY) {
    state.message = `展示台は${DISPLAY_CAPACITY}枠までだ。`;
  } else {
    state.display.push(item.uuid);
    item.location = { kind: "shopStock" };
    item.historyV2 ??= [];
    item.historyV2.push({ day: state.day, type: "listed", detail: "販売品として店頭へ配置" });
    item.history.push({ day: state.day, type: "displayed", detail: "店頭に展示" });
    if (item.singular) {
      state.events.push({ id: `showcase-${item.uuid}`, dueDay: state.day + 1, text: `${itemName(item)}の展示を見た、見知らぬ客が店を訪ねてきた。` });
    }
    state.message = `${itemName(item)}を店頭に展示した。`;
  }
}

export function setDisplayedItems(state: GameState, itemIds: readonly string[]): number {
  const validStoreIds = new Set(state.store.map((item) => item.uuid));
  const desiredIds = new Set(itemIds.filter((id) => validStoreIds.has(id)));
  if (desiredIds.size > DISPLAY_CAPACITY) {
    state.message = `展示台は${DISPLAY_CAPACITY}枠までだ。`;
    return 0;
  }
  state.display = state.display.filter((id) => validStoreIds.has(id));
  let changed = 0;
  for (const item of state.store) {
    const showing = state.display.includes(item.uuid);
    const shouldShow = desiredIds.has(item.uuid);
    if (showing === shouldShow) continue;
    toggleDisplay(state, item);
    changed += 1;
  }
  state.message = `陳列を更新した。販売品 ${state.display.length}点。`;
  return changed;
}


function processDayEvents(state: GameState): void {
  const due = state.events.filter((event) => event.dueDay <= state.day);
  state.events = state.events.filter((event) => event.dueDay > state.day);
  if (due.length === 0) return;
  state.message = due.map((event) => event.text).join(" ");
}



