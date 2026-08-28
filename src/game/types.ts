export type ItemCategory = "weapon" | "armor" | "medicine" | "material" | "curio" | "arcane" | "relic" | "gem" | "book" | "art";
export type ItemRarity = "common" | "uncommon" | "rare" | "legendary" | "unique";
export type KnowledgeLevel = "unknown" | "suspected" | "identified";
export type MapKind = "home" | "dungeon";
export type Location = MapKind;
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
  /** 担がれて積み上がった功績。銘はここから育つ。 */
  deeds?: ItemDeeds;
  /** 商人が付けた値。棚から下げても覚えている。未設定なら相場で並ぶ。 */
  askingPrice?: number;
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
  npcId?: string;
}

export interface ActiveGuard {
  guardId: string;
  pos: Vec;
  hp: number;
  maxHp: number;
  damage: number;
  mode: "covering" | "retreated";
  safeTurns: number;
  /** Trust earned from medicine is capped per expedition. */
  healingTrustGained: number;
  retreatCount: number;
  /** 預かった防具ぶんの軽減。装備が無ければ未設定で、主人公と同じ式が恒等になる。 */
  defense?: number;
}

/** An adventurer who explores the current floor independently of the party. */
export interface DungeonAdventurer {
  npcId: string;
  pos: Vec;
  hp: number;
  maxHp: number;
  damage: number;
  gold: number;
  /** 預かった防具ぶんの軽減。装備が無ければ未設定。 */
  defense?: number;
}

export type NpcProfession = "swordsman" | "scout" | "mercenary" | "merchant" | "blacksmith" | "apothecary" | "noble" | "townsperson";
/**
 * 名簿は一つで、状態がその人の今日を決める。
 *
 * `delving` と `escorting` を分けるのが要。日次の町シミュレーションは単独潜行者を
 * 画面外で死なせてよいが、いま主人公の隣を歩いている護衛に触れてはならない。
 */
export type NpcStatus =
  | "inTown"
  | "visiting"
  | "contracted"
  | "delving"
  | "escorting"
  | "recovering"
  | "traveling"
  | "dead";
export type AdventurerRank = "E" | "D" | "C" | "B" | "A";

export type GuardArchetype = "steadfast" | "cautious" | "bold" | "mercenary" | "compassionate";

export interface GuardPersonality {
  /** Internal values are never rendered directly. */
  archetype: GuardArchetype;
  courage: number;
  discipline: number;
  empathy: number;
  integrity: number;
  greed: number;
}

export type GuardCareerEventType =
  | "hired"
  | "returned"
  | "kill"
  | "covered"
  | "retreated"
  | "healed"
  | "warningIgnored"
  | "leftEarly"
  | "starved"
  | "died";

export interface GuardCareerEvent {
  day: number;
  type: GuardCareerEventType;
  detail: string;
  floor?: number;
}

export interface GuardCareer {
  hireCount: number;
  successfulReturns: number;
  deepestFloor: number;
  enemiesDefeated: number;
  damageCovered: number;
  retreatCount: number;
  warningsIgnored: number;
  earlyDepartures: number;
  /** 商人と関係なく自分で潜った回数。画面外の結果は件数だけ数え、経歴イベントには積まない。 */
  soloDelves: number;
  soloDeepest: number;
  deathDay?: number;
  deathFloor?: number;
  events: GuardCareerEvent[];
}

export interface GuardProfile {
  personality: GuardPersonality;
  trust: number;
  stress: number;
  career: GuardCareer;
}

/**
 * 商人とその人物のあいだに起きたこと。
 *
 * 護衛としての経歴（GuardCareer）とは別に持つ。護衛を引き受けたことのない客や、
 * 迷宮で一度すれ違っただけの冒険者にも縁は生まれるため。
 */
export type BondKind =
  | "aided"
  /** 迷宮で足元を見られた。恨みとして残る。 */
  | "gouged"
  | "traded"
  | "foughtTogether"
  | "looted"
  | "served"
  | "entrusted"
  | "lost";

export interface NpcBond {
  day: number;
  kind: BondKind;
  detail: string;
  floor?: number;
}

/** 預けた条件。貸与は返す約束、譲渡は返らない。 */
export type NpcGearTerm = "lent" | "given";

/**
 * 預けた装備の枠。
 *
 * `itemId` は `NpcRecord.inventoryIds` の中の品を指す参照であって、別の置き場ではない。
 * 品の `location` は貸与も譲渡も `npcInventory` で、両者の違いは `term` だけが持つ。
 * 所有を `location` から判断する新しいコードは、必ず `gear` も見ること。
 */
export interface NpcGearSlot {
  itemId: string;
  term: NpcGearTerm;
  /** 預けた日。貸与の精算は翌日以降に起きる。 */
  since: number;
  /** 返す約束を破った。お抱えの道はここで閉じる。 */
  withheld?: true;
}

export interface NpcGear {
  weapon?: NpcGearSlot;
  armor?: NpcGearSlot;
}

/**
 * その品が居合わせた出来事。人ではなく品に付く。
 *
 * 地下8階を踏んだA級に剣を貸しても「深淵踏み」にはならない。
 * 武器はその武器が担がれた深さと、その武器で退けた数だけを負う。
 */
export interface ItemDeeds {
  deepestFloor: number;
  kills: number;
  returns: number;
  ownersLost: number;
  /** 到達した銘の段。0は無銘。 */
  stage: number;
}

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
  retreatHpRatio?: number;
  guardProfile?: GuardProfile;
  /** 商人との間に起きたこと。剪定でこの人物を残すかの判断にも使う。 */
  bonds?: NpcBond[];
  /** 今日の潜行予定。翌朝の町シミュレーションで解決して消える。 */
  delve?: { floor: number; departedDay: number };
  /** 前回の潜行で負った傷。満タンなら省略する。 */
  conditionHp?: number;
  /** 町へ来る前から名の知れた冒険者。護衛料に実績分が乗る。 */
  famous?: boolean;
  /** 商人から預かっている装備。品そのものは inventoryIds の中にある。 */
  gear?: NpcGear;
  /** お抱えになった日。 */
  retainedSince?: number;
}

