export type ItemCategory = "weapon" | "armor" | "bag" | "medicine" | "material" | "curio" | "arcane" | "relic" | "gem" | "book" | "art";
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
  /** 道具袋が抱えられる枠数。category が "bag" の品だけが持つ。 */
  capacity?: number;
  /** この深さより浅い階には落ちない。既定は種類から決まる。 */
  minFloor?: number;
  singular?: boolean;
}

export type ItemLocation =
  | { kind: "playerBag" }
  /** いま背負っている道具袋。枠を消費しない唯一の置き場。 */
  | { kind: "equipped" }
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
  /**
   * `retreated` は隊列の後ろへ下がるだけで、安全になれば戻る。
   * `fled` は契約を捨てて迷宮を出た者で、二度と戻らない。
   */
  mode: "covering" | "retreated" | "fled";
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
  /** この階に現れた手番。長居はせず、自分の探索へ戻っていく。 */
  arrivedTurn?: number;
  hp: number;
  maxHp: number;
  damage: number;
  gold: number;
  /** この階で商人から買った携行食料。深度ごとの需要上限に使う。 */
  provisionsBought?: number;
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
  /** 深手を負い、契約を捨てて商人を置いて逃げた。 */
  | "abandoned"
  /** 深層で取り分の上乗せを強要した。 */
  | "extorted"
  /** 誰も見ていない深層で、荷を奪って去った。 */
  | "betrayed"
  /** 契約とは関係なく、迷宮で商人を襲った。 */
  | "heldUp"
  /** 追いはぎに立ち向かい、商人をかばった。 */
  | "rescued"
  /** 商人が襲われているのを、そこに立って見ていた。 */
  | "stoodBy"
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
  /** 商人を迷宮に置いて逃げた回数。ギルドの掲示に出る。 */
  abandonCount: number;
  /** 深層で取り分を強要した回数。 */
  extortionCount: number;
  /** 迷宮で商人を襲った回数。護衛の契約とは無関係に、ギルドの掲示に出る。 */
  holdupCount: number;
  /** 追いはぎから商人をかばった回数。 */
  rescueCount: number;
  /** 荷を奪って去った回数。これが付いた者を二度と雇う商人はいない。 */
  betrayalCount: number;
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
  /** 迷宮に置き去りにされた。 */
  | "abandoned"
  /** 深層で取り分を強要された。 */
  | "extorted"
  /** 迷宮で待ち伏せられ、荷を要求された。 */
  | "waylaid"
  /** 追いはぎから守ってもらった。 */
  | "rescued"
  /** 荷を奪われた。 */
  | "betrayed"
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

/**
 * 床に広げた風呂敷の一枠。
 *
 * `itemId` は鞄の中の品を指す参照であって、別の置き場ではない。並べても品は商人のもので、
 * 枠を食い続ける。露店は在庫を移すのではなく、鞄の中身を床に見せているだけである。
 */
export interface StallSlot {
  itemId: string;
  pos: Vec;
  /** 商人の言い値。 */
  price: number;
}

/**
 * 迷宮で広げた露店。
 *
 * 深い階には他に店がない。傷ついた冒険者の前で回復薬を並べているのが自分だけなら、
 * 値は町の相場とは別のところで決まる。ただし広げているあいだ商人は動けないので、
 * 敵は寄り、食料は減り、護衛は消耗する。
 */
export interface DungeonStall {
  openedTurn: number;
  slots: StallSlot[];
  /** 一度見て何も買わなかった相手。並べ替えるまで戻ってこない。 */
  passedNpcIds: string[];
  /** 噂を聞いて寄ってきた人数。呼び込みには限りがある。 */
  drawnCount: number;
  /** 売り上げの累計。畳むときに一行で報せる。 */
  earned: number;
  soldCount: number;
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
  /** 広げている露店。階を移れば畳まれるので、階の記録には持たせない。 */
  stall?: DungeonStall;
  /** 護衛が行く手を塞いでいる。返事をするまで先へ進めない。 */
  demand?: GuardDemand;
  /** 護衛ではない誰かに、迷宮で呼び止められている。 */
  holdup?: DungeonHoldup;
  /** もう話のついた相手。「出せば通してやる」と言った以上、二度は呼び止めない。 */
  holdupSettledNpcIds?: string[];
  /** 次に往来を引くまでの手番。 */
  nextTrafficTurn?: number;
  /** この探索で護衛の心に差した影の深さ。裏切らずに帰れば、そのぶん信用になる。 */
  betrayalPeak?: number;
  /** 一度きりの予兆を出したか。 */
  betrayalOmenShown?: true;
}

