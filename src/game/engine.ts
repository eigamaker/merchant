import { canTraverse, isWalkableCell, samePosition } from "./dungeonRules";
import { Rng } from "./rng";
import { HOME_SPAWN, createHomeMap } from "./homeMap";
import { compileMap, loadTrialMapPack } from "./mapDocument";
import { createDefaultMapPack } from "./defaultMapPack";
import { actorDefinition, actorEnemyCost, actorEnemyStatsAt, actorHasEnemyStats } from "./actorCatalog";
import { ADVENTURER_RANKS, CHEST_LOOT, GROUND_LOOT, MERCHANT_ITEM_DEFINITIONS, STARTING_BAG_ID, itemCharges, lootEntriesFor, type LootEntry } from "./merchantContent";
import { SEED_NPC_IDS, canSellInHomeShop, initializeMerchantWorld, pruneCampaignRecords, registerWorldItem } from "./merchantEconomy";
import { announceSingularFind, selectFloorDelvers } from "./townDay";
import { npcCombatStats, recordGearDeed } from "./npcGear";
import { applySurvivalGrowth } from "./adventurerGrowth";
import { corpsesOnFloor, markCorpseInspected, pruneCorpses, recordCorpse, removeCorpseLoot } from "./dungeonCorpses";
import { markExplored } from "./dungeonVision";
import { DUNGEON_PRICE_CEILING, dungeonVerdict, marketPrice } from "./pricing";
import { refreshItemLegend, wasEntrusted } from "./itemLegend";
import { adjustGuardProfile, ensureGuardProfile, guardStand, recordGuardEvent } from "./guardProfiles";
import { recordBond } from "./npcBonds";
import { wantsItem } from "./npcDemand";
import { advanceTime, bagCapacity, canReorganizeHomeInventory, consumeDungeonTime, inventoryItemCount, processDayEvents, recoverMerchantAfterDeath, resetDailySystems, unequipIfNeeded } from "./merchantSystems";
import { generateDungeonFloor, generatedPlacementCells } from "./dungeonGenerator";
import { closeStall, openStall, stallAttraction, stallPhase } from "./dungeonStall";
import { betrayalPhase, payDemand, refuseDemand, rewardLoyalty } from "./guardBetrayal";
import { handOverToRobber, refuseRobber, trafficPhase } from "./dungeonTraffic";
import { DUNGEON_MAX_FLOOR, depthBand, difficultyZone, encounterBudget } from "./dungeonDifficulty";
import { deriveDungeonSeed, dungeonThemeIdForFloor, dungeonThemeSpawns, snapshotDungeonThemePool, type DungeonSpawnEntry } from "./dungeonThemes";
import { nextDungeonStep } from "./dungeonPathfinding";
import { hasDungeonVision } from "./dungeonVision";
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
  GuardDescentAssessment,
  ItemDefinition,
  ItemInstance,
  NpcRecord,
  TurnResult,
  Vec,
} from "./types";

export const DISPLAY_CAPACITY = 8;
export { DUNGEON_MAX_FLOOR } from "./dungeonDifficulty";
/** 身元の分からない遺体が現れ始める深さ。 */
export const ANONYMOUS_CORPSE_MIN_FLOOR = 4;
/** 帰還石が宝箱から見つかり始める深さ。 */
export const RETURN_STONE_MIN_FLOOR = 13;
/** 対象階の宝箱に帰還石が加わる確率。 */
export const RETURN_STONE_CHEST_CHANCE = 0.05;

export function returnStoneChestFor(seed: number, floor: number): boolean {
  if (floor < RETURN_STONE_MIN_FLOOR) return false;
  return new Rng(deriveDungeonSeed(seed, "return-stone", floor)).next() < RETURN_STONE_CHEST_CHANCE;
}

export type DungeonGenerationMode = "fixed" | "procedural" | "manual";

/** Procedural is the normal route. Fixed/manual remain explicit development comparisons. */
export function dungeonGenerationMode(): DungeonGenerationMode {
  if (typeof window === "undefined") return "procedural";
  const mode = new URLSearchParams(window.location.search).get("dungeon");
  if (mode === "manual" || mode === "procedural" || mode === "fixed") return mode;
  return new URLSearchParams(window.location.search).get("autostart") === "world" && loadTrialMapPack() ? "manual" : "procedural";
}

export function createDungeonMap(mode: DungeonGenerationMode, seed: number, floor: number, themePoolIds: readonly string[] = snapshotDungeonThemePool(), themeOverride?: string): DungeonMap {
  if (mode === "manual") {
    const trial = typeof window !== "undefined" ? loadTrialMapPack()?.dungeons.find((map) => map.floor === floor) : undefined;
    if (trial) return compileMap(trial);
  }
  if (mode === "fixed") {
    const authored = createDefaultMapPack().dungeons.find((map) => map.floor === floor);
    if (authored) return compileMap(authored);
  }
  const themeId = dungeonThemeIdForFloor(seed, floor, themePoolIds, themeOverride);
  return generateDungeon(seed, floor, themeId);
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
    version: 14,
    campaignId: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `campaign-${Date.now()}`,
    status: "active",
    day: 1,
    timeSlot: "morning",
    gold: 1000,
    vaultGold: 0,
    hp: 12,
    maxHp: 12,
    returnStones: 0,
    smokeBombs: 1,
    provisions: 3,
    equipment: {},
    shopSession: { day: 1, status: "closed", queueNpcIds: [], servedNpcIds: [] },
    dailySupplyStock: { day: 1, smokeBombs: 2, returnStones: 0, provisions: 0 },
    location: "home",
    homePos: { x: HOME_SPAWN.x * 16 + 8, y: HOME_SPAWN.y * 16 + 8 },
    expeditionSerial: 0,
    lastExpeditionDay: 0,
    inventory: [],
    store: [],
    archive: [],
    display: [],
    events: [],
    dungeonCorpses: [],
    lastSimulatedDay: 1,
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
  equipStartingBag(state);
  // 初期装備は台本のある15人だけに配る。名簿を増やしてもアイテム数は増やさない。
  for (const npc of state.npcs.filter((entry) => entry.adventurer && SEED_NPC_IDS.has(entry.id))) {
    const definitionId = npc.profession === "scout" ? "antidote" : npc.profession === "mercenary" ? "bronze-spear" : "iron-sword";
    const gear = createItem(state, definitionId);
    gear.owner = npc.id;
    gear.location = { kind: "npcInventory", npcId: npc.id };
    npc.inventoryIds.push(gear.uuid);
  }
  return state;
}

/** いま背負っている袋の名。持ちきれないと告げるとき、袋そのものを名指しする。 */
function bagName(state: GameState): string {
  const bag = state.equipment.bagItemId ? state.itemsById[state.equipment.bagItemId] : undefined;
  return bag ? MERCHANT_ITEM_DEFINITIONS[bag.definitionId]?.trueName ?? "道具袋" : "道具袋";
}

/** 商人が最初から背負っている風呂敷。枠を使わず、迷宮で死んでも身から離れない。 */
function equipStartingBag(state: GameState): void {
  const bag = createItem(state, STARTING_BAG_ID);
  bag.owner = "player";
  bag.location = { kind: "equipped" };
  state.equipment.bagItemId = bag.uuid;
}

export function itemDefinition(item: ItemInstance): ItemDefinition {
  const definition = MERCHANT_ITEM_DEFINITIONS[item.definitionId];
  if (!definition) throw new Error(`未定義アイテム: ${item.definitionId}`);
  return definition;
}

/** 束ねている数。束ねられない品は常に1。 */
export function itemCount(item: ItemInstance): number {
  return Math.max(1, Math.floor(item.count ?? 1));
}

/** 一束に入る数。束ねられない品は1。 */
export function stackLimit(item: ItemInstance): number {
  return Math.max(1, MERCHANT_ITEM_DEFINITIONS[item.definitionId]?.stackSize ?? 1);
}

/**
 * 表示名。**束は数まで含めて名前とする** —— 表示はすべてここを通るので、
 * 一覧も取引画面もメッセージも、束であることが一箇所で伝わる。
 */
export function itemName(item: ItemInstance): string {
  const base = itemBaseName(item);
  const count = itemCount(item);
  const total = MERCHANT_ITEM_DEFINITIONS[item.definitionId]?.charges ?? 1;
  // 束は数を、回数のある薬は残量を、名前の側に出す。表示はすべてここを通る。
  if (total > 1) return `${base}（残${itemCharges(item)}）`;
  return count > 1 ? `${base}×${count}` : base;
}