/**
 * 迷宮に残された遺体。階は探索ごとに作り直されるので、遺体はキャンペーン側に置く。
 * 座標は持たない —— 地図が変わるため、配置は毎回 `freeFloor` が決める。
 */
export interface DungeonCorpse {
  npcId: string;
  floor: number;
  diedDay: number;
  /** まだ回収されていない遺品。空になれば台帳から落ちる。 */
  lootIds: string[];
  /** 一度調べた遺体は、再訪時も誰なのか分かる。 */
  inspected: boolean;
  /** 遺品を用意済みか。画面外の死は、最初に見つかった時点で中身が決まる。 */
  stocked: boolean;
  /** 銘や功績を負った品が残っている遺体。無関係な死に押し出されて消えては困る。 */
  keepsake?: true;
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

export interface DungeonGeneratedRoom {
  id: string;
  templateId: string;
  rotation: 0 | 90 | 180 | 270;
  tag: "entrance" | "exit" | "combat" | "loot" | "treasure" | "tomb";
  x: number;
  y: number;
  width: number;
  height: number;
  center: Vec;
  cells: Vec[];
  graphDistance: number;
  mainPath: boolean;
  deadEnd: boolean;
}

export interface DungeonProceduralMetadata {
  generatorVersion: 1;
  themeId: string;
  layoutSeed: number;
  fallback: boolean;
  mainPathRoomIds: string[];
  rooms: DungeonGeneratedRoom[];
}

export interface DungeonMap {
  width: number;
  height: number;
  /** Rendering unit for this map; legacy generated maps omit it and use 24px. */
  tileSize?: number;
  tiles: number[][];
  /** 灯りが届いた升の記憶。'1' が既知で、幅×高さぶんの並び。 */
  explored?: string;
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
  /** Authored visual layers from the manual home/dungeon editor.  The
   * numeric collision grid above remains the movement source of truth. */
  authoredLayers?: Partial<Record<"ground" | "structure" | "decoration", Array<{ assetId: string; frame: number } | null>>>;
  /** Logical generation data. Physical image references are intentionally resolved at render time. */
  procedural?: DungeonProceduralMetadata;
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
  bodies: DungeonBody[];
  adventurers: DungeonAdventurer[];
  guard?: ActiveGuard;
  shoveCooldown: number;
  turn: number;
}

export interface DungeonRun {
  seed: number;
  themeScheduleVersion: 1;
  themePoolIds: string[];
  startedDay: number;
  floor: number;
  map: DungeonMap;
  player: Vec;
  enemies: Enemy[];
  items: GroundItem[];
  chests: DungeonChest[];
  bodies: DungeonBody[];
  adventurers: DungeonAdventurer[];
  guard?: ActiveGuard;
  shoveCooldown: number;
  highestFloor: number;
  turn: number;
  /** One unit per dungeon action, including stair travel. */
  timeUnits: number;
  /** Number of 30-action bands already charged for food and world time. */
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

export interface TimedEvent {
  id: string;
  dueDay: number;
  text: string;
  /** 予告された出来事。日が来たときに名簿へ反映する。 */
  effect?: { kind: "arrival"; npcId: string };
}

export interface GameState {
  version: 12;
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
  /** Number of expeditions started. Persisted so a new visit never reuses the previous seed. */
  expeditionSerial: number;
  /** The current day is unavailable when it equals this value. */
  lastExpeditionDay: number;
  hiredGuardId?: string;
  hiredGuardFee?: number;
  inventory: ItemInstance[];
  store: ItemInstance[];
  archive: ItemInstance[];
  display: string[];
  events: TimedEvent[];
  /** 迷宮に残る遺体。階の再生成を越えて持ち越す。 */
  dungeonCorpses: DungeonCorpse[];
  /** 町の一日を回した最後の日。二重に回さないための印。 */
  lastSimulatedDay: number;
  run?: DungeonRun;
  message: string;
  nextItemId: number;
  nextNpcId: number;
  itemsById: Record<string, ItemInstance>;
  npcs: NpcRecord[];
  visitorNpcIds: string[];
  escortCommission?: EscortCommission;
  singularItemIds: string[];
}

export type DungeonEvent =
  | { type: "move"; actorId: string; from: Vec; to: Vec }
  | { type: "shove"; enemyId: string; from: Vec; to: Vec; success: boolean }
  | { type: "attack"; attackerId: string; targetId: string; damage: number }
  | { type: "defeated"; actorId: string; pos?: Vec }
  | { type: "guardMode"; guardId: string; mode: ActiveGuard["mode"] }
  | { type: "pickup"; itemId: string }
  | { type: "message"; text: string };

export interface TurnResult {
  consumedTurn: boolean;
  events: DungeonEvent[];
  guardDescent?: GuardDescentAssessment;
}

export interface GuardDescentAssessment {
  severity: "allow" | "warn" | "refuse";
  guardId: string;
  nextFloor: number;
  risk: number;
  reason: string;
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
  /** `price` は商人の言い値。省略すれば相場どおり。 */
  | { type: "sellToAdventurer"; npcId: string; itemId: string; price?: number }
  | { type: "stairs"; guardResponse?: "continue" | "dismiss" };

export type MenuAction = () => void;

export interface MenuChoice {
  label: string;
  action: MenuAction;
  disabled?: boolean;
}
