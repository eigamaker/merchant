export type ItemCategory = "weapon" | "arcane" | "relic" | "gem" | "book" | "art" | "material";
export type KnowledgeLevel = "unknown" | "suspected" | "identified";
export type Location = "town" | "dungeon";
export type QuestStatus = "available" | "active" | "complete";

export interface Vec {
  x: number;
  y: number;
}

export interface ItemDefinition {
  id: string;
  category: ItemCategory;
  unknownName: string;
  suspectedName: string;
  trueName: string;
  baseValue: number;
  bulk: 1 | 2 | 3;
  description: string;
  unique?: boolean;
  preferredBuyer?: string;
}

export interface ItemInstance {
  uuid: string;
  definitionId: string;
  discoveredDay: number;
  discoveredFloor?: number;
  knowledge: KnowledgeLevel;
  clues: string[];
  owner: "player" | "store" | string;
  history: LedgerEntry[];
}

export interface LedgerEntry {
  day: number;
  type: "found" | "examined" | "displayed" | "sold" | "recovered";
  detail: string;
  value?: number;
}

export interface Enemy {
  id: string;
  name: string;
  pos: Vec;
  hp: number;
  maxHp: number;
  damage: number;
  state: "patrol" | "chase" | "search";
  target?: Vec;
}

export interface GroundItem {
  item: ItemInstance;
  pos: Vec;
}

export interface DungeonMap {
  width: number;
  height: number;
  tiles: number[][];
  entrance: Vec;
  stairs: Vec;
  returnStairs: Vec;
  specialRoom?: Vec;
}

export interface DungeonRun {
  seed: number;
  floor: number;
  map: DungeonMap;
  player: Vec;
  enemies: Enemy[];
  items: GroundItem[];
  chests: Vec[];
  traps: Vec[];
  bodies: Vec[];
  turn: number;
}

export interface Customer {
  id: string;
  name: string;
  title: string;
  interests: ItemCategory[];
  budget: number;
  relation: number;
  knowledge: ItemCategory[];
  color: number;
}

export interface Quest {
  id: string;
  title: string;
  description: string;
  status: QuestStatus;
  targetItemId?: string;
  targetFloor?: number;
}

export interface TimedEvent {
  id: string;
  dueDay: number;
  text: string;
}

export interface GameState {
  version: 1;
  day: number;
  gold: number;
  hp: number;
  maxHp: number;
  returnStones: number;
  smokeBombs: number;
  location: Location;
  townPos: Vec;
  /** 固定町マップの配置版。旧セーブを安全な初期位置へ移行するために使う。 */
  townMapRevision: number;
  inventory: ItemInstance[];
  store: ItemInstance[];
  archive: ItemInstance[];
  display: string[];
  customers: Customer[];
  quests: Quest[];
  events: TimedEvent[];
  run?: DungeonRun;
  message: string;
  nextItemId: number;
  story: {
    blackSword: "locked" | "rumor" | "found" | "sold" | "incident" | "tomb" | "revealed";
  };
}

export type MenuAction = () => void;

export interface MenuChoice {
  label: string;
  action: MenuAction;
  disabled?: boolean;
}
