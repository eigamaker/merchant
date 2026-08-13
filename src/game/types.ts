export type ItemCategory = "weapon" | "arcane" | "relic" | "gem" | "book" | "art" | "material";
export type KnowledgeLevel = "unknown" | "suspected" | "identified";
export type Location = "town" | "dungeon";
export type QuestStatus = "locked" | "available" | "active" | "readyToReport" | "complete";
export type Facing = "up" | "down" | "left" | "right";

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
  staggerTurns: number;
}

export interface GroundItem {
  item: ItemInstance;
  pos: Vec;
}

export interface DungeonChest {
  id: string;
  pos: Vec;
  item: ItemInstance;
}

export interface DungeonBody {
  id: string;
  name: string;
  pos: Vec;
  loot: ItemInstance[];
  inspected: boolean;
  questId?: string;
}

export interface GuardDefinition {
  id: string;
  name: string;
  title: string;
  baseFee: number;
  baseMaxHp: number;
  damage: number;
  trait: "standard" | "scout";
  textureKey: string;
  description: string;
}

export interface GuardRecord {
  id: string;
  unlocked: boolean;
  relation: number;
  experience: number;
  level: number;
  injuredUntilDay?: number;
}

export interface ActiveGuard {
  guardId: string;
  pos: Vec;
  hp: number;
  maxHp: number;
  damage: number;
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
  chests: DungeonChest[];
  traps: Vec[];
  bodies: DungeonBody[];
  guard?: ActiveGuard;
  shoveCooldown: number;
  highestFloor: number;
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
  reward?: number;
  objective?:
    | { kind: "collect"; itemId: string; floor: number }
    | { kind: "inspectBody"; bodyId: string; floor: number }
    | { kind: "consult"; itemId: string; customerIds: string[] }
    | { kind: "story" };
}

export interface TimedEvent {
  id: string;
  dueDay: number;
  text: string;
}

export interface GameState {
  version: 2;
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
  /** Number of expeditions started. Persisted so a new visit never reuses the previous seed. */
  expeditionSerial: number;
  guildReputation: number;
  guards: GuardRecord[];
  hiredGuardId?: string;
  hiredGuardFee?: number;
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
    early: {
      stage: "herb" | "lostSword" | "missing" | "ring" | "complete";
      guardHiringUnlocked: boolean;
      missingBodyInspected: boolean;
      ringConsulted: string[];
      ringResolution?: "family" | "scholar" | "jeweler";
      shoveTutorialSeen: boolean;
    };
  };
}

export type DungeonEvent =
  | { type: "move"; actorId: string; from: Vec; to: Vec }
  | { type: "shove"; enemyId: string; from: Vec; to: Vec; success: boolean }
  | { type: "attack"; attackerId: string; targetId: string; damage: number }
  | { type: "defeated"; actorId: string }
  | { type: "pickup"; itemId: string }
  | { type: "message"; text: string };

export interface TurnResult {
  consumedTurn: boolean;
  events: DungeonEvent[];
}

export type DungeonCommand =
  | { type: "move"; direction: Vec }
  | { type: "shove"; direction: Vec }
  | { type: "wait" }
  | { type: "smoke" }
  | { type: "return" }
  | { type: "pickup"; swapOutId?: string }
  | { type: "openChest"; chestId: string; swapOutId?: string }
  | { type: "inspectBody"; bodyId: string }
  | { type: "lootBody"; bodyId: string; itemId: string; swapOutId?: string }
  | { type: "drop"; itemId: string }
  | { type: "stairs" };

export type MenuAction = () => void;

export interface MenuChoice {
  label: string;
  action: MenuAction;
  disabled?: boolean;
}