/** 数を付けない名。銘と鑑定の段だけを見る。 */
export function itemBaseName(item: ItemInstance): string {
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

/** 町の薬屋が常備する回復薬。どちらも通常アイテムとして1枠を使う。 */
export const APOTHECARY_MEDICINE_IDS = ["minor-healing-potion", "major-healing-potion"] as const;

export function buyMedicineAtApothecary(state: GameState, definitionId: typeof APOTHECARY_MEDICINE_IDS[number]): boolean {
  const definition = MERCHANT_ITEM_DEFINITIONS[definitionId];
  if (state.location !== "home" || !canReorganizeHomeInventory(state) || definition?.category !== "medicine") return false;
  if (currentItemCount(state) >= bagCapacity(state)) {
    state.message = "鞄に回復薬を入れる空きがない。回復薬は1本で1枠使う。";
    return false;
  }
  if (state.gold < definition.baseValue) {
    state.message = `${definition.trueName}を買うには${definition.baseValue}G必要だ。`;
    return false;
  }
  state.gold -= definition.baseValue;
  const medicine = createItem(state, definitionId);
  medicine.knowledge = "identified";
  medicine.history[0]!.detail = `薬師ネヴァから${definition.baseValue}Gで購入`;
  medicine.historyV2![0]!.detail = "薬師ネヴァから購入";
  state.inventory.push(medicine);
  state.message = `薬師ネヴァから${definition.trueName}を${definition.baseValue}Gで買った。自宅の店頭では売れない。`;
  return true;
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

/**
 * 拾える物の数は階の広さで決める。
 *
 * 以前は広さに関係なく床の品7個と宝箱2個を置いていた。作った地図と生成した地図では
 * 歩ける升の数が違うので、狭い階ほど数歩ごとに何かが落ちていることになっていた。
 * 鞄は24枠しかない。3階ぶん潜って拾い切れる量を超えないところに置く。
 */
const GROUND_ITEM_SPACING = 330;
const CHEST_SPACING = 900;
/**
 * 浅い階には素材を厚く置く。
 *
 * 地下1〜3階は序盤の稼ぎ場で、床の素材を運ぶことが商いになる。深く潜れるようになる前に、
 * 運べる量で稼ぐ段階を置く。深層では逆に、床の素材より宝箱の一点のほうが枠あたり高い。
 */
export const SHALLOW_GROUND_FLOORS = 3;
const SHALLOW_GROUND_SPACING = 110;

function groundItemCount(walkable: number, floor: number): number {
  return floor <= SHALLOW_GROUND_FLOORS
    ? dropCount(walkable, SHALLOW_GROUND_SPACING, 5, 8)
    : dropCount(walkable, GROUND_ITEM_SPACING, 1, 3);
}

function walkableCells(map: DungeonMap): number {
  let total = 0;
  for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) {
    if (isWalkableCell(map, { x, y })) total += 1;
  }
  return total;
}

function dropCount(walkable: number, spacing: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(walkable / spacing)));
}

function freeFloor(map: DungeonMap, rng: Rng, occupied: Vec[], preferred: readonly Vec[] = [], allowed: (pos: Vec) => boolean = () => true): Vec {
  if (preferred.length > 0) {
    const start = rng.int(0, preferred.length - 1);
    for (let offset = 0; offset < preferred.length; offset += 1) {
      const candidate = preferred[(start + offset) % preferred.length]!;
      if (isWalkableCell(map, candidate) && allowed(candidate) && !occupied.some((pos) => samePosition(pos, candidate))) return { ...candidate };
    }
  }
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const candidate = { x: rng.int(1, map.width - 2), y: rng.int(1, map.height - 2) };
    if (isWalkableCell(map, candidate) && allowed(candidate) && !occupied.some((pos) => samePosition(pos, candidate))) return candidate;
  }
  const fallback = map.tiles.flatMap((row, y) => row.map((tile, x) => ({ tile, pos: { x, y } })))
    .find(({ pos }) => isWalkableCell(map, pos) && allowed(pos) && !occupied.some((entry) => samePosition(entry, pos)));
  return fallback ? fallback.pos : { ...map.stairsUp };
}

export function generateDungeon(seed: number, floor: number, themeId = "cave"): DungeonMap {
  return generateDungeonFloor(seed, floor, themeId).map;
}

function distance(a: Vec, b: Vec): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
/**
 * 表から一点引く。
 *
 * 一点物は既に世に出ていれば表から落とす。万一その深さで引ける行が無ければ、
 * 表の先頭へ落として階を空手にしない。
 */
function rollLoot(state: GameState, rng: Rng, floor: number, table: readonly LootEntry[]): string {
  const rows = lootEntriesFor(table, floor).filter((entry) => {
    const definition = MERCHANT_ITEM_DEFINITIONS[entry.itemId];
    if (!definition) return false;
    return !(definition.singular && state.singularItemIds.includes(definition.id));
  });
  const weighted = rows.flatMap((entry) => Array<string>(Math.max(1, Math.round(entry.weight))).fill(entry.itemId));
  if (!weighted.length) return table[0]!.itemId;
  return rng.pick(weighted);
}

/** 床に落ちているもの。素材だけ。 */
function rollGroundItem(state: GameState, rng: Rng, floor: number): string {
  return rollLoot(state, rng, floor, GROUND_LOOT);
}

/** 宝箱・遺体・冒険者の手持ち。珍しいものはここにしか入っていない。 */
function rollChestItem(state: GameState, rng: Rng, floor: number): string {
  return rollLoot(state, rng, floor, CHEST_LOOT);
}

/**
 * 出現するのはテーマの出現表が決める。ここは、その表が空だったときに
 * 階を無人にしないための最小限の保険である。深さの帯は
 * dungeonDifficulty の DEPTH_BANDS ただひとつを使う。
 */
export function defaultEnemyRoster(floor: number): readonly string[] {
  const band = depthBand(floor);
  if (band === "deep") return ["orc3", "plant3", "vampire3"];
  if (band === "middle") return ["slime2", "orc2", "plant1"];
  return ["slime1", "orc1"];
}

/** A floor never holds more bodies than this, whatever the budget allows. */
const MAX_FLOOR_ENEMIES = 24;

/**
 * Fills a floor up to its encounter budget instead of to a fixed head count, so
 * a floor of tough enemies holds fewer of them and the total threat stays even.
 */
function buildEnemies(rosterRng: Rng, placementRng: Rng, map: DungeonMap, floor: number, occupied: Vec[]): Enemy[] {
  const spawns = map.procedural?.themeId
    ? dungeonThemeSpawns(map.procedural.themeId, floor)
    : (map.enemyRoster ?? []).map((actorId) => ({ actorId, minFloor: 1, weight: 1 } as DungeonSpawnEntry));
  const table = spawns
    .map((entry) => ({ entry, actor: actorDefinition(entry.actorId) }))
    .filter((row) => row.actor && actorHasEnemyStats(row.actor) && row.entry.weight > 0);
  if (!table.length) return [];
  // Weight decides who turns up; tier decides how much of the budget they eat.
  const weighted = table.flatMap((row) => Array<typeof row>(Math.max(1, Math.round(row.entry.weight))).fill(row));
  const candidates = generatedPlacementCells(map, ["combat", "loot", "treasure", "tomb"]);
  const placed: Enemy[] = [];
  const perActor = new Map<string, number>();
  let budget = encounterBudget(floor);
  // The cheapest line bounds the loop, so an exhausted budget always terminates.
  const cheapest = Math.min(...table.map((row) => actorEnemyCost(row.actor, row.entry.role === "elite")));
  while (budget >= cheapest && placed.length < MAX_FLOOR_ENEMIES) {
    const row = rosterRng.pick(weighted);
    const elite = row.entry.role === "elite";
    const cost = actorEnemyCost(row.actor, elite);
    const used = perActor.get(row.entry.actorId) ?? 0;
    if (cost > budget || (row.entry.maxPerFloor !== undefined && used >= row.entry.maxPerFloor)) continue;
    const stats = actorEnemyStatsAt(row.actor, floor, elite)!;
    const pos = freeFloor(map, placementRng, occupied, candidates, (candidate) => distance(candidate, map.stairsUp) > 6);
    occupied.push(pos);
    budget -= cost;
    perActor.set(row.entry.actorId, used + 1);
    placed.push({
      id: `${row.entry.actorId}-${floor}-${placed.length}`,
      actorId: row.entry.actorId,
      name: row.actor!.label,
      hp: stats.maxHp,
      maxHp: stats.maxHp,
      damage: stats.damage,
      state: "patrol" as const,
      staggerTurns: 0,
      pos,
    });
  }
  return placed;
}

/** Deterministic entry point used by the map-editor trial and regression tests. */
export function buildInitialEnemies(map: DungeonMap, floor: number, seed = 1): Enemy[] {
  const occupied: Vec[] = [map.stairsUp, ...(map.stairsDown ? [map.stairsDown] : [])];
  return buildEnemies(new Rng(deriveDungeonSeed(seed, "enemy-roster", floor)), new Rng(deriveDungeonSeed(seed, "enemy-placement", floor)), map, floor, occupied);
}


function activeGuardName(state: GameState, guardId: string): string {
  return state.npcs.find((entry) => entry.id === guardId)?.name ?? "護衛";
}

function initialGuard(state: GameState, map: DungeonMap): ActiveGuard | undefined {
  if (!state.hiredGuardId) return undefined;
  const npc = state.npcs.find((entry) => entry.id === state.hiredGuardId && entry.adventurer && entry.status !== "dead");
  if (!npc) return undefined;
  // 預けた装備は出発時に固定する。探索中に付け替えは起きない。
  const stats = npcCombatStats(state, npc);
  return { guardId: npc.id, pos: { ...map.stairsUp }, hp: stats.maxHp, maxHp: stats.maxHp, damage: stats.damage, defense: stats.defense, mode: "covering", safeTurns: 0, healingTrustGained: 0, retreatCount: 0 };
}


