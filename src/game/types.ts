export type ItemCategory = "weapon" | "arcane" | "relic" | "gem" | "book" | "art" | "material";
export type KnowledgeLevel = "unknown" | "suspected" | "identified";
export type Location = "town" | "interior" | "dungeon";
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

/** A dungeon has three authored elevation bands.  Movement between bands is
 * only possible through an explicit traversal link. */
export type DungeonHeight = 0 | 1 | 2;
export type EdgeDirection = "east" | "south";

/**
 * Edges are stored once, never once for each adjacent cell.  `east` means the
 * border between (x,y) and (x+1,y); `south` means the border below (x,y).
 */
export interface CanonicalEdge {
  x: number;
  y: number;
  direction: EdgeDirection;
}

export interface MapPoint3D extends Vec {
  height: DungeonHeight;
}

/** A local connector, distinct from `stairs` which changes dungeon floors. */
export interface TraversalLink {
  id: string;
  kind: "stairs" | "slope" | "door";
  from: MapPoint3D;
  to: MapPoint3D;
  bidirectional: boolean;
  footprint: Vec[];
}

export type DungeonRenderLayer = "ground" | "structure" | "decoration" | "overhead" | "light";

/** A rendered Craftpix stamp.  It contains no gameplay rule: gameplay stays
 * in tiles/heights/edges/traversalLinks. */
export interface RenderPlacement {
  assetId: string;
  /** Optional Tiled animation clip; assetId remains the representative frame. */
  animationId?: string;
  x: number;
  y: number;
  layer: DungeonRenderLayer;
  flipX?: boolean;
  flipY?: boolean;
  rotation?: 0 | 90 | 180 | 270;
  offsetX?: number;
  offsetY?: number;
}

export interface DungeonGenerationMetadata {
  algorithm: "craftpix-hybrid-v1" | "craftpix-ports-v2";
  seed: number;
  floor: number;
  templateLibraryVersion: number;
  catalogVersion: number;
  fallbackReason?: string;
  blueprintSummary: { roomCount: number; branchCount: number; loopCount: number };
}

export interface DungeonMap {
  width: number;
  height: number;
  /** Rendering unit for this map; legacy generated maps omit it and use 24px. */
  tileSize?: number;
  /** Optional art theme; omitted maps use the existing generated tile renderer. */
  visualTheme?: "craftpix-showcase" | "craftpix-procedural" | "craftpix-manual";
  tiles: number[][];
  /** v2 adds explicit traversal semantics while preserving legacy `tiles`. */
  formatVersion?: 2;
  heights?: DungeonHeight[][];
  hardEdges?: CanonicalEdge[];
  ledgeEdges?: CanonicalEdge[];
  traversalLinks?: TraversalLink[];
  renderLayers?: Partial<Record<DungeonRenderLayer, RenderPlacement[]>>;
  generation?: DungeonGenerationMetadata;
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
  version: 3;
  day: number;
  gold: number;
  hp: number;
  maxHp: number;
  returnStones: number;
  smokeBombs: number;
  location: Location;
  townPos: Vec;
  /** Authored free-movement map currently shown in town/interior mode. */
  worldMapId?: string;
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
