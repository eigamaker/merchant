export type ItemCategory = "weapon" | "armor" | "medicine" | "material" | "curio" | "arcane" | "relic" | "gem" | "book" | "art";
export type ItemRarity = "common" | "uncommon" | "rare" | "legendary" | "unique";
export type KnowledgeLevel = "unknown" | "suspected" | "identified";
export type MapKind = "home" | "dungeon";
export type Location = MapKind;
export type QuestStatus = "locked" | "available" | "active" | "readyToReport" | "complete";
export type Facing = "up" | "down" | "left" | "right";
export type TimeSlot = "morning" | "afternoon" | "evening" | "night";
export type SupplyKind = "smokeBombs" | "returnStones" | "provisions";

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
  description: string;
  unique?: boolean;
  preferredBuyer?: string;
  visualId?: string;
  rarity?: ItemRarity;
  attack?: number;
  defense?: number;
  healing?: number;
  cures?: "poison";
  singular?: boolean;
}

export type ItemLocation =
  | { kind: "playerBag" }
  | { kind: "homeStorage" }
  | { kind: "shopStock" }
  | { kind: "dungeonGround"; floor: number; pos: Vec }
  | { kind: "corpse"; npcId: string; floor: number }
  | { kind: "npcInventory"; npcId: string }
  | { kind: "consumed"; actorId: string }
  | { kind: "soldArchive"; npcId: string };

export type ItemHistoryEvent =
  | { day: number; type: "created" | "found" | "stored" | "listed"; detail: string }
  | { day: number; type: "lootedFromCorpse" | "ownerDied"; npcId: string; detail: string }
  | { day: number; type: "sold"; npcId: string; price: number; detail: string }
  | { day: number; type: "named"; npcId: string; name: string; detail: string };

export interface ItemInstance {
  uuid: string;
  definitionId: string;
  discoveredDay: number;
  discoveredFloor?: number;
  knowledge: KnowledgeLevel;
  clues: string[];
  owner: "player" | "store" | string;
  history: LedgerEntry[];
  visualId?: string;
  rarity?: ItemRarity;
  location?: ItemLocation;
  singular?: boolean;
  currentName?: string;
  namedByNpcId?: string;
  historyV2?: ItemHistoryEvent[];
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
  /** Exact actor appearance selected by the authored floor roster. */
  actorId?: string;
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
  npcId?: string;
}

export interface GuardDefinition {
  id: string;
  name: string;
  title: string;
  baseFee: number;
  baseMaxHp: number;
  damage: number;
  trait: "standard" | "scout";
  retreatHpRatio: number;
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
  mode: "covering" | "retreated";
  safeTurns: number;
}

/** An adventurer who explores the current floor independently of the party. */
export interface DungeonAdventurer {
  npcId: string;
  pos: Vec;
  hp: number;
  maxHp: number;
  damage: number;
  gold: number;
}

export type NpcProfession = "swordsman" | "scout" | "mercenary" | "merchant" | "blacksmith" | "apothecary" | "noble" | "townsperson";
export type NpcStatus = "inTown" | "visiting" | "contracted" | "dungeon" | "dead" | "departed";
export type AdventurerRank = "E" | "D" | "C" | "B" | "A";

export interface NpcRecord {
  id: string;
  name: string;
  profession: NpcProfession;
  appearanceId: string;
  adventurer: boolean;
  status: NpcStatus;
  relation: number;
  interests: ItemCategory[];
  budget: number;
  inventoryIds: string[];
  rank?: AdventurerRank;
  baseFee?: number;
  maxHp?: number;
  damage?: number;
  trait?: "standard" | "scout";
  retreatHpRatio?: number;
}