function buildRun(state: GameState, floor: number, seed: number, carriedGuard?: ActiveGuard | null, highestFloor = floor, floorStates: NonNullable<DungeonRun["floorStates"]> = {}, startedDay = state.day, themePoolIds: string[] = snapshotDungeonThemePool()): DungeonRun {
  const themeOverride = typeof window === "undefined" ? undefined : new URLSearchParams(window.location.search).get("dungeonTheme") ?? undefined;
  const map = createDungeonMap(dungeonGenerationMode(), seed, floor, themePoolIds, themeOverride);
  const itemRng = new Rng(deriveDungeonSeed(seed, "items", floor));
  const enemyRosterRng = new Rng(deriveDungeonSeed(seed, "enemy-roster", floor));
  const enemyPlacementRng = new Rng(deriveDungeonSeed(seed, "enemy-placement", floor));
  const chestRng = new Rng(deriveDungeonSeed(seed, "chests", floor));
  const bodyRng = new Rng(deriveDungeonSeed(seed, "bodies", floor));
  const npcRng = new Rng(deriveDungeonSeed(seed, "npcs", floor));
  const occupied: Vec[] = [map.stairsUp, ...(map.stairsDown ? [map.stairsDown] : [])];
  const items: GroundItem[] = [];
  const walkable = walkableCells(map);
  const itemCells = generatedPlacementCells(map, ["loot", "combat", "treasure", "tomb"]);

  for (let index = items.length; index < groundItemCount(walkable, floor); index += 1) {
    const pos = freeFloor(map, itemRng, occupied, itemCells);
    occupied.push(pos);
    const generated = createItem(state, rollGroundItem(state, itemRng, floor), floor);
    generated.location = { kind: "dungeonGround", floor, pos: { ...pos } };
    items.push({ item: generated, pos });
  }

  const guard = carriedGuard === null
    ? undefined
    : carriedGuard
      ? { ...carriedGuard, pos: { ...map.stairsUp } }
      : initialGuard(state, map);

  const enemies = buildEnemies(enemyRosterRng, enemyPlacementRng, map, floor, occupied);
  const occupiedEntities = [...occupied, ...enemies.map((enemy) => enemy.pos)];
  const chestCells = generatedPlacementCells(map, ["treasure", "loot"]);
  const chests = Array.from({ length: dropCount(walkable, CHEST_SPACING, 1, 1) }, (_, index) => {
    const pos = freeFloor(map, chestRng, occupiedEntities, chestCells);
    occupiedEntities.push(pos);
    const returnStone = index === 0 && returnStoneChestFor(seed, floor);
    return {
      id: `chest-${floor}-${index}`,
      pos,
      item: createItem(state, rollChestItem(state, chestRng, floor), floor),
      ...(returnStone ? { returnStone: true as const } : {}),
    };
  });
  const bodies: DungeonBody[] = [];
  const adventurers: DungeonAdventurer[] = [];

  // 身元の分からない古い遺体。名簿の誰でもないので記録は作らず、戦利品だけを置く。
  // 名前のある遺体は台帳から来る（誰かが本当にここで死んだときだけ）。
  // 身元の分からない遺体は地下4階から。浅い階で人が死んでいるのはおかしい ——
  // 実際、名簿の冒険者も推奨階の内側ではまず死なない。
  const anonymousCorpseChance = floor < ANONYMOUS_CORPSE_MIN_FLOOR ? 0 : Math.min(0.35, 0.15 + (floor - 1) * 0.03);
  const bodyCells = generatedPlacementCells(map, ["tomb", "combat"]);
  if (bodyRng.next() < anonymousCorpseChance) {
    const pos = freeFloor(map, bodyRng, occupiedEntities, bodyCells);
    occupiedEntities.push(pos);
    const loot = Array.from({ length: bodyRng.int(1, 2) }, () => createItem(state, rollChestItem(state, bodyRng, floor), floor));
    for (const found of loot) {
      found.owner = "ground";
      found.location = { kind: "dungeonGround", floor, pos: { ...pos } };
    }
    bodies.push({ id: `remains-${floor}-${bodyRng.int(1, 9999)}`, name: "打ち捨てられた遺体", pos, loot, inspected: false });
  }

  // 画面外で死んだ者も含め、この階で見つかる遺体を台帳から起こす。
  for (const corpse of corpsesOnFloor(state, floor)) {
    const deadNpc = state.npcs.find((npc) => npc.id === corpse.npcId);
    if (!deadNpc) continue;
    const pos = freeFloor(map, bodyRng, occupiedEntities, bodyCells);
    occupiedEntities.push(pos);
    if (!corpse.stocked) {
      // 誰にも見つけられないまま死んだ相手の遺品は、最初に行き当たった時に決まる。
      const generated = Array.from({ length: bodyRng.int(1, 2) }, () => createItem(state, rollChestItem(state, bodyRng, floor), floor));
      for (const found of generated) {
        found.owner = deadNpc.id;
        found.location = { kind: "corpse", npcId: deadNpc.id, floor };
        found.historyV2 ??= [];
        found.historyV2.push({ day: corpse.diedDay, type: "ownerDied", npcId: deadNpc.id, detail: `${deadNpc.name}が地下${floor}階で死亡` });
      }
      corpse.lootIds = generated.map((item) => item.uuid);
      corpse.stocked = true;
    }
    const loot = corpse.lootIds.map((id) => state.itemsById[id]).filter((item): item is ItemInstance => Boolean(item));
    bodies.push({ id: `body-${deadNpc.id}`, npcId: deadNpc.id, name: `冒険者${deadNpc.name}`, pos, loot, inspected: corpse.inspected });
  }

  // その階で行き合う冒険者は名簿から借りる。鋳造はしない。
  // 同じ探索で同じ人物が二つの階に立たないよう、既に置いた人を除く。
  const placedNpcIds = new Set(
    Object.values(floorStates).flatMap((snapshot) => snapshot.adventurers.map((entry) => entry.npcId)),
  );
  selectFloorDelvers(state, floor, placedNpcIds).forEach((delver, index) => {
    const npcCells = generatedPlacementCells(map, ["combat", "loot", "treasure", "tomb"]);
    const roamingPos = freeFloor(map, npcRng, occupiedEntities, npcCells);
    occupiedEntities.push(roamingPos);
    const stockIds = index === 0
      ? ["minor-healing-potion", rollChestItem(state, npcRng, floor)]
      : [rollChestItem(state, npcRng, floor)];
    for (const definitionId of stockIds) {
      const stock = createItem(state, definitionId, floor);
      stock.owner = delver.id;
      stock.location = { kind: "npcInventory", npcId: delver.id };
      delver.inventoryIds.push(stock.uuid);
    }
    // その階に立つこと自体が、担いだ武器の功績になる。
    recordGearDeed(state, delver, { floor });
    const stats = npcCombatStats(state, delver);
    adventurers.push({
      npcId: delver.id,
      pos: roamingPos,
      // 前の探索で負った傷を持ったまま現れる。
      hp: Math.max(1, Math.min(stats.maxHp, delver.conditionHp ?? stats.maxHp)),
      maxHp: stats.maxHp,
      damage: stats.damage,
      defense: stats.defense,
      gold: Math.max(200, Math.floor(delver.budget * 0.6)),
    });
  });

  return {
    seed,
    themeScheduleVersion: 1,
    themePoolIds: [...themePoolIds],
    startedDay,
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

export interface ExpeditionAvailability { allowed: boolean; reason?: "wrongLocation" | "night" | "shopActive" | "alreadyExplored" | "inactive"; message: string }

export function canBeginExpedition(state: GameState): ExpeditionAvailability {
  if (state.status !== "active") return { allowed: false, reason: "inactive", message: "このキャンペーンでは出発できない。" };
  if (state.location !== "home") return { allowed: false, reason: "wrongLocation", message: "自宅から出発する必要がある。" };
  if (state.lastExpeditionDay === state.day) return { allowed: false, reason: "alreadyExplored", message: "今日はすでにダンジョンへ入った。次の遠征は翌日にしよう。" };
  if (state.timeSlot === "night") return { allowed: false, reason: "night", message: "夜はダンジョンへ出発できない。休んで朝を待とう。" };
  if (["movingToCounter", "waiting", "serving"].includes(state.shopSession.status)) return { allowed: false, reason: "shopActive", message: "営業中はダンジョンへ出発できない。" };
  return { allowed: true, message: "出発できる。" };
}

export function beginExpedition(state: GameState): boolean {
  const availability = canBeginExpedition(state);
  if (!availability.allowed) {
    state.message = availability.message;
    return false;
  }
  const startedDay = state.day;
  state.expeditionSerial += 1;
  const params = typeof window === "undefined" ? undefined : new URLSearchParams(window.location.search);
  const querySeed = Number.parseInt(params?.get("dungeonSeed") ?? "", 10);
  const queryFloor = Number.parseInt(params?.get("dungeonFloor") ?? "", 10);
  const seed = Number.isFinite(querySeed) && querySeed > 0
    ? querySeed
    : Math.imul(startedDay, 104729) ^ Math.imul(state.expeditionSerial, 0x9e3779b1);
  const floor = Number.isFinite(queryFloor) ? Math.min(DUNGEON_MAX_FLOOR, Math.max(1, queryFloor)) : 1;
  const themePoolIds = snapshotDungeonThemePool();
  state.lastExpeditionDay = startedDay;
  state.location = "dungeon";
  state.run = buildRun(state, floor, seed, undefined, floor, {}, startedDay, themePoolIds);
  markExplored(state.run);
  if (state.escortCommission?.status === "accepted" && state.escortCommission.npcId) {
    state.escortCommission.status = "active";
    const npc = state.npcs.find((entry) => entry.id === state.escortCommission?.npcId);
    if (npc) {
      npc.status = "escorting";
      const profile = ensureGuardProfile(state, npc);
      profile.career.hireCount += 1;
      profile.career.deepestFloor = Math.max(profile.career.deepestFloor, floor);
      recordGuardEvent(state, npc, "hired", `地下迷宮の護衛を開始`, floor);
      recordGearDeed(state, npc, { floor });
    }
  }
  advanceTime(state, 1);
  state.message = state.run.guard
    ? `${activeGuardName(state, state.run.guard.guardId)}とダンジョンへ入った。護衛は同じ隊列で敵を自動的にカバーする。`
    : "ダンジョンへ入った。Spaceで正面の敵を攻撃し、Qで押し返せる。";
  return true;
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

function restoreFloor(snapshot: import("./types").DungeonFloorSnapshot, seed: number, floorStates: NonNullable<DungeonRun["floorStates"]>, highestFloor: number, player: Vec, carriedGuard: ActiveGuard | undefined, timeUnits: number, settledTimeBands: number, startedDay: number, themePoolIds: string[], themeScheduleVersion: 1): DungeonRun {
  const restored = clone(snapshot);
  return {
    ...restored, seed, startedDay, themePoolIds: [...themePoolIds], themeScheduleVersion,
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

export function assessGuardDescent(state: GameState, nextFloor: number): GuardDescentAssessment | undefined {
  const guard = state.run?.guard;
  if (!guard) return undefined;
  const npc = state.npcs.find((entry) => entry.id === guard.guardId);
  if (!npc) return undefined;
  const profile = ensureGuardProfile(state, npc);
  const recommended = ADVENTURER_RANKS[npc.rank ?? "E"].recommendedFloor;
  const excess = Math.max(0, nextFloor - recommended);
  if (excess === 0) return { severity: "allow", guardId: guard.guardId, nextFloor, risk: 0, reason: "この護衛の推奨範囲内だ。" };
  const missingPercent = (hp: number, maxHp: number): number => Math.max(0, Math.min(100, (1 - hp / Math.max(1, maxHp)) * 100));
  const guardMissing = missingPercent(guard.hp, guard.maxHp);
  const playerMissing = missingPercent(state.hp, state.maxHp);
  const risk = excess * 25
    + guardMissing * 0.25
    + playerMissing * 0.15
    + profile.stress * 0.2
    + (state.provisions < 2 ? 15 : 0)
    - profile.personality.courage * 0.2
    - profile.trust * 0.1;
  const severity = risk >= 50 ? "refuse" : risk >= 15 ? "warn" : "allow";
  const reason = severity === "refuse"
    ? `${npc.name}は地下${nextFloor}階への同行を拒んでいる。`
    : severity === "warn"
      ? `${npc.name}は地下${nextFloor}階への降下に強い懸念を示している。`
      : `${npc.name}は警戒しながらも同行するつもりだ。`;
  return { severity, guardId: guard.guardId, nextFloor, risk, reason };
}

export function descend(state: GameState): void {
  foldStallBeforeLeaving(state);
  const run = state.run;
  if (!run) return;
  if (!run.map.stairsDown) {
    state.message = "この階に下り階段はない。";
    return;
  }
  if (run.floor >= DUNGEON_MAX_FLOOR && dungeonGenerationMode() !== "manual") {
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
    ? restoreFloor(previous, run.seed, floorStates, highestFloor, previous.map.stairsUp, run.guard, run.timeUnits, run.settledTimeBands, run.startedDay, run.themePoolIds, run.themeScheduleVersion)
    : buildRun(state, nextFloor, run.seed, run.guard ?? null, highestFloor, floorStates, run.startedDay, run.themePoolIds);
  state.run.timeUnits = run.timeUnits;
  state.run.settledTimeBands = run.settledTimeBands;
  if (state.run.guard) {
    const npc = state.npcs.find((entry) => entry.id === state.run?.guard?.guardId);
    if (npc) {
      const profile = ensureGuardProfile(state, npc);
      profile.career.deepestFloor = Math.max(profile.career.deepestFloor, nextFloor);
      recordGearDeed(state, npc, { floor: nextFloor });
    }
  }
  markExplored(state.run);
  state.message = `地下${nextFloor}階へ降りた。`;
}

export function ascend(state: GameState): void {
  foldStallBeforeLeaving(state);
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
    state.run = restoreFloor(previous, run.seed, floorStates, run.highestFloor, landing, run.guard, run.timeUnits, run.settledTimeBands, run.startedDay, run.themePoolIds, run.themeScheduleVersion);
  } else {
    state.run = buildRun(state, nextFloor, run.seed, run.guard ?? null, run.highestFloor, floorStates, run.startedDay, run.themePoolIds);
    state.run.player = { ...(state.run.map.stairsDown ?? state.run.map.stairsUp) };
    if (state.run.guard) state.run.guard.pos = { ...state.run.player };
    state.run.timeUnits = run.timeUnits;
    state.run.settledTimeBands = run.settledTimeBands;
  }
  markExplored(state.run);
  state.message = `地下${nextFloor}階へ上がった。`;
}

/**
 * 深手を負った護衛が何を選ぶか。
 *
 * 下がるのが正しい。ここで退かなければ、次に死ぬのはこの護衛自身である。だから
 * **踏みとどまるのは合理ではなく人柄**で、置いて逃げるのもまた人柄である。
 * 商人には止める手立てが無い —— 下がらせれば、次に死ぬのは商人のほうだからだ。
 */
function resolveGuardStand(state: GameState, guard: ActiveGuard, guardNpc: NpcRecord | undefined, events: DungeonEvent[]): void {
  const run = state.run;
  if (!run) return;
  const name = activeGuardName(state, guard.guardId);
  const profile = guardNpc ? ensureGuardProfile(state, guardNpc) : undefined;
  const stand = profile ? guardStand(profile) : "retreat";

  if (stand === "hold") {
    // 踏みとどまる者には何も起きない。covering のまま、HPが尽きるまで前に立ち続ける。
    state.message = `${name}は傷を負いながら、なお前から動かない。`;
    return;
  }

  if (stand === "flee") {
    if (guardNpc && profile) {
      // 逃げ切った本人は生きている。失うのは信用のほうで、それはギルドの掲示に残る。
      guardNpc.status = "inTown";
      profile.career.abandonCount += 1;
      adjustGuardProfile(profile, -45, 25);
      recordGuardEvent(state, guardNpc, "abandoned", `地下${run.floor}階で契約を捨てて逃げた`, run.floor);
      recordBond(state, guardNpc, "abandoned", `地下${run.floor}階に置き去りにされた`, run.floor);
    }
    guard.mode = "fled";
    events.push({ type: "guardMode", guardId: guard.guardId, mode: "fled" });
    // 護衛料は返らない。契約そのものがここで消える。
    run.guard = undefined;
    state.hiredGuardId = undefined;
    state.hiredGuardFee = undefined;
    state.escortCommission = undefined;
    state.message = `${name}は武器を捨てて出口へ走った。地下${run.floor}階に、ひとり取り残された。`;
    return;
  }

  guard.mode = "retreated";
  guard.safeTurns = 0;
  guard.retreatCount += 1;
  if (guardNpc && profile) {
    profile.career.retreatCount += 1;
    adjustGuardProfile(profile, 0, 8);
    recordGuardEvent(state, guardNpc, "retreated", `HP${guard.hp}で後退`, run.floor);
  }
  events.push({ type: "guardMode", guardId: guard.guardId, mode: "retreated" });
  state.message = `${name}は危険を感じ、隊列の後方へ下がった。`;
}

function guardPhase(state: GameState, events: DungeonEvent[]): void {
  const run = state.run;
  const guard = run?.guard;
  if (!run || !guard) return;
  guard.pos = { ...run.player };
  if (guard.mode !== "covering") return;
  const npc = state.npcs.find((entry) => entry.id === guard.guardId);
  const profile = npc ? ensureGuardProfile(state, npc) : undefined;
  const discipline = profile?.personality.discipline ?? 50;
  const adjacent = run.enemies
    .filter((enemy) => distance(enemy.pos, run.player) === 1)
    .sort((a, b) => {
      const aKillable = Number(a.hp <= guard.damage);
      const bKillable = Number(b.hp <= guard.damage);
      if (discipline >= 65) return bKillable - aKillable || b.damage - a.damage || a.hp - b.hp || a.id.localeCompare(b.id);
      if (discipline <= 35) return a.hp - b.hp || b.damage - a.damage || a.id.localeCompare(b.id);
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
      if (npc && profile) {
        profile.career.enemiesDefeated += 1;
        recordGuardEvent(state, npc, "kill", `${target.name}を倒した`, run.floor);
        recordGearDeed(state, npc, { kills: 1 });
      }
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
  return nextDungeonStep(run.map, from, target, blocked, rng.int(0, 3));
}

/** 敵を倒した後も、その冒険者自身の探索は続く。重傷者だけはその場で休ませる。 */
function patrolAdventurer(adventurer: DungeonAdventurer, run: DungeonRun, rng: Rng): Vec {
  // 商人の隣は会話・取引・通せんぼが起こる場所なので、その場で応対する。
  // それ以外では、敵を倒した後も立ち尽くさず探索を再開する。
  if (distance(adventurer.pos, run.player) <= 1) return adventurer.pos;
  if (adventurer.hp <= adventurer.maxHp * 0.35) return adventurer.pos;
  const blocked = [
    run.player,
    ...run.enemies.map((enemy) => enemy.pos),
    ...(run.stall?.slots.map((slot) => slot.pos) ?? []),
    ...run.adventurers.filter((other) => other.npcId !== adventurer.npcId).map((other) => other.pos),
  ];
  const directions = [...Object.values(DIRECTION)].sort(() => rng.next() - 0.5);
  return directions
    .map((direction) => ({ x: adventurer.pos.x + direction.x, y: adventurer.pos.y + direction.y }))
    .find((next) => canTraverse(run.map, adventurer.pos, next) && !blocked.some((pos) => samePosition(pos, next)))
    ?? adventurer.pos;
}

function adventurerPhase(state: GameState, events: DungeonEvent[]): void {
  const run = state.run;
  if (!run) return;
  const rng = new Rng(run.seed + run.turn * 53 + run.floor * 11);
  for (const adventurer of [...run.adventurers]) {
    if (consumeNpcMedicine(state, adventurer)) continue;
    // 露店が開いていて、敵が隣にいないなら、戦うより先に品を見に来る。
    const counter = stallAttraction(state, adventurer);
    if (counter) {
      if (distance(counter, adventurer.pos) <= 1) continue;
      const from = { ...adventurer.pos };
      const blocked = [run.player, ...run.enemies.map((enemy) => enemy.pos), ...(run.stall?.slots.map((slot) => slot.pos) ?? []), ...run.adventurers.filter((other) => other.npcId !== adventurer.npcId).map((other) => other.pos)];
      adventurer.pos = moveToward(adventurer.pos, counter, run, blocked, rng);
      if (!samePosition(from, adventurer.pos)) events.push({ type: "move", actorId: adventurer.npcId, from, to: { ...adventurer.pos } });
      continue;
    }
    const target = [...run.enemies]
      .sort((a, b) => distance(a.pos, adventurer.pos) - distance(b.pos, adventurer.pos) || a.hp - b.hp)[0];
    if (!target) {
      const from = { ...adventurer.pos };
      adventurer.pos = patrolAdventurer(adventurer, run, rng);
      if (!samePosition(from, adventurer.pos)) events.push({ type: "move", actorId: adventurer.npcId, from, to: { ...adventurer.pos } });
      continue;
    }
    if (distance(target.pos, adventurer.pos) === 1) {
      target.hp -= adventurer.damage;
      events.push({ type: "attack", attackerId: adventurer.npcId, targetId: target.id, damage: adventurer.damage });
      state.message = `${adventurerName(state, adventurer.npcId)}が${target.name}へ${adventurer.damage}ダメージ。`;
      if (target.hp <= 0) {
        run.enemies = run.enemies.filter((enemy) => enemy.id !== target.id);
        events.push({ type: "defeated", actorId: target.id, pos: { ...target.pos } });
        // 同行者の撃破はこれまで何も記録されていなかった。経歴イベントは護衛の分だけなので、
        // ここでは数と、担いだ武器の功績だけを数える。
        const slayer = state.npcs.find((entry) => entry.id === adventurer.npcId);
        if (slayer) {
          ensureGuardProfile(state, slayer).career.enemiesDefeated += 1;
          recordGearDeed(state, slayer, { kills: 1 });
        }
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
  const seesTarget = hasDungeonVision(run.map, enemy.pos, target);
  if (seesTarget) {
    enemy.state = "chase";
    enemy.target = { ...target };
  } else if (enemy.state === "chase") {
    enemy.state = "search";
  }
  const blocked = [run.player, ...run.enemies.filter((other) => other.id !== enemy.id).map((other) => other.pos), ...run.adventurers.map((adventurer) => adventurer.pos)];
  if ((enemy.state === "chase" || enemy.state === "search") && enemy.target) {
    if (enemy.state === "search" && samePosition(enemy.pos, enemy.target)) {
      enemy.state = "patrol";
      delete enemy.target;
      return;
    }
    enemy.pos = nextDungeonStep(run.map, enemy.pos, enemy.target, blocked, rng.int(0, 3));
    return;
  }
  const directions = [...Object.values(DIRECTION)].sort(() => rng.next() - 0.5);
  for (const direction of directions) {
    const next = { x: enemy.pos.x + direction.x, y: enemy.pos.y + direction.y };
    if (canTraverse(run.map, enemy.pos, next) && !blocked.some((pos) => samePosition(pos, next))) { enemy.pos = next; break; }
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
      // 主人公は playerDefensePower を引いて受けるのに、護衛だけ生で受けていた。
      // 敵のダメージは全種1か2で0が無いため、防具なしなら Math.max(1, d - 0) は恒等になる。
      const incoming = Math.max(1, enemy.damage - (guard.defense ?? 0));
      const covered = Math.min(guard.hp, incoming);
      guard.hp -= incoming;
      events.push({ type: "attack", attackerId: enemy.id, targetId: guard.guardId, damage: incoming });
      const guardNpc = state.npcs.find((entry) => entry.id === guard.guardId);
      if (guardNpc) {
        const profile = ensureGuardProfile(state, guardNpc);
        profile.career.damageCovered += covered;
        recordGuardEvent(state, guardNpc, "covered", `${enemy.name}から${covered}ダメージを肩代わり`, run.floor);
      }
      state.message = `${enemy.name}が${activeGuardName(state, guard.guardId)}へ${incoming}ダメージ。`;
      if (guard.hp <= 0) {
        const npc = guardNpc;
        if (npc) {
          npc.status = "dead";
          const profile = ensureGuardProfile(state, npc);
          profile.career.deathDay = state.day;
          profile.career.deathFloor = run.floor;
          recordGuardEvent(state, npc, "died", `地下${run.floor}階で死亡`, run.floor);
          recordBond(state, npc, "lost", `護衛の契約中に地下${run.floor}階で死亡した`, run.floor);
          // 遺銘は品がまだ引ける今のうちに刻む。預かりの記録だけ外し、品は遺体へ流す。
          recordGearDeed(state, npc, { died: true });
          delete npc.gear;
          const loot = npc.inventoryIds.map((id) => state.itemsById[id]).filter((item): item is ItemInstance => Boolean(item));
          for (const item of loot) {
            item.location = { kind: "corpse", npcId: npc.id, floor: run.floor };
            item.historyV2 ??= [];
            item.historyV2.push({ day: state.day, type: "ownerDied", npcId: npc.id, detail: `${npc.name}が地下${run.floor}階で死亡` });
          }
          run.bodies.push({ id: `body-${npc.id}`, npcId: npc.id, name: `冒険者${npc.name}`, pos: { ...guard.pos }, loot, inspected: false });
          recordCorpse(state, npc.id, run.floor, loot.map((item) => item.uuid), true);
        }
        events.push({ type: "defeated", actorId: guard.guardId, pos: { ...guard.pos } });
        state.message = npc ? `${npc.name}は死亡し、その場に所持品を残した。` : `${activeGuardName(state, guard.guardId)}は倒れた。`;
        run.guard = undefined;
      } else if (guard.hp <= guardRetreatThreshold(state, guard)) {
        resolveGuardStand(state, guard, guardNpc, events);
      }
      continue;
    }
    const adjacentAdventurer = run.adventurers.find((adventurer) => distance(enemy.pos, adventurer.pos) === 1);
    if (adjacentAdventurer) {
      const dealt = Math.max(1, enemy.damage - (adjacentAdventurer.defense ?? 0));
      adjacentAdventurer.hp -= dealt;
      events.push({ type: "attack", attackerId: enemy.id, targetId: adjacentAdventurer.npcId, damage: dealt });
      state.message = `${enemy.name}が${adventurerName(state, adjacentAdventurer.npcId)}へ${dealt}ダメージ。`;
      if (adjacentAdventurer.hp <= 0) defeatDungeonAdventurer(state, adjacentAdventurer, events);
      continue;
    }
    if (distance(enemy.pos, run.player) === 1) {
      // 商人は防具を着けない。護衛が退いた先にあるのは、素で受ける敵の一撃である。
      const damage = enemy.damage;
      state.hp -= damage;
      events.push({ type: "attack", attackerId: enemy.id, targetId: "player", damage });
      state.message = `${enemy.name}の攻撃。${damage}ダメージ。`;
      if (state.hp <= 0) {
        recoverMerchantAfterDeath(state, `${enemy.name}の攻撃で倒れた。`);
        break;
      }
      continue;
    }
    const from = { ...enemy.pos };
    const targets = [run.player, ...run.adventurers.map((adventurer) => adventurer.pos)];
    const visibleTargets = targets.filter((candidate) => hasDungeonVision(run.map, enemy.pos, candidate));
    const target = [...visibleTargets].sort((a, b) => distance(enemy.pos, a) - distance(enemy.pos, b))[0] ?? run.player;
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
  recordGearDeed(state, npc, { died: true });
  delete npc.gear;
  const loot = npc.inventoryIds.map((id) => state.itemsById[id]).filter((item): item is ItemInstance => Boolean(item));
  for (const item of loot) {
    item.location = { kind: "corpse", npcId: npc.id, floor: run.floor };
    item.historyV2 ??= [];
    item.historyV2.push({ day: state.day, type: "ownerDied", npcId: npc.id, detail: `${npc.name}が地下${run.floor}階で死亡` });
  }
  run.bodies.push({ id: `body-${npc.id}`, npcId: npc.id, name: `冒険者${npc.name}`, pos: { ...adventurer.pos }, loot, inspected: false });
  recordCorpse(state, npc.id, run.floor, loot.map((item) => item.uuid), true);
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
  const requiredSafeTurns = guardRecoveryTurns(state, guard.guardId);
  if (guard.safeTurns < requiredSafeTurns) return;
  guard.mode = "covering";
  guard.safeTurns = 0;
  events.push({ type: "guardMode", guardId: guard.guardId, mode: "covering" });
  state.message = `${activeGuardName(state, guard.guardId)}は周囲の安全を確認し、カバーへ戻った。`;
}

function finishTurn(state: GameState, events: DungeonEvent[], decrementCooldown = true): TurnResult {
  const run = state.run;
  if (!run) return { consumedTurn: true, events };
  markExplored(run);
  if (decrementCooldown && run.shoveCooldown > 0) run.shoveCooldown -= 1;
  guardPhase(state, events);
  // 護衛が何を考えているかは、戦いのあとに出る。要求は次の手番へ持ち越される。
  const demand = betrayalPhase(state, events);
  adventurerPhase(state, events);
  // 階へ人が出入りし、居合わせた誰かが荷に目をつける。護衛の裏切りとは別の危険で、
  // 同時に、それを止めてくれる唯一のものでもある。
  const holdup = trafficPhase(state, events, () => trafficArrivalCell(state));
  // 客をさばくのは敵が動く前。傷ついた相手が薬を買って、その足で戦いに戻れる。
  stallPhase(state, events, () => drawDelverToFloor(state));
  enemyPhase(state, events);
  updateGuardRecovery(state, events);
  if (state.run) {
    // 敵の手番で押し出されることがあるので、行動の前後どちらでも見た場所を拾う。
    state.run.turn += 1;
    markExplored(state.run);
    consumeDungeonTime(state, 1);
  }
  if (demand) return { consumedTurn: true, events, guardDemand: demand };
  if (holdup) return { consumedTurn: true, events, holdup };
  return { consumedTurn: true, events };
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
  if (currentItemCount(state) < bagCapacity(state)) return undefined;
  if (!swapOutId) return null;
  const swap = state.inventory.find((item) => item.uuid === swapOutId);
  if (!swap) return null;
  return swap;
}

/**
 * 鞄の中で、この品を受け入れられる束。
 *
 * 束ねられるのは素材だけで、床から拾う品は必ず1個ずつなので、空きのある束を一つ探せば足りる。
 */
function stackTarget(state: GameState, incoming: ItemInstance): ItemInstance | undefined {
  const limit = stackLimit(incoming);
  if (limit <= 1) return undefined;
  return state.inventory.find((entry) =>
    entry.definitionId === incoming.definitionId
    && !entry.currentName
    && itemCount(entry) + itemCount(incoming) <= limit);
}

function carryItem(state: GameState, incoming: ItemInstance, swapOutId: string | undefined, onSwap: (item: ItemInstance) => void): boolean {
  // 束へ合流するなら枠を新しく使わない。鞄が満杯でも入れ替えは要らない。
  const stack = stackTarget(state, incoming);
  if (stack) {
    stack.count = itemCount(stack) + itemCount(incoming);
    delete state.itemsById[incoming.uuid];
    return true;
  }
  const swap = swapCandidate(state, swapOutId);
  if (swap === null) {
    state.message = `${bagName(state)}が${bagCapacity(state)}個でいっぱいだ。1個置いて入れ替えよう。`;
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
  state.message = `${itemName(ground.item)}を拾った。所持数 ${currentItemCount(state)}/${bagCapacity(state)}`;
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
  if (chest.returnStone) state.returnStones += 1;
  const found = chest.returnStone
    ? `宝箱から${itemName(chest.item)}と帰還石を見つけた。帰還石は残り${state.returnStones}個。`
    : `宝箱から${itemName(chest.item)}を見つけた。`;
  state.message = found;
  const result = finishTurn(state, [{ type: "pickup", itemId: chest.item.uuid }]);
  // 希少品の発見は同じターンの戦闘ログで流さず、必ず読ませる。
  if (chest.returnStone) state.message = found;
  return result;
}

function performInspectBody(state: GameState, bodyId: string): TurnResult {
  const run = state.run;
  const body = run?.bodies.find((entry) => entry.id === bodyId && samePosition(entry.pos, run.player));
  if (!run || !body) return emptyResult();
  if (body.inspected) return emptyResult();
  body.inspected = true;
  if (body.npcId) markCorpseInspected(state, body.npcId);
  const deadNpc = body.npcId ? state.npcs.find((npc) => npc.id === body.npcId) : undefined;
  const entrusted = body.loot.find((item) => wasEntrusted(item));
  const found = entrusted
    ? `${deadNpc?.name ?? "冒険者"}だ。あなたが預けた${itemName(entrusted)}が、まだ握られている。`
    : deadNpc
      ? `${deadNpc.name}という冒険者だ。${body.loot.length}個の所持品が残されている。`
      : "古い遺体だ。身元を示す物は残っていない。";
  state.message = found;
  const result = finishTurn(state, [{ type: "message", text: found }]);
  // 遺体を検めた場面も、同じターンの戦闘ログに流させない。回収時と同じ扱いにする。
  if (entrusted) state.message = found;
  return result;
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
    if (npc) recordBond(state, npc, "looted", `${itemName(item)}を遺体から引き取った`, run.floor);
    removeCorpseLoot(state, npcId, item.uuid);
  }
  item.history.push({ day: state.day, type: "recovered", detail: `${body.name}の遺品として回収` });
  // 手に取った時に遺銘が刻まれる。持ち主を喪ったことが、ここで名前になる。
  const owner = npcId ? state.npcs.find((entry) => entry.id === npcId) : undefined;
  refreshItemLegend(state, item, owner);
  const entrusted = wasEntrusted(item);
  const recovered = entrusted
    ? `${body.name}から${itemName(item)}を取り戻した。この銘は、あの人が刻ませたものだ。`
    : `${body.name}から${itemName(item)}を回収した。`;
  state.message = recovered;
  const result = finishTurn(state, [{ type: "pickup", itemId: item.uuid }]);
  // 託した品を取り戻す場面は、同じターンの戦闘ログに流させない。
  if (entrusted) state.message = recovered;
  return result;
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
  if (item && itemCharges(item) <= 0) {
    state.message = `${itemName(item)}はもう空だ。`;
    return emptyResult();
  }
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
  // 回数のある薬は、使っても残量を抱えて鞄に残る。深層の薬が強いのは量ではなく回数である。
  const remaining = itemCharges(item) - 1;
  if (remaining > 0) item.chargesLeft = remaining;
  else {
    item.chargesLeft = 0;
    state.inventory = state.inventory.filter((entry) => entry.uuid !== item.uuid);
    unequipIfNeeded(state, item.uuid);
    item.location = { kind: "consumed", actorId: guard?.guardId ?? "player" };
  }
  if (guard) {
    const npc = state.npcs.find((entry) => entry.id === guard.guardId);
    if (npc) {
      const profile = ensureGuardProfile(state, npc);
      const trustGain = Math.min(2, Math.max(0, 4 - guard.healingTrustGained));
      guard.healingTrustGained += trustGain;
      adjustGuardProfile(profile, trustGain, 0);
      recordGuardEvent(state, npc, "healed", `${itemName(item)}でHPを${recovered}回復`, state.run?.floor);
    }
  }
  state.message = `${itemName(item)}を${guard ? activeGuardName(state, guard.guardId) : "自分"}に使い、HPを${recovered}回復した。`;
  return finishTurn(state, [{ type: "message", text: state.message }]);
}

export function dungeonAdventurerSellPrice(item: ItemInstance): number {
  return Math.max(1, Math.ceil(itemDefinition(item).baseValue * 0.8 * itemCount(item)));
}

export function dungeonAdventurerBuyPrice(item: ItemInstance): number {
  return Math.max(1, Math.floor(itemDefinition(item).baseValue * 0.6 * itemCount(item)));
}

/** 浅層には余裕があり、3階を越えてから食料需要が段階的に増える。 */
export function dungeonProvisionDemand(floor: number): number {
  return Math.min(7, difficultyZone(floor));
}

export function dungeonProvisionDemandRemaining(adventurer: DungeonAdventurer, floor: number): number {
  return Math.max(0, dungeonProvisionDemand(floor) - (adventurer.provisionsBought ?? 0));
}

/** 食品商の15Gを基準に、3階ごとの運搬距離を価格へ乗せる。 */
export function dungeonProvisionBuyPrice(floor: number): number {
  return Math.round(15 * (1 + difficultyZone(floor) * 0.6));
}

/** 深層ほど、軽傷のうちに薬を確保しようとする。 */
export function dungeonMedicineNeedRatio(floor: number): number {
  return Math.min(0.9, 0.4 + difficultyZone(floor) * 0.06);
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
  recordBond(state, npc, "traded", `${itemName(item)}を${price}Gで買い取った`, state.run?.floor);
  state.message = `${npc.name}から${itemName(item)}を${price}Gで買った。`;
  return finishTurn(state, [{ type: "pickup", itemId: item.uuid }]);
}

/** 傷が深いほど、回復品は言い値で通る。ここが迷宮と店の決定的な違いである。 */
export function isDesperateFor(adventurer: DungeonAdventurer, item: ItemInstance, floor = 1): boolean {
  return adventurer.hp < adventurer.maxHp * dungeonMedicineNeedRatio(floor) && (itemDefinition(item).healing ?? 0) > 0;
}

/** 迷宮で提案できる最高額。他に店が無いぶん、桁が変わる。 */
export function dungeonAskingCeiling(item: ItemInstance): number {
  return dungeonAdventurerBuyPrice(item) * DUNGEON_PRICE_CEILING;
}

function performSellToAdventurer(state: GameState, npcId: string, itemId: string, asking?: number): TurnResult {
  const adventurer = nearbyAdventurer(state, npcId);
  const npc = state.npcs.find((entry) => entry.id === npcId);
  const item = state.inventory.find((entry) => entry.uuid === itemId);
  if (!adventurer || !npc || !item) return emptyResult();
  const floor = state.run?.floor ?? 1;
  const needsMedicine = isDesperateFor(adventurer, item, floor);
  // 買う理由が無ければ売れない。ただし本当に傷ついていれば、薬だけは理由を問わない。
  if (!wantsItem(npc, item) && !needsMedicine) { state.message = `${npc.name}はその品を探していない。`; return emptyResult(); }
  const baseline = dungeonAdventurerBuyPrice(item);
  const price = Math.max(1, Math.min(Math.round(asking ?? baseline), dungeonAskingCeiling(item)));
  const desperate = isDesperateFor(adventurer, item, floor);
  const profile = npc.guardProfile ?? ensureGuardProfile(state, npc);
  const verdict = dungeonVerdict(npc, price, baseline, adventurer.gold, desperate, profile.personality);
  if (verdict.reaction === "refuse") {
    state.message = verdict.line;
    return emptyResult();
  }
  state.inventory = state.inventory.filter((entry) => entry.uuid !== item.uuid);
  unequipIfNeeded(state, item.uuid);
  state.gold += price;
  adventurer.gold -= price;
  npc.inventoryIds.push(item.uuid);
  item.owner = npc.id;
  item.location = { kind: "npcInventory", npcId: npc.id };
  item.history.push({ day: state.day, type: "sold", detail: `${npc.name}へダンジョン内で売却`, value: price });
  // 同じ取引でも、相手の受け取り方で残るものが変わる。
  if (verdict.sentiment === "resented") {
    recordBond(state, npc, "gouged", `${itemName(item)}を${price}Gで買わされた`, floor);
    adjustGuardProfile(profile, -8);
    npc.relation = Math.max(-100, npc.relation - 6);
  } else if (verdict.sentiment === "grateful") {
    // 命の重さを知っている相手は、危ないところまで品を担いできた事実のほうを見る。
    recordBond(state, npc, "aided", `${itemName(item)}を${price}Gで譲り、窮地を救った`, floor);
    adjustGuardProfile(profile, 4);
  } else if (desperate && verdict.sentiment === "fair") {
    recordBond(state, npc, "aided", `${itemName(item)}を${price}Gで譲り、窮地を救った`, floor);
  } else {
    recordBond(state, npc, "traded", `${itemName(item)}を${price}Gで売った`, floor);
  }
  const sold = `${npc.name}へ${itemName(item)}を${price}Gで売った。${verdict.line}`;
  state.message = sold;
  const result = finishTurn(state, [{ type: "message", text: sold }]);
  // 足元を見た商いは、同じターンの戦闘ログに流させない。恨みが生まれた場面は必ず読ませる。
  if (verdict.sentiment !== "fair") state.message = sold;
  return result;
}

function performSellProvisionsToAdventurer(state: GameState, npcId: string, asking?: number): TurnResult {
  const adventurer = nearbyAdventurer(state, npcId);
  const npc = state.npcs.find((entry) => entry.id === npcId);
  const floor = state.run?.floor ?? 1;
  if (!adventurer || !npc) return emptyResult();
  const remaining = dungeonProvisionDemandRemaining(adventurer, floor);
  if (remaining <= 0) { state.message = `${npc.name}はこの階を抜けるぶんの食料を確保している。`; return emptyResult(); }
  if (state.provisions <= 0) { state.message = "売れる携行食料を持っていない。"; return emptyResult(); }
  const baseline = dungeonProvisionBuyPrice(floor);
  const unitPrice = Math.max(1, Math.min(Math.round(asking ?? baseline), baseline * DUNGEON_PRICE_CEILING));
  const desperate = dungeonProvisionDemand(floor) >= 3;
  const profile = npc.guardProfile ?? ensureGuardProfile(state, npc);
  const verdict = dungeonVerdict(npc, unitPrice, baseline, adventurer.gold, desperate, profile.personality);
  if (verdict.reaction === "refuse") {
    state.message = verdict.line;
    return emptyResult();
  }
  const quantity = Math.min(state.provisions, remaining, Math.floor(adventurer.gold / unitPrice));
  if (quantity <= 0) { state.message = `${npc.name}は食料代を支払えない。`; return emptyResult(); }
  const total = unitPrice * quantity;
  state.provisions -= quantity;
  state.gold += total;
  adventurer.gold -= total;
  adventurer.provisionsBought = (adventurer.provisionsBought ?? 0) + quantity;
  if (verdict.sentiment === "resented") {
    recordBond(state, npc, "gouged", `地下${floor}階で携行食料${quantity}個を${total}Gで買わされた`, floor);
    adjustGuardProfile(profile, -6);
    npc.relation = Math.max(-100, npc.relation - 4);
  } else if (verdict.sentiment === "grateful") {
    recordBond(state, npc, "aided", `地下${floor}階で携行食料${quantity}個を届けてもらった`, floor);
    adjustGuardProfile(profile, 3);
  } else {
    recordBond(state, npc, "traded", `地下${floor}階で携行食料${quantity}個を${total}Gで買った`, floor);
  }
  const sold = `${npc.name}へ携行食料を${quantity}個、計${total}Gで売った。${verdict.line}`;
  state.message = sold;
  const result = finishTurn(state, [{ type: "message", text: sold }]);
  if (verdict.sentiment !== "fair") state.message = sold;
  return result;
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

function dismissGuardForDescent(state: GameState): string | undefined {
  const guard = state.run?.guard;
  if (!guard) return undefined;
  const npc = state.npcs.find((entry) => entry.id === guard.guardId);
  if (npc) {
    const profile = ensureGuardProfile(state, npc);
    profile.career.earlyDepartures += 1;
    adjustGuardProfile(profile, -5, 0);
    recordGuardEvent(state, npc, "leftEarly", `深層への同行を断り単独帰還`, state.run?.floor);
    if (npc.status !== "dead") npc.status = badlyHurt(guard.hp, guard.maxHp) ? "recovering" : "inTown";
    if (npc.status === "recovering") npc.conditionHp = guard.hp;
  }
  state.run!.guard = undefined;
  state.hiredGuardId = undefined;
  state.hiredGuardFee = undefined;
  state.escortCommission = undefined;
  return npc?.name;
}

/** 階を移る前と帰る前に風呂敷を畳む。品は鞄にあるので、置き去りにはならない。 */
function foldStallBeforeLeaving(state: GameState): void {
  if (state.run?.stall) closeStall(state, []);
}

function performStairs(state: GameState, guardResponse?: "continue" | "dismiss"): TurnResult {
  const run = state.run;
  if (!run) return emptyResult();
  if (run.map.stairsDown && samePosition(run.player, run.map.stairsDown)) {
    const assessment = assessGuardDescent(state, run.floor + 1);
    if (assessment?.severity === "warn" && guardResponse !== "continue") {
      state.message = assessment.reason;
      return { consumedTurn: false, events: [], guardDescent: assessment };
    }
    if (assessment?.severity === "refuse" && guardResponse !== "dismiss") {
      state.message = assessment.reason;
      return { consumedTurn: false, events: [], guardDescent: assessment };
    }
    let dismissedName: string | undefined;
    if (assessment?.severity === "warn" && guardResponse === "continue") {
      const npc = state.npcs.find((entry) => entry.id === assessment.guardId);
      if (npc) {
        const profile = ensureGuardProfile(state, npc);
        profile.career.warningsIgnored += 1;
        adjustGuardProfile(profile, -2, 5);
        recordGuardEvent(state, npc, "warningIgnored", `地下${assessment.nextFloor}階への警告を押して同行`, assessment.nextFloor);
      }
    } else if (assessment?.severity === "refuse" && guardResponse === "dismiss") {
      dismissedName = dismissGuardForDescent(state);
    }
    consumeDungeonTime(state, 1);
    if (!state.run || state.location !== "dungeon") return { consumedTurn: true, events: [{ type: "message", text: state.message }] };
    descend(state);
    if (dismissedName) state.message = `${dismissedName}を町へ帰し、ひとりで地下${state.run?.floor ?? assessment?.nextFloor}階へ降りた。`;
    return { consumedTurn: true, events: [{ type: "message", text: state.message }] };
  }
  if (samePosition(run.player, run.map.stairsUp)) {
    consumeDungeonTime(state, 1);
    if (!state.run || state.location !== "dungeon") return { consumedTurn: true, events: [{ type: "message", text: state.message }] };
    ascend(state);
    return { consumedTurn: true, events: [{ type: "message", text: state.message }] };
  }
  state.message = "階段はここにはない。";
  return emptyResult();
}

/**
 * 噂を聞いて寄ってくる一人。
 *
 * 名簿から借りるだけで、鋳造はしない。今日その深さへ潜っている誰かが、
 * 品物が並んでいると聞いて足を向けた —— という筋である。
 */
function drawDelverToFloor(state: GameState): boolean {
  const run = state.run;
  if (!run) return false;
  const placed = new Set(run.adventurers.map((entry) => entry.npcId));
  const candidate = selectFloorDelvers(state, run.floor, placed).find((npc) => !placed.has(npc.id));
  if (!candidate) return false;
  const occupied = [
    run.player,
    ...run.enemies.map((enemy) => enemy.pos),
    ...run.adventurers.map((entry) => entry.pos),
    ...(run.stall?.slots.map((slot) => slot.pos) ?? []),
  ];
  const rng = new Rng(run.seed + run.turn * 977 + run.floor * 31);
  // 露店のすぐ隣に湧かない。噂を聞いて歩いてくるのが見えるほうがいい。
  const pos = freeFloor(run.map, rng, occupied, [], (cell) => distance(cell, run.player) >= 4);
  const stats = npcCombatStats(state, candidate);
  run.adventurers.push({
    npcId: candidate.id,
    pos,
    hp: Math.max(1, Math.min(stats.maxHp, candidate.conditionHp ?? stats.maxHp)),
    maxHp: stats.maxHp,
    damage: stats.damage,
    defense: stats.defense,
    gold: Math.max(200, Math.floor(candidate.budget * 0.6)),
  });
  state.message = `${candidate.name}が、品が並んでいると聞いて近づいてくる。`;
  return true;
}

function performOpenStall(state: GameState, goods: ReadonlyArray<{ itemId: string; price: number }>): TurnResult {
  const events: DungeonEvent[] = [];
  if (!openStall(state, goods, events)) return emptyResult();
  return finishTurn(state, events);
}

function performCloseStall(state: GameState): TurnResult {
  const events: DungeonEvent[] = [];
  if (!closeStall(state, events)) return emptyResult();
  return finishTurn(state, events);
}

/** 往来で入ってくる人の立ち位置。商人から離れたところに現れ、歩いてくるのが見える。 */
function trafficArrivalCell(state: GameState): Vec | undefined {
  const run = state.run;
  if (!run) return undefined;
  const occupied = [
    run.player,
    ...run.enemies.map((enemy) => enemy.pos),
    ...run.adventurers.map((entry) => entry.pos),
    ...run.chests.map((chest) => chest.pos),
    ...run.bodies.map((body) => body.pos),
    ...(run.stall?.slots.map((slot) => slot.pos) ?? []),
  ];
  const rng = new Rng(run.seed + run.turn * 1543 + run.floor * 67);
  return freeFloor(run.map, rng, occupied, [], (cell) => distance(cell, run.player) >= 5);
}

function performAnswerHoldup(state: GameState, hand: boolean): TurnResult {
  const events: DungeonEvent[] = [];
  const answered = hand ? handOverToRobber(state, events) : refuseRobber(state);
  if (!answered) return emptyResult();
  return finishTurn(state, events.length ? events : [{ type: "message", text: state.message }]);
}

function performAnswerDemand(state: GameState, pay: boolean): TurnResult {
  const answered = pay ? payDemand(state) : refuseDemand(state);
  if (!answered) return emptyResult();
  return finishTurn(state, [{ type: "message", text: state.message }]);
}

export function performDungeonCommand(state: GameState, command: DungeonCommand): TurnResult {
  // 行く手を塞がれているあいだは、返事以外の何もできない。
  if (state.run?.demand && !state.run.demand.refused && command.type !== "answerDemand") {
    const name = state.npcs.find((npc) => npc.id === state.run?.demand?.guardId)?.name ?? "護衛";
    state.message = `${name}が行く手を塞いでいる。返事をするまで動けない。`;
    return emptyResult();
  }
  if (state.run?.holdup && !state.run.holdup.refused && command.type !== "answerHoldup") {
    const name = state.npcs.find((npc) => npc.id === state.run?.holdup?.npcId)?.name ?? "追いはぎ";
    state.message = `${name}が行く手に立っている。返事をするまで動けない。`;
    return emptyResult();
  }
  switch (command.type) {
    case "answerDemand": return performAnswerDemand(state, command.pay);
    case "answerHoldup": return performAnswerHoldup(state, command.hand);
    case "move": return performMove(state, command.direction);
    case "shove": return performShove(state, command.direction);
    case "wait":
      state.message = "息を整え、周囲の動きを見る。";
      return finishTurn(state, [{ type: "message", text: state.message }]);
    case "openStall": return performOpenStall(state, command.goods);
    case "closeStall": return performCloseStall(state);
    case "smoke": return performSmoke(state);
    case "return": return performReturnStone(state);
    case "pickup": return performPickup(state, command.swapOutId);
    case "openChest": return performOpenChest(state, command.chestId, command.swapOutId);
    case "inspectBody": return performInspectBody(state, command.bodyId);
    case "lootBody": return performLootBody(state, command.bodyId, command.itemId, command.swapOutId);
    case "drop": return performDrop(state, command.itemId);
    case "useMedicine": return performUseMedicine(state, command.itemId, command.target);
    case "buyFromAdventurer": return performBuyFromAdventurer(state, command.npcId, command.itemId, command.swapOutId);
    case "sellToAdventurer": return performSellToAdventurer(state, command.npcId, command.itemId, command.price);
    case "sellProvisionsToAdventurer": return performSellProvisionsToAdventurer(state, command.npcId, command.unitPrice);
    case "stairs": return performStairs(state, command.guardResponse);
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

export function tryStairs(state: GameState, guardResponse?: "continue" | "dismiss"): TurnResult {
  return performDungeonCommand(state, { type: "stairs", guardResponse });
}

/** Return stones use homeSpawn; the first-floor up stair arrives at dungeonEntrance. */
export function returnHome(state: GameState, arrival: "homeSpawn" | "dungeonEntrance" = "homeSpawn"): void {
  foldStallBeforeLeaving(state);
  const completedRun = state.run;
  if (completedRun) {
    const survivorIds = new Set([
      ...completedRun.adventurers.map((entry) => entry.npcId),
      ...Object.values(completedRun.floorStates).flatMap((floor) => floor.adventurers.map((entry) => entry.npcId)),
    ]);
    // 生還者を町へ戻すのは翌朝の町シミュレーション。ここでは負った傷だけ書き戻す。
    const woundedById = new Map<string, { hp: number; maxHp: number }>(
      [completedRun, ...Object.values(completedRun.floorStates)]
        .flatMap((floor) => floor.adventurers)
        .map((entry) => [entry.npcId, { hp: entry.hp, maxHp: entry.maxHp }]),
    );
    for (const npc of state.npcs) {
      if (!survivorIds.has(npc.id) || npc.status !== "delving") continue;
      const wounded = woundedById.get(npc.id);
      if (wounded && wounded.hp < wounded.maxHp) npc.conditionHp = wounded.hp;
    }
  }
  state.message = "家へ帰還した。棚の商品を並べ替え、次の護衛を指定できる。";
  if (completedRun?.guard) {
    const npc = state.npcs.find((entry) => entry.id === completedRun.guard?.guardId);
    if (npc && npc.status !== "dead") {
      npc.status = "inTown";
      npc.relation = Math.min(100, npc.relation + 1);
      const profile = ensureGuardProfile(state, npc);
      profile.career.successfulReturns += 1;
      profile.career.deepestFloor = Math.max(profile.career.deepestFloor, completedRun.highestFloor);
      adjustGuardProfile(profile, 8, -10);
      recordGuardEvent(state, npc, "returned", `地下${completedRun.highestFloor}階から契約を完遂して生還`, completedRun.highestFloor);
      recordBond(state, npc, "foughtTogether", `地下${completedRun.highestFloor}階まで護衛し、共に生還した`, completedRun.highestFloor);
      recordGearDeed(state, npc, { floor: completedRun.highestFloor, returned: true });
      // 疑う理由があってなお何もしなかった相手は、そのぶん信用が残る。
      rewardLoyalty(state, npc, completedRun.betrayalPeak, completedRun.demand?.refused === true);
      applySurvivalGrowth(state, npc, profile, completedRun.highestFloor);
      const guard = completedRun.guard;
      if (guard && badlyHurt(guard.hp, guard.maxHp)) {
        npc.status = "recovering";
        npc.conditionHp = guard.hp;
      } else delete npc.conditionHp;
    }
  }
  // 一品物を持ち帰った日、噂が立つ。蒐集家が町へ向かうのはこの一度だけである。
  for (const carried of state.inventory) if (announceSingularFind(state, carried)) break;
  state.lastExpeditionDay = Math.max(state.lastExpeditionDay, state.day);
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
  // 遺体の台帳を先に整理してから剪定へ。未回収の遺品を生存扱いにする必要があるため。
  pruneCorpses(state);
  // 探索を1回終えるごとに、もう誰も参照しない床の品を捨てる。
  pruneCampaignRecords(state);
  processDayEvents(state);
}


/** 次の日まで動けないほどの傷か。護衛の帰還と途中解雇で同じ基準を使う。 */
function badlyHurt(hp: number, maxHp: number): boolean {
  return hp < Math.max(1, maxHp) * 0.35;
}

export function guardRetreatRatio(state: GameState, guardId: string): number {
  const npc = state.npcs.find((entry) => entry.id === guardId);
  const base = npc?.retreatHpRatio ?? 0.25;
  if (!npc) return base;
  const profile = ensureGuardProfile(state, npc);
  const commitment = Math.max(0, profile.personality.empathy + profile.trust - 100) / 500;
  return Math.max(0.15, Math.min(0.65,
    base + (50 - profile.personality.courage) / 250 + profile.stress / 500 - commitment,
  ));
}

export function guardRetreatThreshold(state: GameState, guard: ActiveGuard): number {
  return Math.max(1, Math.ceil(guard.maxHp * guardRetreatRatio(state, guard.guardId)));
}

export function guardRecoveryTurns(state: GameState, guardId: string): number {
  const npc = state.npcs.find((entry) => entry.id === guardId);
  const courage = npc ? ensureGuardProfile(state, npc).personality.courage : 50;
  return courage >= 70 ? 1 : courage <= 30 ? 3 : 2;
}













export function moveToStore(state: GameState, item: ItemInstance): void {
  if (!canReorganizeHomeInventory(state)) {
    state.message = "営業中は在庫整理できない。";
    return;
  }
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
  if (!canReorganizeHomeInventory(state)) {
    state.message = "営業中は在庫整理できない。";
    return 0;
  }
  const selectedIds = new Set(itemIds);
  const selected = state.inventory.filter((item) => selectedIds.has(item.uuid));
  if (destination === "display" && selected.some((item) => !canSellInHomeShop(item))) {
    state.message = "回復薬は町の薬屋が扱っているため、自宅の店頭では売れない。";
    return 0;
  }
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
  if (!canReorganizeHomeInventory(state)) {
    state.message = "営業中は在庫整理できない。";
    return 0;
  }
  const selectedIds = new Set(itemIds);
  const selected = state.store.filter((item) => selectedIds.has(item.uuid));
  const available = bagCapacity(state) - inventoryItemCount(state);
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
  if (!canReorganizeHomeInventory(state)) {
    state.message = "営業中は在庫整理できない。";
    return;
  }
  if (!state.store.some((entry) => entry.uuid === item.uuid)) return;
  const showing = state.display.includes(item.uuid);
  if (showing) {
    state.display = state.display.filter((uuid) => uuid !== item.uuid);
    item.location = { kind: "homeStorage" };
    state.message = "展示を取り下げた。";
  } else if (state.display.length >= DISPLAY_CAPACITY) {
    state.message = `展示台は${DISPLAY_CAPACITY}枠までだ。`;
  } else if (!canSellInHomeShop(item)) {
    state.message = "回復薬は町の薬屋が扱っているため、自宅の店頭では売れない。";
  } else {
    state.display.push(item.uuid);
    item.location = { kind: "shopStock" };
    // 値を付けていない品は相場で並ぶ。あとから付け替えられる。
    item.askingPrice ??= marketPrice(item);
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
  if (!canReorganizeHomeInventory(state)) {
    state.message = "営業中は在庫整理できない。";
    return 0;
  }
  const validStoreIds = new Set(state.store.map((item) => item.uuid));
  const desiredIds = new Set(itemIds.filter((id) => validStoreIds.has(id)));
  if ([...desiredIds].some((id) => !canSellInHomeShop(state.itemsById[id]!))) {
    state.message = "回復薬は町の薬屋が扱っているため、自宅の店頭では売れない。";
    return 0;
  }
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