/**
 * 商人が身に着けるもの。
 *
 * 商人は戦わないので武器も防具も持たない —— 持っても使いこなせないからである。
 * 身に着けるのは道具袋ひとつで、それが持ち帰れる量そのものを決める。
 */
export interface EquipmentState {
  bagItemId?: string;
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
  version: 14;
  campaignId: string;
  status: "active" | "gameOver";
  day: number;
  timeSlot: TimeSlot;
  gold: number;
  /** 自宅の金庫に預けた、探索中の死亡では失われない資金。 */
  vaultGold: number;
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
  | { type: "stallOpened"; slots: number }
  | { type: "stallSold"; npcId: string; itemId: string; price: number }
  | { type: "stallClosed"; earned: number }
  | { type: "guardDemand"; guardId: string; amount: number }
  | { type: "arrived"; npcId: string; friendly: boolean }
  | { type: "departed"; npcId: string }
  | { type: "holdup"; npcId: string; amount: number }
  | { type: "robbed"; npcId: string; gold: number; items: number }
  | { type: "rescued"; npcId: string; fromNpcId: string }
  | { type: "guardBetrayed"; guardId: string; gold: number; items: number }
  | { type: "message"; text: string };

export interface TurnResult {
  consumedTurn: boolean;
  events: DungeonEvent[];
  guardDescent?: GuardDescentAssessment;
  /** この手番で護衛が行く手を塞いだ。画面はここから問いを出す。 */
  guardDemand?: GuardDemand;
  /** この手番で誰かに呼び止められた。 */
  holdup?: DungeonHoldup;
}

/**
 * 深層での強請り。
 *
 * 傷を負って逃げるのとは別の話である。無傷の護衛が、誰も見ていないことと、
 * 商人の鞄が重いことに気づいて足を止める —— これは臆病ではなく、計算である。
 */
export interface GuardDemand {
  guardId: string;
  /** 要求額。商人がいま持ち歩いている金の範囲でしか吹っかけない。 */
  amount: number;
  floor: number;
  turn: number;
  /** 断られた要求。次に何が起きてもおかしくない。 */
  refused?: true;
  /** 断られた手番。腹を決めるのは次の一手で、商人にはそのぶんだけ隙がある。 */
  refusedTurn?: number;
}

/**
 * 追いはぎ。
 *
 * 護衛の裏切りとは別で、契約も何もない相手が荷を寄越せと言ってくる。断れば
 * 本当に斬りかかってくる —— **商人は戦えないので、頼れるのは護衛か、その場に
 * 居合わせた誰かの気まぐれだけである。**
 */
export interface DungeonHoldup {
  npcId: string;
  /** 要求額。払える持ち合わせが無ければ、荷そのものを寄越せと言う。 */
  amount: number;
  /** 金では足りず、荷を差し出すしかない。 */
  takesGoods: boolean;
  floor: number;
  turn: number;
  /** 断られた。次の一手から斬りかかってくる。 */
  refused?: true;
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
  /** `unitPrice` は携行食料1個あたりの言い値。需要と所持金の範囲でまとめて売る。 */
  | { type: "sellProvisionsToAdventurer"; npcId: string; unitPrice?: number }
  /** 風呂敷を広げる。`goods` は並べる品と言い値。 */
  | { type: "openStall"; goods: ReadonlyArray<{ itemId: string; price: number }> }
  | { type: "closeStall" }
  /** 強請りへの返事。 */
  | { type: "answerDemand"; pay: boolean }
  /** 追いはぎへの返事。 */
  | { type: "answerHoldup"; hand: boolean }
  | { type: "stairs"; guardResponse?: "continue" | "dismiss" };

export type MenuAction = () => void;

export interface MenuChoice {
  label: string;
  action: MenuAction;
  disabled?: boolean;
}
