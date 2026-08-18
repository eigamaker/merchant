import { CUSTOMERS, GUARD_DEFINITIONS, INITIAL_QUESTS, ITEM_DEFINITIONS } from "./content";
import { canTraverse, isWalkableCell, samePosition } from "./dungeonRules";
import { findSafeCompanionArrival } from "./dungeonArrival";
import { Rng } from "./rng";
import { HOME_SPAWN, createHomeMap } from "./homeMap";
import { compileMap, loadTrialMapPack } from "./mapDocument";
import { actorDefinition } from "./actorCatalog";
import type {
  ActiveGuard,
  Customer,
  DungeonBody,
  DungeonCommand,
  DungeonEvent,
  DungeonMap,
  DungeonRun,
  Enemy,
  GameState,
  GroundItem,
  GuardDefinition,
  GuardRecord,
  ItemDefinition,
  ItemInstance,
  KnowledgeLevel,
  Quest,
  TurnResult,
  Vec,
} from "./types";

export const DUNGEON_WIDTH = 48;
export const DUNGEON_HEIGHT = 36;
export const INVENTORY_CAPACITY = 12;
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

export function createDungeonMap(mode: DungeonGenerationMode, seed: number, floor: number, requiresTomb = false): DungeonMap {
  if (mode === "manual") {
    const trial = typeof window !== "undefined" ? loadTrialMapPack()?.dungeons.find((map) => map.floor === floor) : undefined;
    if (trial) return compileMap(trial);
  }
  return generateDungeon(seed, floor, requiresTomb);
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
  return {
    version: 4,
    day: 1,
    gold: 300,
    hp: 12,
    maxHp: 12,
    returnStones: 1,
    smokeBombs: 2,
    location: "home",
    homePos: { x: HOME_SPAWN.x * 16 + 8, y: HOME_SPAWN.y * 16 + 8 },
    expeditionSerial: 0,
    guildReputation: 0,
    guards: Object.keys(GUARD_DEFINITIONS).map((id) => ({ id, unlocked: false, relation: 0, experience: 0, level: 1 })),
    inventory: [],
    store: [],
    archive: [],
    display: [],
    customers: clone(CUSTOMERS),
    quests: clone(INITIAL_QUESTS),
    events: [],
    message: "最初の依頼は銀露草の回収だ。入口から地下へ向かおう。",
    nextItemId: 1,
    story: {
      blackSword: "locked",
      early: {
        stage: "herb",
        guardHiringUnlocked: false,
        missingBodyInspected: false,
        ringConsulted: [],
        shoveTutorialSeen: false,
      },
    },
  };
}

export function itemDefinition(item: ItemInstance): ItemDefinition {
  const definition = ITEM_DEFINITIONS[item.definitionId];
  if (!definition) throw new Error(`未定義アイテム: ${item.definitionId}`);
  return definition;
}

export function itemName(item: ItemInstance): string {
  const definition = itemDefinition(item);
  if (item.knowledge === "identified") return definition.trueName;
  if (item.knowledge === "suspected") return definition.suspectedName;
  return definition.unknownName;
}

export function itemBulk(item: ItemInstance): number {
  return itemDefinition(item).bulk;
}

export function currentBulk(state: GameState): number {
  return state.inventory.reduce((total, item) => total + itemBulk(item), 0);
}

export function createItem(state: GameState, definitionId: string, floor?: number): ItemInstance {
  if (!ITEM_DEFINITIONS[definitionId]) throw new Error(`未定義アイテム: ${definitionId}`);
  return {
    uuid: `item-${state.nextItemId++}`,
    definitionId,
    discoveredDay: state.day,
    discoveredFloor: floor,
    knowledge: "unknown",
    clues: [],
    owner: "player",
    history: [{ day: state.day, type: "found", detail: floor ? `地下${floor}階で発見` : "家で入手" }],
  };
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

export function generateDungeon(seed: number, floor: number, requiresTomb = false): DungeonMap {
  const rng = new Rng(seed + floor * 7919);
  const tiles = Array.from({ length: DUNGEON_HEIGHT }, () => Array.from({ length: DUNGEON_WIDTH }, () => WALL));
  const rooms = createRooms(tiles, rng);
  connectRooms(tiles, rooms, rng);
  const entranceRoom = rooms[0];
  if (!entranceRoom) throw new Error("ダンジョンの部屋を生成できませんでした。");
  const entrance = { ...entranceRoom.center };
  const byDistance = [...rooms].sort((a, b) => distance(b.center, entrance) - distance(a.center, entrance));
  const stairs = { ...(byDistance[0]?.center ?? entrance) };
  const specialCandidate = byDistance.find((room) => !samePosition(room.center, stairs));
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
    specialRoom: requiresTomb && specialCandidate ? { ...specialCandidate.center } : undefined,
  };
}

function distance(a: Vec, b: Vec): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function questById(state: GameState, id: string): Quest | undefined {
  return state.quests.find((quest) => quest.id === id);
}

function ownsDefinition(state: GameState, definitionId: string): boolean {
  return [...state.inventory, ...state.store, ...state.archive].some((item) => item.definitionId === definitionId);
}

function activeCollectQuests(state: GameState, floor: number): Quest[] {
  return state.quests.filter((quest) => quest.status === "active"
    && quest.targetFloor === floor
    && quest.targetItemId
    && quest.objective?.kind === "collect");
}

function randomItemId(rng: Rng): string {
  const ids = Object.keys(ITEM_DEFINITIONS).filter((id) => !ITEM_DEFINITIONS[id]!.unique);
  return rng.pick(ids);
}