export interface EscortCommission {
  offeredFee: number;
  status: "draft" | "accepted" | "active";
  npcId?: string;
  rank?: AdventurerRank;
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

export interface DungeonMap {
  width: number;
  height: number;
  /** Rendering unit for this map; legacy generated maps omit it and use 24px. */
  tileSize?: number;
  tiles: number[][];
  /** v2 adds explicit traversal semantics while preserving legacy `tiles`. */
  formatVersion?: 2;
  heights?: DungeonHeight[][];
  hardEdges?: CanonicalEdge[];
  ledgeEdges?: CanonicalEdge[];
  traversalLinks?: TraversalLink[];
  /** Canonical inter-floor connectors. */
  stairsUp: Vec;
  stairsDown?: Vec;
  stairsUpVisual?: { assetId: string; frame: number };
  stairsDownVisual?: { assetId: string; frame: number };
  /** Authored enemy roster; runtime chooses positions and repeats existing count rules. */
  enemyRoster?: string[];
  specialRoom?: Vec;
  /** Authored visual layers from the manual home/dungeon editor.  The
   * numeric collision grid above remains the movement source of truth. */
  authoredLayers?: Partial<Record<"ground" | "structure" | "decoration", Array<{ assetId: string; frame: number } | null>>>;
}

/** Read only at the save boundary. Runtime maps never emit these fields. */
export type LegacyDungeonMap = DungeonMap & { entrance?: Vec; stairs?: Vec; returnStairs?: Vec };

/** A complete mutable floor state, persisted before every floor transition. */
export interface DungeonFloorSnapshot {
  floor: number;
  map: DungeonMap;
  player: Vec;
  enemies: Enemy[];
  items: GroundItem[];
  chests: DungeonChest[];
  traps: Vec[];
  bodies: DungeonBody[];
  adventurers: DungeonAdventurer[];
  guard?: ActiveGuard;
  shoveCooldown: number;
  turn: number;
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
  adventurers: DungeonAdventurer[];
  guard?: ActiveGuard;
  shoveCooldown: number;
  highestFloor: number;
  turn: number;
  /** One unit per normal dungeon action; stairs cost five. */
  timeUnits: number;
  /** Number of 25-unit bands already charged for food and world time. */
  settledTimeBands: number;
  /** Keyed by floor number. The current floor is stored just before moving away. */
  floorStates: Record<string, DungeonFloorSnapshot>;
}

export interface EquipmentState {
  weaponItemId?: string;
  armorItemId?: string;
}

export interface ShopSession {
  day: number;
  status: "closed" | "movingToCounter" | "waiting" | "serving" | "finished";
  /** Persisted for reloads, but never displayed before each NPC enters. */
  queueNpcIds: string[];
  currentNpcId?: string;
  /** The shelf item and price named by the current customer. */
  requestedItemId?: string;
  requestedPrice?: number;
  servedNpcIds: string[];
}

export interface DailySupplyStock {
  day: number;
  smokeBombs: number;
  returnStones: number;
  provisions: number;
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
  version: 7;
  campaignId: string;
  status: "active" | "gameOver";
  day: number;
  timeSlot: TimeSlot;
  gold: number;
  hp: number;
  maxHp: number;
  returnStones: number;
  smokeBombs: number;
  provisions: number;
  equipment: EquipmentState;
  shopSession: ShopSession;
  dailySupplyStock: DailySupplyStock;
  location: Location;
  homePos: Vec;
  /** Legacy editor revision retained only for save migration compatibility. */
  /** 固定家マップの配置版。旧セーブを安全な初期位置へ移行するために使う。 */
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
  nextNpcId: number;
  itemsById: Record<string, ItemInstance>;
  npcs: NpcRecord[];
  visitorNpcIds: string[];
  escortCommission?: EscortCommission;
  refusedOffers: Record<string, number>;
  singularItemIds: string[];
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
  | { type: "guardMode"; guardId: string; mode: ActiveGuard["mode"] }
  | { type: "pickup"; itemId: string }
  | { type: "message"; text: string };

export interface TurnResult {
  consumedTurn: boolean;
  events: DungeonEvent[];
}

export type DungeonCommand =
  | { type: "move"; direction: Vec }
  | { type: "attack"; direction: Vec }
  | { type: "shove"; direction: Vec }
  | { type: "wait" }
  | { type: "smoke" }
  | { type: "return" }
  | { type: "pickup"; swapOutId?: string }
  | { type: "openChest"; chestId: string; swapOutId?: string }
  | { type: "inspectBody"; bodyId: string }
  | { type: "lootBody"; bodyId: string; itemId: string; swapOutId?: string }
  | { type: "drop"; itemId: string }
  | { type: "useMedicine"; itemId: string; target: "player" | "guard" }
  | { type: "buyFromAdventurer"; npcId: string; itemId: string; swapOutId?: string }
  | { type: "sellToAdventurer"; npcId: string; itemId: string }
  | { type: "stairs" };

export type MenuAction = () => void;

export interface MenuChoice {
  label: string;
  action: MenuAction;
  disabled?: boolean;
}
