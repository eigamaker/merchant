import { CUSTOMERS, INITIAL_QUESTS, ITEM_DEFINITIONS } from "./content";
import { Rng } from "./rng";
import { TOWN_SPAWN } from "./townMap";
import type {
  Customer,
  DungeonMap,
  DungeonRun,
  Enemy,
  GameState,
  GroundItem,
  ItemDefinition,
  ItemInstance,
  KnowledgeLevel,
  Quest,
  Vec,
} from "./types";

const MAP_WIDTH = 21;
const MAP_HEIGHT = 12;
const FLOOR = 0;
const WALL = 1;

const clone = <T>(value: T): T => structuredClone(value);

export const DIRECTION: Record<string, Vec> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function createNewGame(): GameState {
  return {
    version: 1,
    day: 1,
    gold: 300,
    hp: 12,
    maxHp: 12,
    returnStones: 1,
    smokeBombs: 2,
    location: "town",
    townPos: { ...TOWN_SPAWN },
    townMapRevision: 2,
    inventory: [],
    store: [],
    archive: [],
    display: [],
    customers: clone(CUSTOMERS),
    quests: clone(INITIAL_QUESTS),
    events: [],
    message: "ようこそ、珍品店へ。ギルドで依頼を確認しよう。",
    nextItemId: 1,
    story: { blackSword: "locked" },
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

function createItem(state: GameState, definitionId: string, floor?: number): ItemInstance {
  const definition = ITEM_DEFINITIONS[definitionId];
  if (!definition) throw new Error(`未定義アイテム: ${definitionId}`);
  const uuid = `item-${state.nextItemId++}`;
  return {
    uuid,
    definitionId,
    discoveredDay: state.day,
    discoveredFloor: floor,
    knowledge: "unknown",
    clues: [],
    owner: "player",
    history: [
      { day: state.day, type: "found", detail: floor ? `地下${floor}階で発見` : "町で入手" },
    ],
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

function freeFloor(map: DungeonMap, rng: Rng, occupied: Vec[]): Vec {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const candidate = { x: rng.int(1, map.width - 2), y: rng.int(1, map.height - 2) };
    const used = occupied.some((pos) => pos.x === candidate.x && pos.y === candidate.y);
    if (map.tiles[candidate.y]![candidate.x] === FLOOR && !used) return candidate;
  }
  return { ...map.entrance };
}

export function generateDungeon(seed: number, floor: number, requiresTomb = false): DungeonMap {
  const rng = new Rng(seed + floor * 7919);
  const tiles = Array.from({ length: MAP_HEIGHT }, () => Array.from({ length: MAP_WIDTH }, () => WALL));
  const centers: Vec[] = [];

  for (let room = 0; room < 5; room += 1) {
    const width = rng.int(3, 5);
    const height = rng.int(3, 4);
    const x = rng.int(1, MAP_WIDTH - width - 2);
    const y = rng.int(1, MAP_HEIGHT - height - 2);
    const center = carveRoom(tiles, x, y, width, height);
    if (centers.length > 0) carveCorridor(tiles, centers[centers.length - 1]!, center);
    centers.push(center);
  }

  const entrance = centers[0] ?? { x: 2, y: 2 };
  const stairs = centers[centers.length - 1] ?? { x: MAP_WIDTH - 3, y: MAP_HEIGHT - 3 };
  const specialRoom = requiresTomb ? centers[Math.floor(centers.length / 2)] : undefined;
  return { width: MAP_WIDTH, height: MAP_HEIGHT, tiles, entrance, stairs, returnStairs: entrance, specialRoom };
}

function activeQuestForFloor(state: GameState, floor: number): Quest | undefined {
  return state.quests.find((quest) => quest.status === "active" && quest.targetFloor === floor && quest.targetItemId);
}

function randomItemId(rng: Rng): string {
  const ids = Object.keys(ITEM_DEFINITIONS).filter((id) => !ITEM_DEFINITIONS[id]!.unique);
  return rng.pick(ids);
}

function buildEnemies(rng: Rng, map: DungeonMap, floor: number, occupied: Vec[]): Enemy[] {
  const variants = [
    { id: "slime", name: "深青スライム", hp: 3 + floor, damage: 1 },
    { id: "bat", name: "影蝙蝠", hp: 2 + floor, damage: 1 },
    { id: "crawler", name: "岩穿ち獣", hp: 4 + floor, damage: 2 },
  ];
  return Array.from({ length: 3 + Math.min(floor, 4) }, (_, index) => {
    const variant = rng.pick(variants);
    const pos = freeFloor(map, rng, occupied);
    occupied.push(pos);
    return {
      ...variant,
      id: `${variant.id}-${floor}-${index}`,
      pos,
      maxHp: variant.hp,
      state: "patrol" as const,
    };
  });
}

function buildRun(state: GameState, floor: number, seed: number): DungeonRun {
  const needsTomb = state.story.blackSword === "incident" && floor === 3;
  const map = generateDungeon(seed, floor, needsTomb);
  const rng = new Rng(seed + floor * 997);
  const occupied: Vec[] = [map.entrance, map.stairs];
  const items: GroundItem[] = [];
  const quest = activeQuestForFloor(state, floor);

  if (quest?.targetItemId) {
    const pos = freeFloor(map, rng, occupied);
    occupied.push(pos);
    items.push({ item: createItem(state, quest.targetItemId, floor), pos });
  }

  for (let index = items.length; index < 5; index += 1) {
    const pos = freeFloor(map, rng, occupied);
    occupied.push(pos);
    items.push({ item: createItem(state, randomItemId(rng), floor), pos });
  }

  const enemies = buildEnemies(rng, map, floor, occupied);
  const occupiedEntities = [...occupied, ...enemies.map((enemy) => enemy.pos)];
  const chest = freeFloor(map, rng, occupiedEntities);
  const trap = freeFloor(map, rng, [...occupiedEntities, chest]);
  const body = freeFloor(map, rng, [...occupiedEntities, chest, trap]);
  return { seed, floor, map, player: { ...map.entrance }, enemies, items, chests: [chest], traps: [trap], bodies: [body], turn: 0 };
}

export function beginExpedition(state: GameState): void {
  const seed = state.day * 104729 + state.nextItemId * 397;
  state.location = "dungeon";
  state.returnStones = 1;
  state.smokeBombs = 2;
  state.run = buildRun(state, 1, seed);
  state.message = "ダンジョンへ入った。無理をせず、価値ある品を持ち帰ろう。";
}

export function descend(state: GameState): void {
  const run = state.run;
  if (!run) return;
  if (run.floor >= 8) {
    state.message = "この探索で到達できる最深部だ。帰還石か階段で戻ろう。";
    return;
  }
  state.run = buildRun(state, run.floor + 1, run.seed);
  state.message = `地下${state.run.floor}階へ降りた。`;
}

function isWalkable(map: DungeonMap, pos: Vec): boolean {
  return pos.x >= 0 && pos.y >= 0 && pos.x < map.width && pos.y < map.height && map.tiles[pos.y]![pos.x] === FLOOR;
}

function samePosition(a: Vec, b: Vec): boolean {
  return a.x === b.x && a.y === b.y;
}

function distance(a: Vec, b: Vec): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function moveEnemy(enemy: Enemy, run: DungeonRun, rng: Rng): void {
  const player = run.player;
  const dist = distance(enemy.pos, player);
  if (dist <= 6) {
    enemy.state = "chase";
    enemy.target = { ...player };
  } else if (enemy.state === "chase") {
    enemy.state = "search";
  }

  let directions: Vec[];
  if (enemy.state === "chase" && enemy.target) {
    const horizontal = { x: Math.sign(enemy.target.x - enemy.pos.x), y: 0 };
    const vertical = { x: 0, y: Math.sign(enemy.target.y - enemy.pos.y) };
    directions = rng.next() > 0.5 ? [horizontal, vertical] : [vertical, horizontal];
  } else {
    directions = [DIRECTION.up, DIRECTION.down, DIRECTION.left, DIRECTION.right].sort(() => rng.next() - 0.5);
  }

  for (const direction of directions) {
    if (direction.x === 0 && direction.y === 0) continue;
    const next = { x: enemy.pos.x + direction.x, y: enemy.pos.y + direction.y };
    const collision = run.enemies.some((other) => other.id !== enemy.id && samePosition(other.pos, next));
    if (isWalkable(run.map, next) && !collision && !samePosition(next, player)) {
      enemy.pos = next;
      break;
    }
  }
}

function enemyTurn(state: GameState): void {
  const run = state.run;
  if (!run) return;
  const rng = new Rng(run.seed + run.turn * 37 + run.floor);
  for (const enemy of run.enemies) {
    if (distance(enemy.pos, run.player) === 1) {
      state.hp -= enemy.damage;
      state.message = `${enemy.name}の攻撃。${enemy.damage}ダメージ。`;
      continue;
    }
    moveEnemy(enemy, run, rng);
  }
  run.turn += 1;
  if (state.hp <= 0) rescuePlayer(state);
}

export function movePlayer(state: GameState, direction: Vec): void {
  const run = state.run;
  if (!run) return;
  const next = { x: run.player.x + direction.x, y: run.player.y + direction.y };
  const enemy = run.enemies.find((candidate) => samePosition(candidate.pos, next));
  if (enemy) {
    enemy.hp -= 1;
    state.message = `${enemy.name}を牽制した。1ダメージ。`;
    if (enemy.hp <= 0) {
      run.enemies = run.enemies.filter((candidate) => candidate.id !== enemy.id);
      state.message = `${enemy.name}を退けた。戦うほど消耗する。`;
    }
    enemyTurn(state);
    return;
  }
  if (!isWalkable(run.map, next)) {
    state.message = "壁が行く手を阻んでいる。";
    return;
  }
  run.player = next;
  state.message = "足音を殺して進む。";
  const trapIndex = run.traps.findIndex((trap) => samePosition(trap, next));
  if (trapIndex >= 0) {
    run.traps.splice(trapIndex, 1);
    state.hp -= 2;
    state.message = "床の罠が作動した。2ダメージ。";
  }
  if (run.map.specialRoom && samePosition(next, run.map.specialRoom) && state.story.blackSword === "incident") {
    state.story.blackSword = "tomb";
    state.message = "古い墓所を発見した。『アルベルト』という名が刻まれている。学者に相談しよう。";
    const quest = state.quests.find((entry) => entry.id === "black-tomb");
    if (quest) quest.status = "active";
  }
  enemyTurn(state);
}

export function tryPickup(state: GameState): void {
  const run = state.run;
  if (!run) return;
  const ground = run.items.find((entry) => samePosition(entry.pos, run.player));
  if (!ground) {
    state.message = "ここには拾えるものがない。";
    return;
  }
  if (currentBulk(state) + itemBulk(ground.item) > 12) {
    state.message = "持ち物がいっぱいだ。何を持ち帰るか選ばなければならない。";
    return;
  }
  run.items = run.items.filter((entry) => entry.item.uuid !== ground.item.uuid);
  ground.item.owner = "player";
  state.inventory.push(ground.item);
  state.message = `${itemName(ground.item)}を拾った。`;
  completePickupQuest(state, ground.item);
  enemyTurn(state);
}

export function tryOpenChest(state: GameState): boolean {
  const run = state.run;
  if (!run) return false;
  const chestIndex = run.chests.findIndex((chest) => samePosition(chest, run.player));
  if (chestIndex < 0) return false;
  const rng = new Rng(run.seed + run.floor * 121 + run.turn);
  const definitionId = randomItemId(rng);
  const definition = ITEM_DEFINITIONS[definitionId]!;
  if (currentBulk(state) + definition.bulk > 12) {
    state.message = "宝箱を見つけたが、持ち物がいっぱいだ。";
    return true;
  }
  run.chests.splice(chestIndex, 1);
  const item = createItem(state, definitionId, run.floor);
  state.inventory.push(item);
  state.message = `宝箱から${itemName(item)}を見つけた。`;
  enemyTurn(state);
  return true;
}

export function useSmokeBomb(state: GameState): void {
  const run = state.run;
  if (!run) return;
  if (state.smokeBombs <= 0) {
    state.message = "煙玉は残っていない。";
    return;
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
  enemyTurn(state);
}

function completePickupQuest(state: GameState, item: ItemInstance): void {
  const quest = state.quests.find((entry) => entry.status === "active" && entry.targetItemId === item.definitionId);
  if (!quest) return;
  if (quest.id === "black-sword") {
    state.story.blackSword = "found";
    state.message = "黒い長剣を持ち帰れる。誰に見せるかが重要だ。";
    return;
  }
  quest.status = "complete";
  state.message = `${itemName(item)}を入手した。依頼「${quest.title}」の目的を達成。`;
}

export function tryStairs(state: GameState): void {
  const run = state.run;
  if (!run) return;
  if (samePosition(run.player, run.map.stairs)) {
    descend(state);
  } else if (samePosition(run.player, run.map.returnStairs)) {
    returnToTown(state, false);
  } else {
    state.message = "階段はここにはない。";
  }
}

export function returnToTown(state: GameState, rescued: boolean): void {
  if (rescued) {
    const protectedDefinitions = new Set(state.quests.filter((quest) => quest.status === "active").map((quest) => quest.targetItemId));
    const recoverable = state.inventory.filter((item) => !itemDefinition(item).unique && !protectedDefinitions.has(item.definitionId));
    const lossCount = Math.ceil(recoverable.length / 2);
    const losses = [...recoverable].sort((a, b) => a.uuid.localeCompare(b.uuid)).slice(0, lossCount);
    state.inventory = state.inventory.filter((item) => !losses.includes(item));
    const fee = Math.floor(state.gold * 0.1);
    state.gold -= fee;
    state.message = `救助された。戦利品${lossCount}点と救助費${fee}Gを失った。`;
  } else {
    state.message = "町へ帰還した。商品をどう扱うか考えよう。";
  }
  state.day += 1;
  state.hp = state.maxHp;
  state.location = "town";
  state.run = undefined;
  processDayEvents(state);
}

function rescuePlayer(state: GameState): void {
  returnToTown(state, true);
}

export function appraiseItem(state: GameState, item: ItemInstance, customer: Customer): string {
  const definition = itemDefinition(item);
  if (!customer.knowledge.includes(definition.category)) {
    return `${customer.name}「専門外だが、変わった品だね」`;
  }
  if (item.definitionId === "black-sword" && state.story.blackSword === "tomb" && customer.id === "scholar") {
    item.knowledge = "identified";
    item.clues.push("古い墓所の碑文と学者の照合により正体が判明した。");
    item.history.push({ day: state.day, type: "examined", detail: "エリスが黒騎士アルベルトの記録と照合" });
    state.story.blackSword = "revealed";
    const quest = state.quests.find((entry) => entry.id === "black-tomb");
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
    const quest = state.quests.find((entry) => entry.id === "black-sword");
    if (quest) quest.status = "complete";
  }
  return `${customer.name}へ${itemName(item)}を${price}Gで売却した。`;
}

export function moveToStore(state: GameState, item: ItemInstance): void {
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
  const quest = state.quests.find((entry) => entry.id === questId);
  if (!quest || quest.status !== "available") return;
  const activeCount = state.quests.filter((entry) => entry.status === "active").length;
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
  if (due.length > 0) {
    state.message = due.map((event) => event.text).join(" ");
    if (due.some((event) => event.id === "black-sword-incident")) {
      state.story.blackSword = "incident";
      const quest = state.quests.find((entry) => entry.id === "black-tomb");
      if (quest) quest.status = "active";
    }
  }
}

export function activeQuestSummary(state: GameState): string {
  const active = state.quests.filter((quest) => quest.status === "active");
  return active.length > 0 ? active.map((quest) => `・${quest.title}`).join("\n") : "現在受けている依頼はない。";
}

export function customerById(state: GameState, id: string): Customer | undefined {
  return state.customers.find((customer) => customer.id === id);
}