function buildEnemies(rng: Rng, map: DungeonMap, floor: number, occupied: Vec[]): Enemy[] {
  if (Array.isArray(map.enemyRoster)) {
    const authored = map.enemyRoster.map((actorId) => ({ actorId, actor: actorDefinition(actorId) })).filter((entry) => entry.actor?.enemyStats);
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
  const variants = [
    { id: "slime", name: "深青スライム", hp: 3 + floor, damage: 1 },
    { id: "bat", name: "影蝙蝠", hp: 2 + floor, damage: 1 },
    { id: "crawler", name: "岩穿ち獣", hp: 4 + floor, damage: 2 },
  ];
  return Array.from({ length: 6 + Math.min(floor, 6) }, (_, index) => {
    const variant = rng.pick(variants);
    const pos = freeFloor(map, rng, occupied);
    occupied.push(pos);
    return {
      ...variant,
      id: `${variant.id}-${floor}-${index}`,
      pos,
      maxHp: variant.hp,
      state: "patrol" as const,
      staggerTurns: 0,
    };
  });
}

/** Deterministic entry point used by the map-editor trial and regression tests. */
export function buildInitialEnemies(map: DungeonMap, floor: number, seed = 1): Enemy[] {
  const occupied: Vec[] = [map.stairsUp, ...(map.stairsDown ? [map.stairsDown] : [])];
  return buildEnemies(new Rng(seed + floor * 997), map, floor, occupied);
}

function guardMaxHp(record: GuardRecord, definition: GuardDefinition): number {
  return definition.baseMaxHp + Math.max(0, record.level - 1);
}

function initialGuard(state: GameState, map: DungeonMap, occupied: Vec[]): ActiveGuard | undefined {
  if (!state.hiredGuardId) return undefined;
  const record = state.guards.find((guard) => guard.id === state.hiredGuardId);
  const definition = GUARD_DEFINITIONS[state.hiredGuardId];
  if (!record || !definition || (record.injuredUntilDay ?? 0) > state.day) return undefined;
  const candidates = Object.values(DIRECTION).map((direction) => ({ x: map.stairsUp.x + direction.x, y: map.stairsUp.y + direction.y }));
  const pos = candidates.find((candidate) => canTraverse(map, map.stairsUp, candidate) && !occupied.some((entry) => samePosition(entry, candidate)))
    ?? freeFloor(map, new Rng(state.expeditionSerial + state.day), occupied);
  occupied.push(pos);
  const maxHp = guardMaxHp(record, definition);
  return { guardId: definition.id, pos, hp: maxHp, maxHp, damage: definition.damage };
}

function shouldPlaceAronBody(state: GameState, floor: number): boolean {
  if (floor !== 2) return false;
  const missing = questById(state, "missing");
  const ring = questById(state, "old-ring");
  return missing?.status === "active"
    || missing?.status === "readyToReport"
    || (ring?.status === "active" && !ownsDefinition(state, "old-ring"));
}

function buildRun(state: GameState, floor: number, seed: number, carriedGuard?: ActiveGuard | null, highestFloor = floor, forceTomb = false, floorStates: NonNullable<DungeonRun["floorStates"]> = {}): DungeonRun {
  const needsTomb = forceTomb || (state.story.blackSword === "incident" && floor === 3);
  const map = createDungeonMap(dungeonGenerationMode(), seed, floor, needsTomb);
  const rng = new Rng(seed + floor * 997);
  const occupied: Vec[] = [map.stairsUp, ...(map.stairsDown ? [map.stairsDown] : [])];
  const items: GroundItem[] = [];

  for (const quest of activeCollectQuests(state, floor)) {
    if (!quest.targetItemId || ownsDefinition(state, quest.targetItemId)) continue;
    const pos = freeFloor(map, rng, occupied);
    occupied.push(pos);
    items.push({ item: createItem(state, quest.targetItemId, floor), pos });
  }
  for (let index = items.length; index < 7; index += 1) {
    const pos = freeFloor(map, rng, occupied);
    occupied.push(pos);
    items.push({ item: createItem(state, randomItemId(rng), floor), pos });
  }

  const guard = carriedGuard === null
    ? undefined
    : carriedGuard
      ? { ...carriedGuard, pos: { ...map.stairsUp } }
      : initialGuard(state, map, occupied);
  if (guard && carriedGuard) {
    const candidate = Object.values(DIRECTION)
      .map((direction) => ({ x: map.stairsUp.x + direction.x, y: map.stairsUp.y + direction.y }))
      .find((pos) => canTraverse(map, map.stairsUp, pos) && !occupied.some((entry) => samePosition(entry, pos)));
    guard.pos = candidate ?? freeFloor(map, rng, occupied);
    occupied.push(guard.pos);
  }

  const enemies = buildEnemies(rng, map, floor, occupied);
  const occupiedEntities = [...occupied, ...enemies.map((enemy) => enemy.pos)];
  const chests = Array.from({ length: 2 }, (_, index) => {
    const pos = freeFloor(map, rng, occupiedEntities);
    occupiedEntities.push(pos);
    return { id: `chest-${floor}-${index}`, pos, item: createItem(state, randomItemId(rng), floor) };
  });
  const traps = Array.from({ length: rng.int(2, 4) }, () => {
    const pos = freeFloor(map, rng, occupiedEntities);
    occupiedEntities.push(pos);
    return pos;
  });
  const bodies: DungeonBody[] = [];
  if (shouldPlaceAronBody(state, floor)) {
    const pos = freeFloor(map, rng, occupiedEntities);
    occupiedEntities.push(pos);
    const lootIds = ["adventurer-badge", "old-ring"].filter((id) => !ownsDefinition(state, id));
    bodies.push({
      id: "aron",
      name: "冒険者アロン",
      pos,
      loot: lootIds.map((id) => createItem(state, id, floor)),
      inspected: state.story.early.missingBodyInspected,
      questId: "missing",
    });
  }
  for (let index = bodies.length; index < 2; index += 1) {
    const pos = freeFloor(map, rng, occupiedEntities);
    occupiedEntities.push(pos);
    bodies.push({ id: `body-${floor}-${index}`, name: "名もなき冒険者", pos, loot: [], inspected: false });
  }

  return {
    seed,
    floor,
    map,
    player: { ...map.stairsUp },
    enemies,
    items,
    chests,
    traps,
    bodies,
    guard,
    shoveCooldown: 0,
    highestFloor: Math.max(highestFloor, floor),
    turn: 0,
    floorStates,
  };
}

export function beginExpedition(state: GameState): void {
  state.expeditionSerial += 1;
  const params = typeof window === "undefined" ? undefined : new URLSearchParams(window.location.search);
  const querySeed = Number.parseInt(params?.get("dungeonSeed") ?? "", 10);
  const queryFloor = Number.parseInt(params?.get("dungeonFloor") ?? "", 10);
  const seed = Number.isFinite(querySeed) && querySeed > 0
    ? querySeed
    : Math.imul(state.day, 104729) ^ Math.imul(state.expeditionSerial, 0x9e3779b1);
  const floor = Number.isFinite(queryFloor) ? Math.min(8, Math.max(1, queryFloor)) : 1;
  const forceTomb = params?.get("dungeonTomb") === "1";
  state.location = "dungeon";
  state.returnStones = 1;
  state.smokeBombs = 2;
  state.run = buildRun(state, floor, seed, undefined, floor, forceTomb);
  state.message = state.run.guard
    ? `${guardDefinition(state.run.guard.guardId)?.name ?? "護衛"}とダンジョンへ入った。主人公の後に護衛、敵の順で動く。`
    : "ダンジョンへ入った。敵は倒せない。Spaceの「押し返す」で退路を作ろう。";
}

function snapshotFloor(run: DungeonRun): import("./types").DungeonFloorSnapshot {
  return {
    floor: run.floor,
    map: clone(run.map),
    player: clone(run.player),
    enemies: clone(run.enemies),
    items: clone(run.items),
    chests: clone(run.chests),
    traps: clone(run.traps),
    bodies: clone(run.bodies),
    guard: run.guard ? clone(run.guard) : undefined,
    shoveCooldown: run.shoveCooldown,
    turn: run.turn,
  };
}

function restoreFloor(snapshot: import("./types").DungeonFloorSnapshot, seed: number, floorStates: NonNullable<DungeonRun["floorStates"]>, highestFloor: number, player: Vec, carriedGuard?: ActiveGuard): DungeonRun {
  const restored = clone(snapshot);
  const occupied: Vec[] = [
    player,
    restored.map.stairsUp,
    ...(restored.map.stairsDown ? [restored.map.stairsDown] : []),
    ...restored.enemies.map((enemy) => enemy.pos),
    ...restored.items.map((item) => item.pos),
    ...restored.chests.map((chest) => chest.pos),
    ...restored.traps,
    ...restored.bodies.map((body) => body.pos),
  ];
  const guardPosition = carriedGuard ? findSafeCompanionArrival(restored.map, player, occupied) : undefined;
  return {
    ...restored, seed,
    player: { ...player },
    // A fully occupied invalid map cannot safely render the guard; never overlap it with another entity.
    guard: carriedGuard && guardPosition ? { ...clone(carriedGuard), pos: guardPosition } : undefined,
    highestFloor,
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
    ? restoreFloor(previous, run.seed, floorStates, highestFloor, previous.map.stairsUp, run.guard)
    : buildRun(state, nextFloor, run.seed, run.guard ?? null, highestFloor, false, floorStates);
  state.message = `地下${nextFloor}階へ降りた。`;
}

export function ascend(state: GameState): void {
  const run = state.run;
  if (!run) return;
  if (run.floor === 1) { returnHome(state, false, "dungeonEntrance"); return; }
  const nextFloor = run.floor - 1;
  const floorStates = { ...(run.floorStates ?? {}), [String(run.floor)]: snapshotFloor(run) };
  const previous = floorStates[String(nextFloor)];
  if (previous) {
    const landing = previous.map.stairsDown ?? previous.map.stairsUp;
    state.run = restoreFloor(previous, run.seed, floorStates, run.highestFloor, landing, run.guard);
  } else {
    const map = createDungeonMap(dungeonGenerationMode(), run.seed, nextFloor);
    state.run = buildRun(state, nextFloor, run.seed, run.guard ?? null, run.highestFloor, false, floorStates);
    state.run.player = { ...(map.stairsDown ?? map.stairsUp) };
  }
  state.message = `地下${nextFloor}階へ上がった。`;
}

function nearestGuardTarget(run: DungeonRun): Vec[] {
  return Object.values(DIRECTION)
    .map((direction) => ({ x: run.player.x + direction.x, y: run.player.y + direction.y }))
    .filter((pos) => canTraverse(run.map, run.player, pos) && !run.enemies.some((enemy) => samePosition(enemy.pos, pos)));
}

function nextPathStep(run: DungeonRun, start: Vec, goals: Vec[], blocked: Vec[]): Vec | undefined {
  const goalKeys = new Set(goals.map((goal) => `${goal.x},${goal.y}`));
  if (goalKeys.has(`${start.x},${start.y}`)) return undefined;
  const queue: Array<{ pos: Vec; first?: Vec }> = [{ pos: start }];
  const visited = new Set([`${start.x},${start.y}`]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const direction of Object.values(DIRECTION)) {
      const next = { x: current.pos.x + direction.x, y: current.pos.y + direction.y };
      const key = `${next.x},${next.y}`;
      if (visited.has(key) || !canTraverse(run.map, current.pos, next) || blocked.some((entry) => samePosition(entry, next))) continue;
      const first = current.first ?? next;
      if (goalKeys.has(key)) return first;
      visited.add(key);
      queue.push({ pos: next, first });
    }
  }
  return undefined;
}

function guardPhase(state: GameState, events: DungeonEvent[]): void {
  const run = state.run;
  const guard = run?.guard;
  if (!run || !guard) return;
  const adjacent = run.enemies
    .filter((enemy) => distance(enemy.pos, guard.pos) === 1)
    .sort((a, b) => Number(distance(b.pos, run.player) === 1) - Number(distance(a.pos, run.player) === 1));
  const target = adjacent[0];
  if (target) {
    target.hp -= guard.damage;
    events.push({ type: "attack", attackerId: guard.guardId, targetId: target.id, damage: guard.damage });
    state.message = `${guardDefinition(guard.guardId)?.name ?? "護衛"}が${target.name}へ${guard.damage}ダメージ。`;
    if (target.hp <= 0) {
      run.enemies = run.enemies.filter((enemy) => enemy.id !== target.id);
      events.push({ type: "defeated", actorId: target.id });
      state.message = `${guardDefinition(guard.guardId)?.name ?? "護衛"}が${target.name}を退けた。`;
    }
    return;
  }
  const from = { ...guard.pos };
  const step = nextPathStep(run, guard.pos, nearestGuardTarget(run), [...run.enemies.map((enemy) => enemy.pos), run.player]);
  if (step) {
    guard.pos = step;
    events.push({ type: "move", actorId: guard.guardId, from, to: { ...step } });
  }
}

function moveEnemy(enemy: Enemy, run: DungeonRun, rng: Rng): void {
  const targets = [run.player, ...(run.guard ? [run.guard.pos] : [])];
  const target = [...targets].sort((a, b) => distance(enemy.pos, a) - distance(enemy.pos, b))[0] ?? run.player;
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
    const collision = run.enemies.some((other) => other.id !== enemy.id && samePosition(other.pos, next));
    if (canTraverse(run.map, enemy.pos, next)
      && !collision
      && !samePosition(next, run.player)
      && (!run.guard || !samePosition(next, run.guard.pos))) {
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
    if (guard && distance(enemy.pos, guard.pos) === 1) {
      guard.hp -= enemy.damage;
      events.push({ type: "attack", attackerId: enemy.id, targetId: guard.guardId, damage: enemy.damage });
      state.message = `${enemy.name}が${guardDefinition(guard.guardId)?.name ?? "護衛"}へ${enemy.damage}ダメージ。`;
      if (guard.hp <= 0) {
        const record = state.guards.find((entry) => entry.id === guard.guardId);
        if (record) record.injuredUntilDay = state.day + 3;
        events.push({ type: "defeated", actorId: guard.guardId });
        state.message = `${guardDefinition(guard.guardId)?.name ?? "護衛"}は負傷して撤退した。2日間雇えない。`;
        run.guard = undefined;
      }
      continue;
    }
    if (distance(enemy.pos, run.player) === 1) {
      state.hp -= enemy.damage;
      events.push({ type: "attack", attackerId: enemy.id, targetId: "player", damage: enemy.damage });
      state.message = `${enemy.name}の攻撃。${enemy.damage}ダメージ。`;
      if (state.hp <= 0) {
        rescuePlayer(state);
        break;
      }
      continue;
    }
    const from = { ...enemy.pos };
    moveEnemy(enemy, run, rng);
    if (!samePosition(from, enemy.pos)) events.push({ type: "move", actorId: enemy.id, from, to: { ...enemy.pos } });
  }
}

function finishTurn(state: GameState, events: DungeonEvent[], decrementCooldown = true): TurnResult {
  const run = state.run;
  if (!run) return { consumedTurn: true, events };
  if (decrementCooldown && run.shoveCooldown > 0) run.shoveCooldown -= 1;
  guardPhase(state, events);
  enemyPhase(state, events);
  if (state.run) state.run.turn += 1;
  return { consumedTurn: true, events };
}

function performMove(state: GameState, direction: Vec): TurnResult {
  const run = state.run;
  if (!run) return emptyResult();
  const next = { x: run.player.x + direction.x, y: run.player.y + direction.y };
  const enemy = run.enemies.find((candidate) => samePosition(candidate.pos, next));
  if (enemy) {
    state.story.early.shoveTutorialSeen = true;
    state.message = `${enemy.name}が進路を塞いでいる。Spaceから「押し返す」を選ぼう。`;
    return emptyResult();
  }
  if (run.guard && samePosition(run.guard.pos, next)) {
    state.message = "護衛がいる。別の方向へ進もう。";
    return emptyResult();
  }
  if (!canTraverse(run.map, run.player, next)) {
    state.message = "壁が行く手を阻んでいる。";
    return emptyResult();
  }
  const from = { ...run.player };
  run.player = next;
  const events: DungeonEvent[] = [{ type: "move", actorId: "player", from, to: { ...next } }];
  state.message = "足音を殺して進む。";
  const trapIndex = run.traps.findIndex((trap) => samePosition(trap, next));
  if (trapIndex >= 0) {
    run.traps.splice(trapIndex, 1);
    state.hp -= 2;
    state.message = "床の罠が作動した。2ダメージ。";
    if (state.hp <= 0) {
      rescuePlayer(state);
      return { consumedTurn: true, events };
    }
  }
  if (run.map.specialRoom && samePosition(next, run.map.specialRoom) && state.story.blackSword === "incident") {
    state.story.blackSword = "tomb";
    state.message = "古い墓所を発見した。『アルベルト』という名が刻まれている。学者に相談しよう。";
    const quest = questById(state, "black-tomb");
    if (quest) quest.status = "active";
  }
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
    || samePosition(run.player, destination)
    || Boolean(run.guard && samePosition(run.guard.pos, destination));
  run.shoveCooldown = 2;
  state.story.early.shoveTutorialSeen = true;
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

function swapCandidate(state: GameState, incoming: ItemInstance, swapOutId?: string): ItemInstance | undefined | null {
  if (currentBulk(state) + itemBulk(incoming) <= INVENTORY_CAPACITY) return undefined;
  if (!swapOutId) return null;
  const swap = state.inventory.find((item) => item.uuid === swapOutId);
  if (!swap || currentBulk(state) - itemBulk(swap) + itemBulk(incoming) > INVENTORY_CAPACITY) return null;
  return swap;
}

function carryItem(state: GameState, incoming: ItemInstance, swapOutId: string | undefined, onSwap: (item: ItemInstance) => void): boolean {
  const swap = swapCandidate(state, incoming, swapOutId);
  if (swap === null) {
    state.message = "持ち物がいっぱいだ。十分な大きさの品と入れ替えよう。";
    return false;
  }
  if (swap) {
    state.inventory = state.inventory.filter((item) => item.uuid !== swap.uuid);
    swap.owner = "ground";
    onSwap(swap);
    syncQuestCarryProgress(state, swap.definitionId);
  }
  incoming.owner = "player";
  state.inventory.push(incoming);
  completePickupObjective(state, incoming);
  return true;
}

function completePickupObjective(state: GameState, item: ItemInstance): void {
  if (item.definitionId === "adventurer-badge") {
    const missing = questById(state, "missing");
    if (missing?.status === "active") missing.status = "readyToReport";
    return;
  }
  if (item.definitionId === "old-ring") return;
  const quest = state.quests.find((entry) => entry.status === "active" && entry.targetItemId === item.definitionId);
  if (!quest) return;
  if (quest.id === "black-sword") {
    state.story.blackSword = "found";
    state.message = "黒い長剣を持ち帰れる。誰に見せるかが重要だ。";
    return;
  }
  quest.status = "readyToReport";
}

function syncQuestCarryProgress(state: GameState, definitionId: string): void {
  const stillHeld = state.inventory.some((item) => item.definitionId === definitionId);
  if (stillHeld) return;
  for (const quest of state.quests) {
    if (quest.status === "readyToReport" && quest.targetItemId === definitionId) quest.status = "active";
  }
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
  state.message = `${itemName(ground.item)}を拾った。容量 ${currentBulk(state)}/${INVENTORY_CAPACITY}`;
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
  if (body.id === "aron") {
    state.story.early.missingBodyInspected = true;
    state.message = "認識票には『アロン』とある。傍らに古びた指輪も残されている。";
  } else {
    state.message = "古い遺体だ。身元を示す物も、持ち帰れる遺品も残っていない。";
  }
  return finishTurn(state, [{ type: "message", text: state.message }]);
}

function performLootBody(state: GameState, bodyId: string, itemId: string, swapOutId?: string): TurnResult {
  const run = state.run;
  const body = run?.bodies.find((entry) => entry.id === bodyId && samePosition(entry.pos, run.player));
  const item = body?.loot.find((entry) => entry.uuid === itemId);
  if (!run || !body || !item) return emptyResult();
  if (!carryItem(state, item, swapOutId, (dropped) => run.items.push({ item: dropped, pos: { ...run.player } }))) return emptyResult();
  body.loot = body.loot.filter((entry) => entry.uuid !== item.uuid);
  item.history.push({ day: state.day, type: "recovered", detail: `${body.name}の遺品として回収` });
  state.message = `${body.name}から${itemName(item)}を回収した。`;
  return finishTurn(state, [{ type: "pickup", itemId: item.uuid }]);
}

function performDrop(state: GameState, itemId: string): TurnResult {
  const run = state.run;
  const item = state.inventory.find((entry) => entry.uuid === itemId);
  if (!run || !item) return emptyResult();
  state.inventory = state.inventory.filter((entry) => entry.uuid !== item.uuid);
  item.owner = "ground";
  run.items.push({ item, pos: { ...run.player } });
  syncQuestCarryProgress(state, item.definitionId);
  state.message = `${itemName(item)}を足元に置いた。`;
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
  returnHome(state, false);
  return { consumedTurn: true, events: [{ type: "message", text: state.message }] };
}

function performStairs(state: GameState): TurnResult {
  const run = state.run;
  if (!run) return emptyResult();
  if (run.map.stairsDown && samePosition(run.player, run.map.stairsDown)) {
    descend(state);
    return { consumedTurn: true, events: [{ type: "message", text: state.message }] };
  }
  if (samePosition(run.player, run.map.stairsUp)) {
    ascend(state);
    return { consumedTurn: true, events: [{ type: "message", text: state.message }] };
  }
  state.message = "階段はここにはない。";
  return emptyResult();
}

export function performDungeonCommand(state: GameState, command: DungeonCommand): TurnResult {
  switch (command.type) {
    case "move": return performMove(state, command.direction);
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

/** Return stones and rescue use homeSpawn; the first-floor up stair arrives at dungeonEntrance. */
export function returnHome(state: GameState, rescued: boolean, arrival: "homeSpawn" | "dungeonEntrance" = "homeSpawn"): void {
  const completedRun = state.run;
  if (rescued) {
    const protectedDefinitions = new Set(state.quests
      .filter((quest) => quest.status === "active" || quest.status === "readyToReport")
      .map((quest) => quest.targetItemId));
    const recoverable = state.inventory.filter((item) => !itemDefinition(item).unique && !protectedDefinitions.has(item.definitionId));
    const losses = [...recoverable].sort((a, b) => a.uuid.localeCompare(b.uuid)).slice(0, Math.ceil(recoverable.length / 2));
    state.inventory = state.inventory.filter((item) => !losses.includes(item));
    const fee = Math.floor(state.gold * 0.1);
    state.gold -= fee;
    state.message = `救助された。戦利品${losses.length}点と救助費${fee}Gを失った。`;
  } else {
    state.message = "家へ帰還した。依頼の報告と護衛契約ができる。";
    if (completedRun?.guard) {
      const record = state.guards.find((entry) => entry.id === completedRun.guard?.guardId);
      if (record) {
        record.relation = Math.min(100, record.relation + 1);
        record.experience += Math.max(1, completedRun.highestFloor);
        record.level = record.experience >= 7 ? 3 : record.experience >= 3 ? 2 : 1;
      }
    }
  }
  state.day += 1;
  state.hp = state.maxHp;
  state.location = "home";
  const home = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("autostart") === "world"
    ? loadTrialMapPack()?.home ?? createHomeMap()
    : createHomeMap();
  const homeMarker = home.markers.find((marker) => marker.kind === arrival) ?? home.markers.find((marker) => marker.kind === "homeSpawn") ?? { ...HOME_SPAWN };
  state.homePos = { x: homeMarker.x * home.tileSize + home.tileSize / 2, y: homeMarker.y * home.tileSize + home.tileSize / 2 };
  state.run = undefined;
  state.hiredGuardId = undefined;
  state.hiredGuardFee = undefined;
  processDayEvents(state);
}

function rescuePlayer(state: GameState): void {
  returnHome(state, true);
}

export function guardDefinition(id: string): GuardDefinition | undefined {
  return GUARD_DEFINITIONS[id];
}

export function guardFee(state: GameState, guardId: string): number {
  const definition = GUARD_DEFINITIONS[guardId];
  const record = state.guards.find((guard) => guard.id === guardId);
  if (!definition || !record) return 0;
  const relationDiscount = Math.min(0.2, record.relation * 0.02);
  const guildDiscount = state.guildReputation >= 2 ? 0.2 : 0;
  return Math.max(1, Math.floor(definition.baseFee * (1 - relationDiscount) * (1 - guildDiscount)));
}

export function hireGuard(state: GameState, guardId: string): boolean {
  if (state.location !== "home" || !state.story.early.guardHiringUnlocked) return false;
  const definition = GUARD_DEFINITIONS[guardId];
  const record = state.guards.find((guard) => guard.id === guardId);
  if (!definition || !record?.unlocked) return false;
  if ((record.injuredUntilDay ?? 0) > state.day) {
    state.message = `${definition.name}は${record.injuredUntilDay}日目まで療養中だ。`;
    return false;
  }
  const availableGold = state.gold + (state.hiredGuardFee ?? 0);
  const fee = guardFee(state, guardId);
  if (availableGold < fee) {
    state.message = `契約には${fee}G必要だ。`;
    return false;
  }
  state.gold = availableGold - fee;
  state.hiredGuardId = guardId;
  state.hiredGuardFee = fee;
  state.message = `${definition.name}を次の遠征の護衛に雇った。契約料${fee}G。`;
  return true;
}

export function cancelGuard(state: GameState): void {
  if (!state.hiredGuardId) return;
  state.gold += state.hiredGuardFee ?? 0;
  state.hiredGuardId = undefined;
  state.hiredGuardFee = undefined;
  state.message = "護衛契約を取り消し、契約料を返金した。";
}

export function scoutRevealsTrap(state: GameState, trap: Vec): boolean {
  const guard = state.run?.guard;
  return Boolean(guard && GUARD_DEFINITIONS[guard.guardId]?.trait === "scout" && distance(guard.pos, trap) <= 3);
}

export function isQuestItemProtected(state: GameState, item: ItemInstance): boolean {
  if (item.definitionId === "old-ring" && !state.story.early.ringResolution) return true;
  // 黒い長剣編は「誰に売るか」が目的なので、発見後だけ通常取引へ渡す。
  if (item.definitionId === "black-sword" && state.story.blackSword === "found") return false;
  return state.quests.some((quest) => (quest.status === "active" || quest.status === "readyToReport")
    && quest.targetItemId === item.definitionId);
}

function removeItemForTurnIn(state: GameState, definitionId: string, owner: string): ItemInstance | undefined {
  const item = state.inventory.find((entry) => entry.definitionId === definitionId);
  if (!item) return undefined;
  state.inventory = state.inventory.filter((entry) => entry.uuid !== item.uuid);
  item.owner = owner;
  item.history.push({ day: state.day, type: "recovered", detail: "依頼主へ返却" });
  state.archive.push(item);
  return item;
}

export function reportQuest(state: GameState, questId: string): boolean {
  const quest = questById(state, questId);
  if (!quest || quest.status !== "readyToReport" || !quest.targetItemId) return false;
  if (!removeItemForTurnIn(state, quest.targetItemId, `quest:${quest.id}`)) {
    quest.status = "active";
    state.message = "依頼品を持っていない。もう一度回収しよう。";
    return false;
  }
  quest.status = "complete";
  state.gold += quest.reward ?? 0;
  if (quest.id === "herb") {
    state.story.early.stage = "lostSword";
    const next = questById(state, "lost-sword");
    if (next) next.status = "available";
  } else if (quest.id === "lost-sword") {
    state.story.early.stage = "missing";
    state.story.early.guardHiringUnlocked = true;
    for (const guard of state.guards) guard.unlocked = true;
    const next = questById(state, "missing");
    if (next) next.status = "available";
  } else if (quest.id === "missing") {
    state.story.early.stage = "ring";
    const ring = questById(state, "old-ring");
    if (ring) ring.status = "active";
  }
  state.message = `依頼「${quest.title}」を報告した。報酬${quest.reward ?? 0}G。`;
  return true;
}

export function consultRing(state: GameState, customerId: string): string {
  const quest = questById(state, "old-ring");
  const ring = state.inventory.find((item) => item.definitionId === "old-ring")
    ?? state.store.find((item) => item.definitionId === "old-ring");
  if (!ring || (quest?.status !== "active" && quest?.status !== "readyToReport")) return "相談できる指輪を持っていない。";
  const allowed = quest.objective?.kind === "consult" ? quest.objective.customerIds : [];
  if (!allowed.includes(customerId)) return "この人物からは指輪について新しい情報を得られそうにない。";
  const messages: Record<string, string> = {
    scholar: "エリス「冬塔家の誓約環です。家族の契約を示す、歴史的にも重要な品ですね」",
    jeweler: "サフィ「宝石より内側の銘が希少ね。市場なら千Gを超える買い手がつくわ」",
    duke: "ローデン「冬塔家の紋章だ。遺族のリナなら、ギルドが所在を知っているはずだ」",
  };
  if (!state.story.early.ringConsulted.includes(customerId)) {
    state.story.early.ringConsulted.push(customerId);
    ring.clues.push(messages[customerId]!);
    ring.history.push({ day: state.day, type: "examined", detail: `${state.customers.find((customer) => customer.id === customerId)?.name ?? customerId}に指輪を見せた` });
  }
  if (state.story.early.ringConsulted.length >= allowed.length) {
    ring.knowledge = "identified";
    if (quest) quest.status = "readyToReport";
  } else {
    ring.knowledge = "suspected";
  }
  return `${messages[customerId]}（手掛かり ${state.story.early.ringConsulted.length}/${allowed.length}）`;
}

export function resolveRing(state: GameState, resolution: "family" | "scholar" | "jeweler"): string {
  const quest = questById(state, "old-ring");
  const ring = state.inventory.find((item) => item.definitionId === "old-ring")
    ?? state.store.find((item) => item.definitionId === "old-ring");
  if (state.story.early.ringResolution || quest?.status !== "readyToReport" || !ring) return "指輪の扱いはまだ決められない。";
  const outcomes = {
    family: { gold: 250, owner: "family", detail: "遺族のリナへ返却" },
    scholar: { gold: 700, owner: "scholar", detail: "エリスの研究へ寄託" },
    jeweler: { gold: 1300, owner: "jeweler", detail: "サフィへ売却" },
  } as const;
  const outcome = outcomes[resolution];
  state.inventory = state.inventory.filter((item) => item.uuid !== ring.uuid);
  state.store = state.store.filter((item) => item.uuid !== ring.uuid);
  state.display = state.display.filter((uuid) => uuid !== ring.uuid);
  ring.owner = outcome.owner;
  ring.history.push({ day: state.day, type: resolution === "jeweler" ? "sold" : "recovered", detail: outcome.detail, value: outcome.gold });
  state.archive.push(ring);
  state.gold += outcome.gold;
  if (resolution === "family") state.guildReputation += 2;
  if (resolution === "scholar") {
    const scholar = state.customers.find((customer) => customer.id === "scholar");
    if (scholar) scholar.relation = Math.min(100, scholar.relation + 2);
  }
  if (resolution === "jeweler") {
    const jeweler = state.customers.find((customer) => customer.id === "jeweler");
    if (jeweler) jeweler.relation = Math.min(100, jeweler.relation + 2);
  }
  state.story.early.ringResolution = resolution;
  state.story.early.stage = "complete";
  quest.status = "complete";
  const blackSword = questById(state, "black-sword");
  if (blackSword?.status === "locked") blackSword.status = "available";
  state.message = `古びた指輪の行方を決めた。${outcome.gold}Gを得た。序章完了。`;
  return state.message;
}

export function appraiseItem(state: GameState, item: ItemInstance, customer: Customer): string {
  if (item.definitionId === "old-ring" && ["scholar", "jeweler", "duke"].includes(customer.id)) return consultRing(state, customer.id);
  const definition = itemDefinition(item);
  if (!customer.knowledge.includes(definition.category)) return `${customer.name}「専門外だが、変わった品だね」`;
  if (item.definitionId === "black-sword" && state.story.blackSword === "tomb" && customer.id === "scholar") {
    item.knowledge = "identified";
    item.clues.push("古い墓所の碑文と学者の照合により正体が判明した。");
    item.history.push({ day: state.day, type: "examined", detail: "エリスが黒騎士アルベルトの記録と照合" });
    state.story.blackSword = "revealed";
    const quest = questById(state, "black-tomb");
    if (quest) quest.status = "complete";
    return "エリス「これは黒騎士アルベルトの呪剣です。売却先へ急ぎましょう」";
  }
  const next: KnowledgeLevel = item.knowledge === "unknown" ? "suspected" : item.knowledge;
  item.knowledge = next;
  item.clues.push(`${customer.name}は${definition.category}の品としての価値を示唆した。`);
  item.history.push({ day: state.day, type: "examined", detail: `${customer.name}に見せた` });
  const estimateLow = Math.floor(definition.baseValue * 0.65);
  const estimateHigh = Math.floor(definition.baseValue * 1.35);
  return `${customer.name}「${definition.suspectedName}だと思う。${estimateLow}〜${estimateHigh}Gほどの品かもしれない」`;
}

export function initialOffer(_state: GameState, item: ItemInstance, customer: Customer): number {
  const definition = itemDefinition(item);
  const affinity = customer.interests.includes(definition.category) ? 1.55 : 0.55;
  const specialist = customer.id === definition.preferredBuyer ? 1.2 : 1;
  const relationship = 1 + customer.relation / 200;
  const story = item.definitionId === "black-sword" && customer.id === "duke" ? 1.25 : 1;
  return Math.max(20, Math.min(customer.budget, Math.floor(definition.baseValue * affinity * specialist * relationship * story)));
}

export function sellItem(state: GameState, item: ItemInstance, customerId: string, askMultiplier = 1): string {
  if (isQuestItemProtected(state, item)) return "依頼に関わる品は、結末を決めるまで通常売却できない。";
  const customer = state.customers.find((entry) => entry.id === customerId);
  if (!customer) return "その客は見つからない。";
  const offer = initialOffer(state, item, customer);
  const asked = Math.floor(offer * askMultiplier);
  const max = Math.floor(customer.budget * (customer.interests.includes(itemDefinition(item).category) ? 1 : 0.75));
  if (asked > max) {
    customer.relation = Math.max(-10, customer.relation - 1);
    return `${customer.name}「そこまでは出せない。今回は見送ろう」`;
  }
  const price = askMultiplier > 1 && asked <= offer * 1.25 ? asked : offer;
  state.inventory = state.inventory.filter((entry) => entry.uuid !== item.uuid);
  state.store = state.store.filter((entry) => entry.uuid !== item.uuid);
  state.display = state.display.filter((uuid) => uuid !== item.uuid);
  item.owner = customer.id;
  item.history.push({ day: state.day, type: "sold", detail: `${customer.name}へ売却`, value: price });
  state.archive.push(item);
  state.gold += price;
  customer.relation = Math.min(100, customer.relation + 2);
  if (item.definitionId === "black-sword" && customer.id === "duke" && state.story.blackSword === "found") {
    state.story.blackSword = "sold";
    state.events.push({ id: "black-sword-incident", dueDay: state.day + 1, text: "ローデン公爵家から、黒い長剣について至急の使者が来ている。" });
    const quest = questById(state, "black-sword");
    if (quest) quest.status = "complete";
  }
  return `${customer.name}へ${itemName(item)}を${price}Gで売却した。`;
}

export function moveToStore(state: GameState, item: ItemInstance): void {
  if (isQuestItemProtected(state, item)) {
    state.message = "依頼品は報告まで持ち歩こう。";
    return;
  }
  state.inventory = state.inventory.filter((entry) => entry.uuid !== item.uuid);
  item.owner = "store";
  state.store.push(item);
  state.message = `${itemName(item)}を店の保管庫へ移した。`;
}

export function toggleDisplay(state: GameState, item: ItemInstance): void {
  if (!state.store.some((entry) => entry.uuid === item.uuid)) return;
  const showing = state.display.includes(item.uuid);
  if (showing) {
    state.display = state.display.filter((uuid) => uuid !== item.uuid);
    state.message = "展示を取り下げた。";
  } else if (state.display.length >= 4) {
    state.message = "展示台は4枠までだ。";
  } else {
    state.display.push(item.uuid);
    item.history.push({ day: state.day, type: "displayed", detail: "店頭に展示" });
    if (itemDefinition(item).unique) {
      state.events.push({ id: `showcase-${item.uuid}`, dueDay: state.day + 1, text: `${itemName(item)}の展示を見た、見知らぬ客が店を訪ねてきた。` });
    }
    state.message = `${itemName(item)}を店頭に展示した。`;
  }
}

export function acceptQuest(state: GameState, questId: string): void {
  const quest = questById(state, questId);
  if (!quest || quest.status !== "available") return;
  const activeCount = state.quests.filter((entry) => entry.status === "active" || entry.status === "readyToReport").length;
  if (activeCount >= 3) {
    state.message = "同時に受けられる依頼は3件までだ。";
    return;
  }
  quest.status = "active";
  if (quest.id === "black-sword") state.story.blackSword = "rumor";
  state.message = `依頼「${quest.title}」を受けた。`;
}

function processDayEvents(state: GameState): void {
  const due = state.events.filter((event) => event.dueDay <= state.day);
  state.events = state.events.filter((event) => event.dueDay > state.day);
  if (due.length === 0) return;
  state.message = due.map((event) => event.text).join(" ");
  if (due.some((event) => event.id === "black-sword-incident")) {
    state.story.blackSword = "incident";
    const quest = questById(state, "black-tomb");
    if (quest) quest.status = "active";
  }
}

export function questProgressText(state: GameState, quest: Quest): string {
  if (quest.status === "locked") return "未解放";
  if (quest.status === "available") return "受注可能";
  if (quest.status === "readyToReport") {
    if (quest.id === "old-ring") return "指輪の行方を決められる";
    return "ギルドへ報告できる";
  }
  if (quest.status === "complete") return "完了";
  if (quest.id === "old-ring") return `相談 ${state.story.early.ringConsulted.length}/3`;
  if (quest.id === "missing" && state.story.early.missingBodyInspected) return "アロンの認識票を回収する";
  return quest.description;
}

export function activeQuestSummary(state: GameState): string {
  const active = state.quests.filter((quest) => quest.status === "active" || quest.status === "readyToReport");
  return active.length > 0
    ? active.map((quest) => `・${quest.title}：${questProgressText(state, quest)}`).join("\n")
    : "現在受けている依頼はない。";
}

export function customerById(state: GameState, id: string): Customer | undefined {
  return state.customers.find((customer) => customer.id === id);
}
