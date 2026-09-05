import Phaser from "phaser";
import {
  ACTOR_WALK_FRAMES,
  ASSET_MANIFEST,
  ENEMY_ASSET_VARIANTS,
  NPC_ASSET_VARIANTS,
  GUARD_ASSET_VARIANTS,
  DUNGEON_OBJECT_FRAMES,
} from "../game/assets";
import { CRAFTPIX_ENEMY_ACTORS, actorFrame, type ActorAction, type ActorDirection, type CraftpixActorDefinition } from "../game/craftpixActors";
import { ACTOR_CATALOG, actorDefinition, actorSupportsDirectionalMovement, playerActor } from "../game/actorCatalog";
import { CRAFTPIX_UI } from "../game/craftpixUi";
import {
  APOTHECARY_MEDICINE_IDS,
  DIRECTION,
  DISPLAY_CAPACITY,
  beginExpedition,
  buyMedicineAtApothecary,
  canBeginExpedition,
  createNewGame,
  currentItemCount,
  dungeonAdventurerBuyPrice,
  dungeonProvisionBuyPrice,
  dungeonProvisionDemand,
  dungeonProvisionDemandRemaining,
  isDesperateFor,
  dungeonAdventurerSellPrice,
  dropItem,
  guardRetreatRatio,
  guardRetreatThreshold,
  guardRecoveryTurns,
  inspectBody,
  itemDefinition,
  itemName,
  lootBodyItem,
  moveInventoryItems,
  movePlayer,
  moveStoreItemsToInventory,
  moveToStore,
  performDungeonCommand,
  setDisplayedItems,
  toggleDisplay,
  tryOpenChest,
  tryPickup,
} from "../game/engine";
import { dungeonFogOpacity, hasDungeonVision, isExplored } from "../game/dungeonVision";
import { stallCapacity, stallGoods, stallReadiness } from "../game/dungeonStall";
import { carriedValue } from "../game/guardBetrayal";
import { willRescue } from "../game/dungeonTraffic";
import { dungeonActorAppearance } from "../game/dungeonActors";
import { DUNGEON_PRICE_TIERS, SHOP_PRICE_TIERS, marketPrice } from "../game/pricing";
import { askingPriceFor, canSellInHomeShop } from "../game/merchantEconomy";
import { rankAdventurers, rankingLine, recentLosses } from "../game/adventurerRanking";
import { SaveRepository, type SaveSlot } from "../game/save";
import { HOME_POI, HOME_SPAWN, createHomeMap } from "../game/homeMap";
import { moveMapPosition } from "../game/mapTiles";
import { assignHomeVisitorCells, findHomeVisitorPath } from "../game/homeVisitors";
import { compileMap, loadTrialMap, loadTrialMapPack } from "../game/mapDocument";
import { MISSING_MAP_ASSET_TEXTURE, authoredMapAssetIds, mapAssetDefinitions, mapAssetFootprint, resolveMapAssetFrame } from "../game/mapAssetRuntime";
import { createDungeonRenderPlan, dungeonPieceHalves, dungeonTheme, dungeonThemeAssetIds, dungeonThemeObject, type DungeonThemeObjectKind } from "../game/dungeonThemes";
import { createDefaultMapPack } from "../game/defaultMapPack";
import { acceptCustomerPurchaseRequest, cancelEscortCommission, escortFeeForNpc, isHireable, merchantItemName, postEscortCommission, prepareCustomerPurchaseRequest } from "../game/merchantEconomy";
import { ensureGuardProfile, guardConditionLabel, guardObservationLines, guardTrustLabel } from "../game/guardProfiles";
import { bondSummary, npcBonds } from "../game/npcBonds";
import { demandFor, demandLabel } from "../game/npcDemand";
import { acceptBulkOffer, bulkOrders, canDeliverBulkOrder, declineBulkOffer, deliverBulkOrder, refreshBulkOffer, stockedFor } from "../game/bulkOrders";
import { carriedGearItems, entrustGear, gearSlots, gearSlotFor, isRetained, npcCombatStats, reclaimGear, type GearSlotName } from "../game/npcGear";
import { itemLegendLines, wasEntrusted } from "../game/itemLegend";
import {
  SUPPLY_RULES,
  PROVISIONS_PER_SLOT,
  buySupply,
  canOpenShop,
  canReorganizeHomeInventory,
  closeShopSession,
  depositGold,
  dungeonMealProvisionCost,
  dungeonTimeUntilNextMeal,
  bagCapacity,
  equipBag,
  equippedBag,
  finishCurrentCustomer,
  isShopSessionActive,
  provisionCapacityRemaining,
  provisionSlotCount,
  restUntilMorning,
  startShopSession,
  summonNextCustomer,
  withdrawGold,
} from "../game/merchantSystems";
import { ADVENTURER_RANK_ORDER, ADVENTURER_RANKS, ITEM_VISUALS, MERCHANT_ITEM_DEFINITIONS, NPC_SEEDS, npcAppearanceSprite } from "../game/merchantContent";
import type { BulkOrder, AdventurerRank, DungeonCommand, DungeonEvent, DungeonHoldup, GameState, GuardCareer, GuardDemand, GuardDescentAssessment, ItemInstance, ItemRarity, MenuChoice, NpcRecord, Vec } from "../game/types";
import {
  FLOATING_INK,
  UI_COLORS,
  UI_INK,
  capacityGaugeColors,
  frameBorderWidth,
  hpGaugeColors,
  messageTone,
  rarityInk,
  rarityLabel,
  toneInk,
  UI_PIXEL_SCALE,
  type MessageTone,
} from "../game/uiTheme";
import {
  UI_ICON,
  addDefeatBurst,
  addDivider,
  addEdgeFlash,
  addFloatingValue,
  addGauge,
  addSectionLabel,
  addSelectionBar,
  addSingleLineText,
  addSkinButton,
  addUiIcon,
  addWindow,
} from "./uiSkin";
const ALL_CRAFTPIX_ACTORS: readonly CraftpixActorDefinition[] = Object.values(ACTOR_CATALOG);
/** Viewport and generated fallback textures stay at the game's base pixel grid. */
const VIEWPORT_BASE_TILE = 16;
const PLACEHOLDER_TILE = 16;
const DUNGEON_LEGACY_TILE = 16;
const LEGACY_ACTOR_SCALE = 0.9;
const LEGACY_ACTOR_ORIGIN_Y = 0.94;
/** 闇の色。真っ黒より少し青いほうが石の冷たさが残る。 */
const FOG_INK = 0x05060a;
const MAP_W = 448;
const MAP_H = 288;
const LOG_Y = 288;
const LOG_H = 72;
/** 古い一件は一行、最新の一件は残りの高さで折り返して読ませる。 */
const LOG_ROW_COUNT = 2;
const LOG_TEXT_X = 10;
const LOG_TEXT_W = MAP_W - LOG_TEXT_X * 2;
const LOG_PREVIOUS_Y = 8;
const LOG_PREVIOUS_H = 16;
const LOG_LATEST_SINGLE_Y = 9;
const LOG_LATEST_AFTER_PREVIOUS_Y = 25;
const PANEL_X = 448;
const PANEL_W = 192;
/** 枠の内側1pxを余白にして、文字が金物に触れないようにする。 */
const PANEL_PAD = frameBorderWidth("window") + 1;
const PANEL_CONTENT_X = PANEL_X + PANEL_PAD;
const PANEL_CONTENT_W = PANEL_W - PANEL_PAD * 2;
/** 護衛の行が出る階では、アクション一覧をその分だけ下げる。 */
const ACTION_BUTTON_TOP = 160;
const ACTION_BUTTON_H = 19;
const ACTION_BUTTON_PITCH = 21;
/** ゲージの右に数値を置くための取り分。 */
const GAUGE_VALUE_W = 36;

const SHORTCUTS = {
  investigate: "E",
  inventory: "R",
  talk: "T",
  shop: "F",
  menu: "Tab / Esc",
  shove: "Q",
} as const;
const HOME_CONTROL_LINES = [
  "移動: 矢印 / WASD",
  `${SHORTCUTS.investigate}: 調べる`,
  `${SHORTCUTS.talk}: 話す`,
  `${SHORTCUTS.inventory}: 在庫管理`,
  `${SHORTCUTS.shop}: 開店・閉店`,
  `${SHORTCUTS.menu}: メニュー`,
];
const DUNGEON_CONTROL_LINES = [
  "移動・向き変更: 矢印 / WASD",
  `${SHORTCUTS.investigate}: 足元を調べる`,
  `${SHORTCUTS.shove}: 正面を押し返す`,
  `${SHORTCUTS.inventory}: インベントリ`,
  `${SHORTCUTS.menu}: メニュー`,
];

type HomePoint = { id: string; name: string; kind: "entrance" | "guild" | "visitors" | "customer"; pos: { x: number; y: number }; customerId?: string };
const HOME_POINTS: HomePoint[] = [
  { id: "entrance", name: "ダンジョン入口", kind: "entrance", pos: { x: 16, y: 2 } },
  { id: "guild", name: "依頼・探索準備", kind: "guild", pos: HOME_POI.preparation },
  { id: "visitors", name: "来客", kind: "visitors", pos: HOME_POI.visitors },
];
type InventoryTab = "bag" | "equipment" | "storage" | "display";
const INVENTORY_PAGE_SIZE = 22;

type Modal = {
  title: string;
  body: string[];
  choices: MenuChoice[];
  index: number;
};

type RoamingNpc = {
  sprite: Phaser.GameObjects.Sprite;
  textureKey: string;
  center: Vec;
  radius: Vec;
  phase: number;
  facing: "up" | "down" | "left" | "right";
};

function same(a: Vec, b: Vec): boolean {
  return a.x === b.x && a.y === b.y;
}

function distanceSquared(a: Vec, b: Vec): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export class MerchantScene extends Phaser.Scene {
  private state: GameState = createNewGame();
  private homeMap = createHomeMap();
  private modal?: Modal;
  private inventoryView?: { tab: InventoryTab; selectedId?: string; checkedIds: Set<string>; page: number };
  /** 広げる前の下ごしらえ。品と言い値の下書きで、開店したら捨てる。 */
  private stallDraft?: Map<string, number>;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private readonly saves = new SaveRepository();
  private gameStarted = false;
  private lastAutoSaveAt = Number.NEGATIVE_INFINITY;
  private frameGuardInstalled = false;
  private homeWorld?: Phaser.GameObjects.Container;
  private homeBackdrop?: Phaser.Tilemaps.TilemapLayer;
  private homePlayer?: Phaser.GameObjects.Sprite;
  private homeNpcs: RoamingNpc[] = [];
  private customerWalking = false;
  private dungeonWalkAnimations = new Map<string, "up" | "down" | "left" | "right">();
  private playerFacing: "up" | "down" | "left" | "right" = "down";
  private dungeonWorld?: Phaser.GameObjects.Container;
  /** 地形は階が変わるまで作り直さない。行動のたびに敷き直すと1階あたり数百〜1700枚になる。 */
  private dungeonTerrain?: Phaser.GameObjects.Container;
  private dungeonTerrainKey?: string;
  private dungeonTerrainMask?: Phaser.GameObjects.Graphics;
  private dungeonMaskShape?: Phaser.GameObjects.Graphics;
  private hungerTweens: Phaser.Tweens.Tween[] = [];
  /** ウインドウを開いた回数。同じウインドウの再描画では出現演出を繰り返さない。 */
  /** 直近3件のログ。セーブには入れず、画面の読みやすさだけに使う。 */
  private messageLog: Array<{ text: string; tone: MessageTone }> = [];
  /** 前回描画時の値。差分が出たときだけ増減を浮かせる。 */
  private hudTrace?: { campaignId: string; hp: number; gold: number };
  private windowRevision = 0;
  private animatedRevision = -1;
  private uiOpenTween?: Phaser.Tweens.Tween;

  constructor() {
    super("merchant");
  }

  preload(): void {
    this.load.spritesheet(ASSET_MANIFEST.player.textureKey, ASSET_MANIFEST.player.path, {
      frameWidth: ASSET_MANIFEST.player.frameWidth,
      frameHeight: ASSET_MANIFEST.player.frameHeight,
    });
    this.load.spritesheet(ASSET_MANIFEST.enemy.textureKey, ASSET_MANIFEST.enemy.path, {
      frameWidth: ASSET_MANIFEST.enemy.frameWidth,
      frameHeight: ASSET_MANIFEST.enemy.frameHeight,
    });
    this.load.spritesheet(ASSET_MANIFEST.npc.textureKey, ASSET_MANIFEST.npc.path, {
      frameWidth: ASSET_MANIFEST.npc.frameWidth,
      frameHeight: ASSET_MANIFEST.npc.frameHeight,
    });
    for (const actor of [...NPC_ASSET_VARIANTS, ...ENEMY_ASSET_VARIANTS, ...GUARD_ASSET_VARIANTS]) {
      this.load.spritesheet(actor.textureKey, actor.path, { frameWidth: 32, frameHeight: 32 });
    }
    for (const actor of ALL_CRAFTPIX_ACTORS) {
      for (const [action, clip] of Object.entries(actor.clips)) {
        if (!clip) continue;
        this.load.spritesheet(`craftpix.actor.${actor.id}.${action}`, clip.path, { frameWidth: clip.frameWidth, frameHeight: clip.frameHeight });
      }
    }
    this.load.spritesheet(ASSET_MANIFEST.item.textureKey, ASSET_MANIFEST.item.path, {
      frameWidth: ASSET_MANIFEST.item.frameWidth,
      frameHeight: ASSET_MANIFEST.item.frameHeight,
    });
    for (const [visualId, path] of Object.entries(ITEM_VISUALS)) this.load.image(`merchant.${visualId}`, path);
    this.load.spritesheet("object.dungeon", "assets/objects/dungeon_objects.png", { frameWidth: 24, frameHeight: 24 });
    const defaultPack = createDefaultMapPack();
    const trialPack = loadTrialMapPack();
    const mapAssetIds = dungeonThemeAssetIds();
    for (const id of authoredMapAssetIds([this.homeMap, defaultPack.home, ...defaultPack.dungeons, ...(trialPack ? [trialPack.home, ...trialPack.dungeons] : [])])) mapAssetIds.add(id);
    for (const asset of mapAssetDefinitions(mapAssetIds)) this.load.spritesheet(`map.asset.${asset.id}`, asset.path, { frameWidth: asset.tileSize, frameHeight: asset.tileSize, margin: asset.margin, spacing: asset.spacing });
    this.load.image(ASSET_MANIFEST.mapTiles.homeFloor.textureKey, ASSET_MANIFEST.mapTiles.homeFloor.path);
    this.load.spritesheet(ASSET_MANIFEST.mapTiles.homeWall.textureKey, ASSET_MANIFEST.mapTiles.homeWall.path, { frameWidth: 16, frameHeight: 16 });
    this.load.image(ASSET_MANIFEST.mapTiles.dungeonFloor.textureKey, ASSET_MANIFEST.mapTiles.dungeonFloor.path);
    this.load.spritesheet(ASSET_MANIFEST.mapTiles.dungeonWall.textureKey, ASSET_MANIFEST.mapTiles.dungeonWall.path, { frameWidth: 16, frameHeight: 16 });
    this.load.image("ui.craftpix.panel", CRAFTPIX_UI.panel.path);
    this.load.spritesheet("ui.craftpix.buttons", CRAFTPIX_UI.buttons.path, { frameWidth: CRAFTPIX_UI.buttons.frameWidth, frameHeight: CRAFTPIX_UI.buttons.frameHeight });
    this.load.spritesheet("ui.craftpix.icons", CRAFTPIX_UI.icons.path, { frameWidth: CRAFTPIX_UI.icons.frameWidth, frameHeight: CRAFTPIX_UI.icons.frameHeight });
    this.load.image("ui.craftpix.character-panel", CRAFTPIX_UI.characterPanel.path);
  }

  /**
   * Phaser は次フレームの予約をコールバックの「後」で行う（RequestAnimationFrame.js:91-95）。
   * そのため1フレーム中に例外が一度でも漏れると requestAnimationFrame が再予約されず、
   * 画面は最後のフレームのまま固まり、キーもマウスも一切効かなくなる。
   * ここで受け止めておけば、不具合は console に残るがゲームは動き続ける。
   */
  private installFrameGuard(): void {
    if (this.frameGuardInstalled) return;
    const raf = this.game.loop.raf;
    if (!raf) return;
    this.frameGuardInstalled = true;
    const step = raf.callback;
    let failures = 0;
    raf.callback = (time: number): void => {
      try {
        step(time);
      } catch (error) {
        failures += 1;
        // 毎フレーム同じ例外が出ることがあるので、最初の数回だけ出して以降は間引く。
        if (failures <= 5 || failures % 300 === 0) console.error(`[frame:${failures}]`, error);
      }
    };
  }

  create(): void {
    this.installFrameGuard();
    // Every coordinate in this scene is on the 640x360 layout grid, so the
    // camera magnifies that grid to fill the larger canvas.
    // Origin at the top-left keeps the transform a plain multiply, so layout
    // coordinate (0,0) is canvas (0,0) whatever the scale factor is.
    this.cameras.main.setZoom(UI_PIXEL_SCALE).setOrigin(0, 0).setScroll(0, 0);
    // Text is rasterised by the browser at its font size and then magnified with
    // the rest of the scene. Rendering it at the camera's factor instead puts one
    // glyph pixel on one screen pixel, which is what makes small kanji readable.
    this.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, (object: Phaser.GameObjects.GameObject) => {
      if (object instanceof Phaser.GameObjects.Text) object.setResolution(UI_PIXEL_SCALE);
    });
    if (!this.input.keyboard) throw new Error("キーボード入力を初期化できませんでした。");
    this.keys = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.UP,
      down: Phaser.Input.Keyboard.KeyCodes.DOWN,
      left: Phaser.Input.Keyboard.KeyCodes.LEFT,
      right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      w: Phaser.Input.Keyboard.KeyCodes.W,
      a: Phaser.Input.Keyboard.KeyCodes.A,
      s: Phaser.Input.Keyboard.KeyCodes.S,
      d: Phaser.Input.Keyboard.KeyCodes.D,
      enter: Phaser.Input.Keyboard.KeyCodes.ENTER,
      e: Phaser.Input.Keyboard.KeyCodes.E,
      f: Phaser.Input.Keyboard.KeyCodes.F,
      r: Phaser.Input.Keyboard.KeyCodes.R,
      t: Phaser.Input.Keyboard.KeyCodes.T,
      tab: Phaser.Input.Keyboard.KeyCodes.TAB,
      space: Phaser.Input.Keyboard.KeyCodes.SPACE,
      escape: Phaser.Input.Keyboard.KeyCodes.ESC,
      q: Phaser.Input.Keyboard.KeyCodes.Q,
    }) as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.on("wheel", (_pointer: Phaser.Input.Pointer, _over: Phaser.GameObjects.GameObject[], _deltaX: number, deltaY: number) => {
      if (!this.modal || deltaY === 0) return;
      this.modal.index = Phaser.Math.Clamp(this.modal.index + Math.sign(deltaY), 0, this.modal.choices.length - 1);
      this.render();
    });
    this.createPlaceholderTextures();
    this.createActorAnimations();
    const params = new URLSearchParams(window.location.search);
    if (params.get("autostart") === "world") {
      const pack = loadTrialMapPack();
      const trial = pack?.home ?? loadTrialMap();
      if (trial?.kind === "home") {
        this.homeMap = trial;
        const spawn = trial.markers.find((marker) => marker.kind === "homeSpawn");
        this.state = createNewGame();
        this.state.homePos = { x: (spawn?.x ?? 16) * trial.tileSize + trial.tileSize / 2, y: (spawn?.y ?? 16) * trial.tileSize + trial.tileSize / 2 };
        this.gameStarted = true;
        this.render();
        return;
      }
      if (trial?.kind === "dungeon") {
        const map = compileMap(trial);
        const entrance = trial.markers.find((marker) => marker.kind === "stairsUp");
        this.state = createNewGame();
        this.state.location = "dungeon";
        this.state.run = { seed: Date.now(), themeScheduleVersion: 1, themePoolIds: ["cave"], startedDay: this.state.day, floor: trial.floor, map, player: { x: entrance?.x ?? map.stairsUp.x, y: entrance?.y ?? map.stairsUp.y }, enemies: [], items: [], chests: [], bodies: [], adventurers: [], shoveCooldown: 0, highestFloor: trial.floor, turn: 0, timeUnits: 0, settledTimeBands: 0, floorStates: {} };
        this.gameStarted = true;
        this.render();
        return;
      }
    }
    if (params.get("autostart") === "dungeon") {
      this.state = createNewGame();
      beginExpedition(this.state);
      this.gameStarted = true;
      this.render();
      return;
    }
    void this.openTitle();
  }

  update(_time: number, delta: number): void {
    if (this.gameStarted && this.inventoryView && (this.just("escape") || this.just("r"))) {
      this.inventoryView = undefined;
      this.render();
      return;
    }
    if (this.gameStarted && this.inventoryView && this.just("tab")) {
      this.inventoryView = undefined;
      this.openSystemMenu();
      this.render();
      return;
    }
    if (this.gameStarted && this.inventoryView) return;
    if (this.gameStarted && (this.just("escape") || this.just("tab"))) {
      if (this.modal) {
        this.modal = undefined;
        this.render();
      } else {
        this.openSystemMenu();
        this.render();
      }
      return;
    }

    if (this.modal) {
      this.updateModalInput();
      return;
    }

    if (!this.gameStarted) return;

    if (this.state.location === "home") this.updateHome(delta);
    else this.updateDungeon();
  }

  private just(key: string): boolean {
    return Phaser.Input.Keyboard.JustDown(this.keys[key]!);
  }

  private updateModalInput(): void {
    if (!this.modal) return;
    let selectionChanged = false;
    if (this.just("up") || this.just("w")) {
      this.modal.index = (this.modal.index - 1 + this.modal.choices.length) % this.modal.choices.length;
      selectionChanged = true;
    }
    if (this.just("down") || this.just("s")) {
      this.modal.index = (this.modal.index + 1) % this.modal.choices.length;
      selectionChanged = true;
    }
    if (this.just("enter") || this.just("space")) {
      const choice = this.modal.choices[this.modal.index];
      if (choice && !choice.disabled) choice.action();
      // メニュー遷移だけを描き直す。接客終了など、処理内で描画して
      // Tweenを開始した操作を再描画すると、移動中のSpriteが破棄される。
      if (this.modal) this.render();
      return;
    }
    if (selectionChanged) this.render();
  }

  private createPlaceholderTextures(): void {
    const texture = (name: string, colors: [number, number]): void => {
      if (this.textures.exists(name)) return;
      const graphics = this.make.graphics({ x: 0, y: 0 });
      graphics.fillStyle(colors[0], 1).fillRect(2, 3, 20, 19);
      graphics.fillStyle(colors[1], 1).fillRect(5, 1, 14, 7);
      graphics.fillStyle(0x191521, 1).fillRect(6, 9, 3, 3).fillRect(15, 9, 3, 3);
      graphics.generateTexture(name, PLACEHOLDER_TILE, PLACEHOLDER_TILE);
      graphics.destroy();
    };
    texture(ASSET_MANIFEST.player.textureKey, [0xead8b6, 0x9d4a59]);
    texture(ASSET_MANIFEST.enemy.textureKey, [0x6a476d, 0xd06f87]);
    texture(ASSET_MANIFEST.npc.textureKey, [0xc29f70, 0x6c6b94]);
    texture(ASSET_MANIFEST.item.textureKey, [0xc9af58, 0xffeb91]);
    if (!this.textures.exists(MISSING_MAP_ASSET_TEXTURE)) {
      const graphics = this.make.graphics({ x: 0, y: 0 });
      graphics.fillStyle(0xff00aa, 1).fillRect(0, 0, 8, 8).fillRect(8, 8, 8, 8);
      graphics.fillStyle(0x200018, 1).fillRect(8, 0, 8, 8).fillRect(0, 8, 8, 8);
      graphics.lineStyle(3, 0xffff00, 1).beginPath().moveTo(2, 2).lineTo(14, 14).moveTo(14, 2).lineTo(2, 14).strokePath();
      graphics.generateTexture(MISSING_MAP_ASSET_TEXTURE, 16, 16);
      graphics.destroy();
    }
  }

  private createActorAnimations(): void {
    this.createActorAnimationSet(ASSET_MANIFEST.player.textureKey, "player");
    this.createActorAnimationSet(ASSET_MANIFEST.npc.textureKey, ASSET_MANIFEST.npc.textureKey);
    this.createActorAnimationSet(ASSET_MANIFEST.enemy.textureKey, ASSET_MANIFEST.enemy.textureKey);
    for (const actor of [...NPC_ASSET_VARIANTS, ...ENEMY_ASSET_VARIANTS, ...GUARD_ASSET_VARIANTS]) this.createActorAnimationSet(actor.textureKey, actor.textureKey);
    this.createCraftpixActorAnimations();
  }

  private createCraftpixActorAnimations(): void {
    for (const actor of ALL_CRAFTPIX_ACTORS) {
      for (const [actionName, clip] of Object.entries(actor.clips) as [ActorAction, NonNullable<CraftpixActorDefinition["clips"][ActorAction]>][]) {
        if (!clip || !this.textures.exists(`craftpix.actor.${actor.id}.${actionName}`)) continue;
        for (const direction of clip.directions) {
          const key = this.craftpixAnimationKey(actor.id, actionName, direction);
          if (this.anims.exists(key)) continue;
          const frames = Array.from({ length: clip.columns }, (_, index) => ({
            key: `craftpix.actor.${actor.id}.${actionName}`,
            frame: actorFrame(clip, direction, index),
            ...(clip.durationsMs?.[index] ? { duration: clip.durationsMs[index] } : {}),
          }));
          this.anims.create({ key, frames, frameRate: clip.frameRate, repeat: clip.repeat });
        }
      }
    }
  }


  private craftpixAnimationKey(actorId: string, action: ActorAction, direction: ActorDirection): string {
    return `craftpix.${actorId}.${action}-${direction}`;
  }

  private craftpixActorTexture(actor: CraftpixActorDefinition, action: ActorAction = "idle"): string | undefined {
    const clip = actor.clips[action] ?? actor.clips.idle;
    if (!clip) return undefined;
    const key = `craftpix.actor.${actor.id}.${clip.action}`;
    return this.textures.exists(key) ? key : undefined;
  }

  private playCraftpixActor(sprite: Phaser.GameObjects.Sprite, actor: CraftpixActorDefinition, action: ActorAction, direction: ActorDirection, ignoreIfPlaying = true, scaleMultiplier = 1): boolean {
    // 破棄済みのスプライトに触れると例外が漏れ、ゲームループが二度と再開しない（installFrameGuard 参照）。
    if (!sprite.scene || !sprite.anims) return false;
    const clip = actor.clips[action] ?? actor.clips.idle;
    if (!clip) return false;
    const textureKey = this.craftpixActorTexture(actor, action);
    const key = this.craftpixAnimationKey(actor.id, clip.action, direction);
    if (!textureKey || !this.anims.exists(key)) return false;
    if (!sprite.texture.key.startsWith("craftpix.actor.")) sprite.setTexture(textureKey, actorFrame(clip, direction, 0));
    sprite.setOrigin(actor.origin.x, actor.origin.y).setScale(actor.scale * scaleMultiplier);
    sprite.play(key, ignoreIfPlaying);
    return true;
  }

  private createActorAnimationSet(textureKey: string, prefix: string): void {
    if (this.anims.exists(`${prefix}.idle`)) return;
    const create = (suffix: "idle" | "idle-down" | "idle-left" | "idle-right" | "idle-up" | "walk-down" | "walk-left" | "walk-right" | "walk-up", frames: readonly number[], rate: number): void => {
      this.anims.create({ key: `${prefix}.${suffix}`, frames: frames.map((frame) => ({ key: textureKey, frame })), frameRate: rate, repeat: -1 });
    };
    create("idle", ACTOR_WALK_FRAMES.idle, 1);
    create("idle-down", ACTOR_WALK_FRAMES.idleDown, 1);
    create("idle-left", ACTOR_WALK_FRAMES.idleLeft, 1);
    create("idle-right", ACTOR_WALK_FRAMES.idleRight, 1);
    create("idle-up", ACTOR_WALK_FRAMES.idleUp, 1);
    create("walk-down", ACTOR_WALK_FRAMES.walkDown, 7);
    create("walk-left", ACTOR_WALK_FRAMES.walkLeft, 7);
    create("walk-right", ACTOR_WALK_FRAMES.walkRight, 7);
    create("walk-up", ACTOR_WALK_FRAMES.walkUp, 7);
  }

  private updateHome(delta: number): void {
    if (isShopSessionActive(this.state)) {
      if (this.just("r")) {
        this.openInventory();
        return;
      }
      if (this.customerWalking) return;
      if (this.just("f")) this.closeActiveShop();
      return;
    }
    let moved = false;
    const tapHorizontal = Number(this.just("right") || this.just("d")) - Number(this.just("left") || this.just("a"));
    const tapVertical = Number(this.just("down") || this.just("s")) - Number(this.just("up") || this.just("w"));
    const heldHorizontal = Number(this.keys.right.isDown || this.keys.d.isDown) - Number(this.keys.left.isDown || this.keys.a.isDown);
    const heldVertical = Number(this.keys.down.isDown || this.keys.s.isDown) - Number(this.keys.up.isDown || this.keys.w.isDown);
    const horizontal = heldHorizontal || tapHorizontal;
    const vertical = heldVertical || tapVertical;
    if (horizontal !== 0 || vertical !== 0) {
      this.playerFacing = Math.abs(horizontal) > Math.abs(vertical)
        ? horizontal < 0 ? "left" : "right"
        : vertical < 0 ? "up" : "down";
      const length = Math.hypot(horizontal, vertical);
      const homeScale = this.homeScale();
      const speed = 126 * homeScale;
      const stepSeconds = Math.max(delta / 1000, tapHorizontal !== 0 || tapVertical !== 0 ? 0.05 : 0);
      const next = moveMapPosition(this.homeMap, this.state.homePos, {
        x: (horizontal / length) * speed * stepSeconds,
        y: (vertical / length) * speed * stepSeconds,
      }, 5 * homeScale);
      moved = next.x !== this.state.homePos.x || next.y !== this.state.homePos.y;
      this.state.homePos = next;
    }
    const investigate = this.just("e");
    const talk = this.just("t");
    const inventory = this.just("r");
    const shop = this.just("f");
    if (investigate) this.investigateHome();
    if (talk) this.talkHome();
    if (inventory) this.openInventory();
    if (shop) this.openShopForDay();
    if (moved) {
      this.playHomePlayerMotion(horizontal, vertical);
      this.updateHomePresentation();
      this.saveAuto();
    } else if (this.homePlayer) {
      const protagonist = playerActor();
      if (!protagonist || !this.playCraftpixActor(this.homePlayer, protagonist, "idle", this.playerFacing, true, this.homeScale())) this.homePlayer.play(`player.idle-${this.playerFacing}`, true);
    }
    this.updateHomeNpcs(delta);
    if (investigate || talk || inventory || shop) this.render();
  }

  private updateDungeon(): void {
    let acted = false;
    const events: DungeonEvent[] = [];
    const beforePlayer = this.state.run ? { ...this.state.run.player } : undefined;
    const beforeEnemies = new Map(this.state.run?.enemies.map((enemy) => [enemy.id, { ...enemy.pos }]) ?? []);
    const beforeGuard = this.state.run?.guard ? { id: this.state.run.guard.guardId, pos: { ...this.state.run.guard.pos } } : undefined;
    if (this.just("up") || this.just("w")) { this.playerFacing = "up"; events.push(...movePlayer(this.state, DIRECTION.up).events); acted = true; }
    else if (this.just("down") || this.just("s")) { this.playerFacing = "down"; events.push(...movePlayer(this.state, DIRECTION.down).events); acted = true; }
    else if (this.just("left") || this.just("a")) { this.playerFacing = "left"; events.push(...movePlayer(this.state, DIRECTION.left).events); acted = true; }
    else if (this.just("right") || this.just("d")) { this.playerFacing = "right"; events.push(...movePlayer(this.state, DIRECTION.right).events); acted = true; }
    if (this.just("e")) { this.interactDungeon(); acted = true; }
    if (this.just("q")) { events.push(...performDungeonCommand(this.state, { type: "shove", direction: this.facingDirection() }).events); acted = true; }
    const inventory = this.just("r");
    if (inventory) this.openInventory();
    if (acted) this.captureDungeonWalkAnimations(beforePlayer, beforeEnemies, beforeGuard);
    if (acted || inventory) {
      this.render();
      this.animateDungeonEvents(events);
    }
  }

  private captureDungeonWalkAnimations(
    beforePlayer: Vec | undefined,
    beforeEnemies: Map<string, Vec>,
    beforeGuard?: { id: string; pos: Vec },
  ): void {
    const run = this.state.run;
    if (!run) return;
    const direction = (from: Vec | undefined, to: Vec): "up" | "down" | "left" | "right" | undefined => {
      if (!from) return undefined;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      if (Math.abs(dx) > Math.abs(dy) && dx !== 0) return dx < 0 ? "left" : "right";
      if (dy !== 0) return dy < 0 ? "up" : "down";
      return undefined;
    };
    const playerDirection = direction(beforePlayer, run.player);
    if (playerDirection) {
      this.playerFacing = playerDirection;
      this.dungeonWalkAnimations.set("player", playerDirection);
    } else this.dungeonWalkAnimations.set("player", this.playerFacing);
    for (const enemy of run.enemies) {
      const enemyDirection = direction(beforeEnemies.get(enemy.id), enemy.pos);
      if (enemyDirection) this.dungeonWalkAnimations.set(enemy.id, enemyDirection);
    }
    if (run.guard) {
      const guardDirection = direction(beforeGuard?.id === run.guard.guardId ? beforeGuard.pos : undefined, run.guard.pos);
      if (guardDirection) this.dungeonWalkAnimations.set(run.guard.guardId, guardDirection);
    }
  }

  private nearbyHomePoint(filter: (point: HomePoint) => boolean): HomePoint | undefined {
    const interactionDistance = 30 * this.homeScale();
    return this.homePoints().filter(filter).find((entry) => distanceSquared(this.poiPosition(entry), this.state.homePos) <= interactionDistance * interactionDistance);
  }

  private talkHome(): void {
    const npc = this.nearbyHomePoint((point) => point.kind === "customer");
    if (npc?.customerId) {
      this.openNpcVisitor(npc.customerId);
      return;
    }
    this.state.message = "近くに話せる相手はいない。";
  }

  private investigateHome(): void {
    const poi = this.nearbyHomePoint((point) => point.kind !== "customer");
    if (!poi) {
      this.state.message = "近くに調べられる施設はない。";
      return;
    }
    switch (poi.kind) {
      case "entrance":
        this.requestExpeditionStart();
        return;
      case "guild":
        this.openGuildMenu();
        return;
      case "visitors":
        this.openMenu("今日の来客", [
          ...this.state.visitorNpcIds.map((id) => this.state.npcs.find((npc) => npc.id === id)?.name ?? id),
          this.state.escortCommission?.status === "accepted" ? "護衛依頼を受けた冒険者が出発を待っている。" : "販売品を棚に並べ、客からの購入希望を待とう。",
        ], [{ label: "閉じる", action: () => this.closeMenu() }]);
        return;
      case "customer":
        return;
    }
  }

  private interactDungeon(): void {
    const run = this.state.run;
    if (!run) return;
    const facing = this.facingDirection();
    const facingPos = { x: run.player.x + facing.x, y: run.player.y + facing.y };
    const adventurer = run.adventurers.find((entry) => same(entry.pos, facingPos));
    if (adventurer) {
      this.openDungeonAdventurer(adventurer.npcId);
      return;
    }
    const ground = run.items.find((entry) => same(entry.pos, run.player));
    if (ground) {
      if (currentItemCount(this.state) < bagCapacity(this.state)) tryPickup(this.state);
      else this.openSwapMenu(ground.item, (swapOutId) => { tryPickup(this.state, swapOutId); this.closeMenu(); });
      return;
    }
    const chest = run.chests.find((entry) => same(entry.pos, run.player));
    if (chest) {
      if (currentItemCount(this.state) < bagCapacity(this.state)) tryOpenChest(this.state, chest.id);
      else this.openSwapMenu(chest.item, (swapOutId) => { tryOpenChest(this.state, chest.id, swapOutId); this.closeMenu(); });
      return;
    }
    const body = run.bodies.find((entry) => same(entry.pos, run.player));
    if (body) {
      if (!body.inspected) inspectBody(this.state, body.id);
      this.openBodyMenu(body.id);
      return;
    }
    if ((run.map.stairsDown && same(run.player, run.map.stairsDown)) || same(run.player, run.map.stairsUp)) {
      this.executeDungeonCommand({ type: "stairs" });
      return;
    }
    this.state.message = "何も見つからない。";
  }

  private facingDirection(): Vec {
    return DIRECTION[this.playerFacing];
  }

  private executeDungeonCommand(command: DungeonCommand): void {
    const beforePlayer = this.state.run ? { ...this.state.run.player } : undefined;
    const beforeEnemies = new Map(this.state.run?.enemies.map((enemy) => [enemy.id, { ...enemy.pos }]) ?? []);
    const beforeGuard = this.state.run?.guard ? { id: this.state.run.guard.guardId, pos: { ...this.state.run.guard.pos } } : undefined;
    this.modal = undefined;
    const result = performDungeonCommand(this.state, command);
    this.captureDungeonWalkAnimations(beforePlayer, beforeEnemies, beforeGuard);
    if (result.guardDescent) {
      this.openGuardDescentPrompt(result.guardDescent);
      this.render();
      return;
    }
    if (result.guardDemand) {
      this.openGuardDemandPrompt(result.guardDemand);
      this.render();
      return;
    }
    if (result.holdup) {
      this.openHoldupPrompt(result.holdup);
      this.render();
      return;
    }
    this.render();
    this.animateDungeonEvents(result.events);
  }

  private openGuardDescentPrompt(assessment: GuardDescentAssessment): void {
    const npc = this.state.npcs.find((entry) => entry.id === assessment.guardId);
    const name = npc?.name ?? "護衛";
    const refusal = assessment.severity === "refuse";
    this.openMenu(refusal ? "護衛が同行を拒んだ" : "護衛からの警告", [
      assessment.reason,
      refusal
        ? `${name}を町へ帰せば、返金なしでひとりで降下できる。`
        : "警告を押して進むと、護衛の信頼と平静を損なう。",
    ], [
      {
        label: refusal ? "護衛を帰して単独で降りる" : "警告を押して降りる",
        action: () => this.executeDungeonCommand({ type: "stairs", guardResponse: refusal ? "dismiss" : "continue" }),
      },
      { label: "降下しない", action: () => this.closeMenu() },
    ]);
  }

  /**
   * 護衛が行く手を塞いだ。
   *
   * 断れば済む話ではない —— 誰も見ていない深さで、この相手は自分より強い。
   * 払うか、突っぱねるか。突っぱねた先に何が起きるかは、次の一手で分かる。
   */
  private openGuardDemandPrompt(demand: GuardDemand): void {
    const npc = this.state.npcs.find((entry) => entry.id === demand.guardId);
    const name = npc?.name ?? "護衛";
    const payable = this.state.gold >= demand.amount;
    this.openMenu("護衛が足を止めた", [
      `${name}「ここまでの分は、聞いていた額では足りません。${demand.amount}G、いただけますか」`,
      `所持金 ${this.state.gold}G　鞄の値打ち およそ${carriedValue(this.state)}G`,
      `地下${demand.floor}階。まわりに、ほかに誰もいない。`,
    ], [
      {
        label: payable ? `${demand.amount}Gを渡す` : `${demand.amount}Gは払えない`,
        disabled: !payable,
        action: () => this.executeDungeonCommand({ type: "answerDemand", pay: true }),
      },
      { label: "断る", action: () => this.executeDungeonCommand({ type: "answerDemand", pay: false }) },
    ]);
  }

  /**
   * 追いはぎに呼び止められた。
   *
   * 商人は戦えないので、断った先にあるのは自分の身体ではなく、**誰が前に出るか**である。
   * 護衛が仕事をするかもしれないし、居合わせた顔なじみが庇うかもしれないし、
   * 誰も動かないかもしれない。
   */
  private openHoldupPrompt(holdup: DungeonHoldup): void {
    const npc = this.state.npcs.find((entry) => entry.id === holdup.npcId);
    const name = npc?.name ?? "追いはぎ";
    const guard = this.state.run?.guard;
    const guardNpc = guard ? this.state.npcs.find((entry) => entry.id === guard.guardId) : undefined;
    // 庇ってくれそうな顔ぶれ。確約はしない —— 実際にどうするかは、その時になってみないと分からない。
    const bystanders = (this.state.run?.adventurers ?? [])
      .filter((entry) => entry.npcId !== holdup.npcId)
      .map((entry) => this.state.npcs.find((candidate) => candidate.id === entry.npcId))
      .filter((entry): entry is NpcRecord => Boolean(entry) && willRescue(entry!, ensureGuardProfile(this.state, entry!)));
    this.openMenu("行く手を塞がれた", [
      holdup.takesGoods
        ? `${name}「その荷を置いていけ。ここで何があったか、誰も知らない」`
        : `${name}「${holdup.amount}G。出せば通してやる」`,
      `地下${holdup.floor}階　所持金 ${this.state.gold}G　鞄 ${currentItemCount(this.state)}/${bagCapacity(this.state)}枠`,
      guard?.mode === "covering" ? `${guardNpc?.name ?? "護衛"}が前に立っている。` : "前に立ってくれる者はいない。",
      bystanders.length ? `${bystanders.map((entry) => entry.name).join("、")}がこちらを見ている。` : "",
    ], [
      {
        label: holdup.takesGoods ? `荷の半分を差し出す` : `${holdup.amount}Gを渡す`,
        action: () => this.executeDungeonCommand({ type: "answerHoldup", hand: true }),
      },
      { label: "断る", action: () => this.executeDungeonCommand({ type: "answerHoldup", hand: false }) },
    ]);
  }

  private openDungeonActionMenu(): void {
    const run = this.state.run;
    if (!run) return;
    const direction = this.facingDirection();
    const target = { x: run.player.x + direction.x, y: run.player.y + direction.y };
    const enemy = run.enemies.find((entry) => same(entry.pos, target));
    this.openMenu("行動", [
      `向き: ${this.playerFacing === "up" ? "上" : this.playerFacing === "down" ? "下" : this.playerFacing === "left" ? "左" : "右"}`,
      `押し返し: ${run.shoveCooldown > 0 ? `あと${run.shoveCooldown}ターン` : enemy ? `${enemy.name}を対象` : "対象なし"}`,
    ], [
      {
        label: "押し返す（ダメージなし）",
        disabled: !enemy || run.shoveCooldown > 0,
        action: () => this.executeDungeonCommand({ type: "shove", direction }),
      },
      { label: "道具を使う", action: () => this.openDungeonTools() },
      { label: "待機する", action: () => this.executeDungeonCommand({ type: "wait" }) },
      { label: "護衛状態", action: () => this.openActiveGuardStatus() },
      { label: "持ち物", action: () => this.openInventory() },
      { label: "閉じる", action: () => this.closeMenu() },
    ]);
  }

  private openDungeonTools(): void {
    this.openMenu("探索道具", ["道具の使用は1ターン消費する。"], [
      { label: `煙玉（残り${this.state.smokeBombs}）`, disabled: this.state.smokeBombs <= 0, action: () => this.executeDungeonCommand({ type: "smoke" }) },
      { label: `帰還石（残り${this.state.returnStones}）`, disabled: this.state.returnStones <= 0, action: () => this.executeDungeonCommand({ type: "return" }) },
      { label: "戻る", action: () => this.openDungeonActionMenu() },
    ]);
  }

  private openActiveGuardStatus(): void {
    const active = this.state.run?.guard;
    if (!active) {
      this.openMenu("護衛状態", ["この遠征に同行している護衛はいない。", "落とした剣の依頼後、ギルドで雇用できる。"], [
        { label: "閉じる", action: () => this.closeMenu() },
      ]);
      return;
    }
    const npc = this.state.npcs.find((entry) => entry.id === active.guardId);
    const retreatPercent = Math.round(guardRetreatRatio(this.state, active.guardId) * 100);
    const recoveryTurns = guardRecoveryTurns(this.state, active.guardId);
    const profile = npc ? ensureGuardProfile(this.state, npc) : undefined;
    const mode = active.mode === "covering" ? "カバー中" : `後退中（安全確認 ${active.safeTurns}/${recoveryTurns}）`;
    this.openMenu("護衛状態", [
      `${npc ? `${npc.rank ?? "E"}ランク ${npc.name}` : active.guardId}${npc ? ` — ${this.professionLabel(npc)}` : ""}`,
      `HP ${active.hp}/${active.maxHp}　攻撃 ${active.damage}　${mode}`,
      ...(profile ? [`関係: ${guardTrustLabel(profile.trust)}　様子: ${guardConditionLabel(profile.stress)}`] : []),
      `HPが${guardRetreatThreshold(this.state, active)}（${retreatPercent}%）以下になると後退。敵が6マス外に${recoveryTurns}ターンいれば復帰する。`,
      "主人公と同じ隊列で近くの敵を自動攻撃する。致命傷を受けると死亡する。",
    ], [{ label: "閉じる", action: () => this.closeMenu() }]);
  }

  private openBodyMenu(bodyId: string): void {
    const body = this.state.run?.bodies.find((entry) => entry.id === bodyId);
    if (!body) return;
    const deadNpc = body.npcId ? this.state.npcs.find((npc) => npc.id === body.npcId) : undefined;
    const entrusted = body.loot.find((item) => wasEntrusted(item));
    const lines = deadNpc
      ? [
        `${deadNpc.name}という名の${this.professionLabel(deadNpc)}だ。`,
        ...(entrusted ? [`あなたが預けた${itemName(entrusted)}が、まだ握られている。`] : []),
        body.loot.length > 0 ? "所持品を選んで回収する。" : "所持品は残っていない。",
      ]
      : body.id === "aron"
      ? ["認識票には『アロン』と刻まれている。", body.loot.length > 0 ? "残された遺品を選んで回収する。" : "回収できる遺品は残っていない。"]
      : ["身元不明の古い遺体だ。", "持ち帰れる物は残っていない。"];
    this.openMenu(body.name, lines, [
      ...body.loot.map((item) => ({
        label: `回収: ${itemName(item)}${wasEntrusted(item) ? "（あなたが預けた品）" : ""}`,
        action: () => {
          if (currentItemCount(this.state) < bagCapacity(this.state)) {
            lootBodyItem(this.state, body.id, item.uuid);
            this.openBodyMenu(body.id);
          } else {
            this.openSwapMenu(item, (swapOutId) => { lootBodyItem(this.state, body.id, item.uuid, swapOutId); this.openBodyMenu(body.id); }, () => this.openBodyMenu(body.id));
          }
        },
      })),
      { label: "閉じる", action: () => this.closeMenu() },
    ]);
  }

  private openSwapMenu(incoming: ItemInstance, onSwap: (swapOutId?: string) => void, onBack: () => void = () => this.closeMenu()): void {
    const slotsNeeded = Math.max(1, currentItemCount(this.state) - bagCapacity(this.state) + 1);
    const currentFoodSlots = provisionSlotCount(this.state.provisions);
    const foodToDiscard = currentFoodSlots >= slotsNeeded
      ? Math.max(0, this.state.provisions - (currentFoodSlots - slotsNeeded) * PROVISIONS_PER_SLOT)
      : 0;
    this.openMenu("持ち物を入れ替える", [
      `鞄は${bagCapacity(this.state)}枠でいっぱいだ。${itemName(incoming)}を持つには1枠空ける必要がある。`,
      `品物は1点で1枠、携行食料は${PROVISIONS_PER_SLOT}個まで1枠。置いた品物は足元に残る。`,
    ], [
      ...this.state.inventory.map((item) => ({
        label: `置く: ${itemName(item)}`,
        action: () => onSwap(item.uuid),
      })),
      ...(foodToDiscard > 0 ? [{
        label: `捨てる: 携行食料${foodToDiscard}個（${slotsNeeded}枠空ける）`,
        action: () => {
          this.state.provisions -= foodToDiscard;
          onSwap(undefined);
        },
      }] : []),
      { label: "やめる", action: onBack },
    ]);
  }

  private poiPosition(poi: HomePoint): Vec {
    return { x: poi.pos.x * this.homeMap.tileSize + this.homeMap.tileSize / 2, y: poi.pos.y * this.homeMap.tileSize + this.homeMap.tileSize / 2 };
  }

  private homeScale(): number { return this.homeMap.tileSize / VIEWPORT_BASE_TILE; }

  private openMenu(title: string, body: string[], choices: MenuChoice[]): void {
    body = body.filter((line) => line.length > 0);
    this.modal = { title, body, choices, index: 0 };
    this.windowRevision += 1;
  }

  private closeMenu(): void {
    this.modal = undefined;
    this.render();
  }

  private async openTitle(): Promise<void> {
    const choices = (available: SaveSlot[]): MenuChoice[] => [
      { label: "新しい商人として始める", action: () => { this.state = createNewGame(); this.gameStarted = true; this.closeMenu(); } },
      ...(["autosave", "manual-1", "manual-2", "manual-3"] as SaveSlot[]).map((slot) => ({
        label: slot === "autosave" ? "自動保存を再開" : `手動保存 ${slot.at(-1)} を読み込む`,
        disabled: !available.includes(slot),
        action: () => { void this.loadSlot(slot); },
      })),
    ];
    this.openMenu("Dungeon Curio Merchant", [], choices([]));
    this.render();
    const available = await this.saves.availableSlots();
    if (this.gameStarted) return;
    this.openMenu("Dungeon Curio Merchant", [], choices(available));
    this.render();
  }

  private async loadSlot(slot: SaveSlot): Promise<void> {
    const saved = await this.saves.load(slot);
    if (!saved) return;
    this.state = saved.state;
    this.gameStarted = true;
    this.modal = undefined;
    this.state.message = `${slot === "autosave" ? "自動保存" : "手動保存"}を読み込んだ。`;
    this.render();
  }

  private async saveManual(slot: SaveSlot): Promise<void> {
    const label = slot.replace("manual-", "手動保存 ");
    try {
      await this.saves.save(slot, this.state);
      this.state.message = `${label}へ記録した。`;
      this.openMenu("保存しました", [`${label}へ現在の進行を記録しました。`], [
        { label: "メニューへ戻る", action: () => this.openSystemMenu() },
        { label: "ゲームへ戻る", action: () => this.closeMenu() },
      ]);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "不明なエラー";
      this.state.message = `${label}への保存に失敗した。`;
      this.openMenu("保存できませんでした", [reason], [{ label: "メニューへ戻る", action: () => this.openSystemMenu() }]);
    }
    this.render();
  }

  private saveAuto(): void {
    if (!this.gameStarted) return;
    const now = performance.now();
    if (now - this.lastAutoSaveAt < 750) return;
    this.lastAutoSaveAt = now;
    void this.saves.save("autosave", this.state).catch(() => undefined);
  }

  private openSystemMenu(): void {
    const inventoryLocked = !canReorganizeHomeInventory(this.state);
    this.openMenu("メニュー", [
      this.state.location === "dungeon" ? "探索中はメニューを開いてもターンは進まない。" : `自宅兼店舗 ${this.state.day}日目`,
      `所持金 ${this.state.gold}G　預金 ${this.state.vaultGold}G　鞄 ${currentItemCount(this.state)}/${bagCapacity(this.state)}枠`,
    ], [
      { label: inventoryLocked ? "在庫管理（営業中）" : this.state.location === "home" ? "在庫管理" : "持ち物", action: () => this.openInventory() },
      { label: "護衛募集", action: () => this.openEscortCommission() },
      { label: "商人の記録", action: () => this.openLedger() },
      { label: "操作", action: () => this.openHelp() },
      { label: "手動保存 1", action: () => { void this.saveManual("manual-1"); } },
      { label: "手動保存 2", action: () => { void this.saveManual("manual-2"); } },
      { label: "手動保存 3", action: () => { void this.saveManual("manual-3"); } },
      { label: "ゲームへ戻る", action: () => this.closeMenu() },
    ]);
  }

  private openHelp(): void {
    const controls = this.state.location === "home" ? HOME_CONTROL_LINES : DUNGEON_CONTROL_LINES;
    this.openMenu("操作", controls, [{ label: "閉じる", action: () => this.closeMenu() }]);
  }

  private openInventory(): void {
    if (!canReorganizeHomeInventory(this.state)) {
      this.modal = undefined;
      this.inventoryView = undefined;
      this.state.message = "営業中は在庫整理できない。閉店してから行おう。";
      this.render();
      return;
    }
    this.modal = undefined;
    this.inventoryView = {
      tab: this.inventoryView?.tab ?? "bag",
      selectedId: this.inventoryView?.selectedId ?? this.state.inventory[0]?.uuid,
      checkedIds: this.inventoryView?.checkedIds ?? new Set(),
      page: this.inventoryView?.page ?? 0,
    };
    this.windowRevision += 1;
    this.render();
  }

  private openShopForDay(): void {
    if (!startShopSession(this.state)) {
      const reason = this.state.message;
      this.openMenu("開店できません", [
        reason,
        "開店できる時間は朝または昼。保管庫の品を店頭商品に設定しておく必要がある。",
      ], [
        {
          label: "在庫・店頭商品を確認する",
          action: () => {
            this.modal = undefined;
            this.inventoryView = { tab: this.state.store.length ? "storage" : "bag", selectedId: this.state.store[0]?.uuid ?? this.state.inventory[0]?.uuid, checkedIds: new Set(), page: 0 };
            this.render();
          },
        },
        { label: "閉じる", action: () => this.closeMenu() },
      ]);
      this.render();
      return;
    }
    const counter = this.homeMap.markers.find((marker) => marker.kind === "shopkeeperCounter");
    this.render();
    const target = counter ? { x: counter.x * this.homeMap.tileSize + this.homeMap.tileSize / 2, y: counter.y * this.homeMap.tileSize + this.homeMap.tileSize / 2 } : { ...this.state.homePos };
    const ready = (): void => {
      this.state.homePos = target;
      this.state.shopSession.status = "waiting";
      this.render();
      this.time.delayedCall(900, () => this.callNextCustomer());
    };
    if (this.homePlayer) this.tweens.add({ targets: this.homePlayer, x: target.x, y: target.y + this.homeMap.tileSize / 2, duration: 550, ease: "Sine.InOut", onComplete: ready });
    else ready();
  }

  private callNextCustomer(): void {
    const npcId = summonNextCustomer(this.state);
    if (!npcId) this.state.message = "本日の来客はこれで終わりだ。閉店して在庫整理をしよう。";
    this.render();
    if (npcId) {
      const sprite = this.homeWorld?.getByName(`customer:${npcId}`) as Phaser.GameObjects.Sprite | undefined;
      const entry = this.homeMap.markers.find((marker) => marker.kind === "homeVisitors");
      const counter = this.homeMap.markers.find((marker) => marker.kind === "customerCounter");
      if (sprite && entry && counter) {
        const path = findHomeVisitorPath(this.homeMap, entry, counter);
        this.customerWalking = true;
        this.walkCustomerPath(sprite, npcId, path, () => {
          this.customerWalking = false;
          this.openNpcVisitor(npcId);
          this.render();
        });
      } else this.time.delayedCall(350, () => { this.openNpcVisitor(npcId); this.render(); });
    }
  }

  private finishCustomerAndContinue(): void {
    const npcId = this.state.shopSession.currentNpcId;
    this.modal = undefined;
    if (!npcId) return;
    this.render();
    const sprite = this.homeWorld?.getByName(`customer:${npcId}`) as Phaser.GameObjects.Sprite | undefined;
    const entry = this.homeMap.markers.find((marker) => marker.kind === "homeVisitors");
    const counter = this.homeMap.markers.find((marker) => marker.kind === "customerCounter");
    const complete = (): void => {
      finishCurrentCustomer(this.state);
      this.customerWalking = false;
      if (this.state.display.length === 0) { this.closeActiveShop(); return; }
      this.render();
      this.time.delayedCall(900, () => this.callNextCustomer());
    };
    if (!sprite || !entry || !counter) { complete(); return; }
    this.customerWalking = true;
    this.walkCustomerPath(sprite, npcId, findHomeVisitorPath(this.homeMap, counter, entry), complete);
  }

  private walkCustomerPath(sprite: Phaser.GameObjects.Sprite, npcId: string, path: Vec[], onComplete: () => void): void {
    if (!path.length) { onComplete(); return; }
    const tile = this.homeMap.tileSize;
    const pixel = (cell: Vec): Vec => ({ x: cell.x * tile + tile / 2, y: cell.y * tile + tile });
    sprite.setPosition(pixel(path[0]!).x, pixel(path[0]!).y);
    const walkNext = (index: number, facing: "up" | "down" | "left" | "right" = "down"): void => {
      const from = path[index - 1];
      const target = path[index];
      if (!from || !target) {
        this.playHomeCustomerMotion(sprite, npcId, facing, false);
        onComplete();
        return;
      }
      const direction = target.x < from.x ? "left" : target.x > from.x ? "right" : target.y < from.y ? "up" : "down";
      this.playHomeCustomerMotion(sprite, npcId, direction, true);
      const destination = pixel(target);
      this.tweens.add({ targets: sprite, x: destination.x, y: destination.y, duration: 135, ease: "Linear", onComplete: () => walkNext(index + 1, direction) });
    };
    walkNext(1);
  }

  private playHomeCustomerMotion(sprite: Phaser.GameObjects.Sprite, npcId: string, direction: "up" | "down" | "left" | "right", walking: boolean): void {
    const npc = this.state.npcs.find((entry) => entry.id === npcId);
    const visual = npcAppearanceSprite(npc?.appearanceId);
    const craftpix = visual ? actorDefinition(visual) : undefined;
    if (craftpix && this.playCraftpixActor(sprite, craftpix, walking ? "walk" : "idle", direction, true, this.homeScale())) return;
    const animation = `${sprite.texture.key}.${walking ? "walk" : "idle"}-${direction}`;
    if (this.anims.exists(animation)) sprite.play(animation, true);
  }

  private closeActiveShop(): void {
    this.customerWalking = false;
    closeShopSession(this.state);
    this.modal = undefined;
    this.render();
  }

  private openSupplyShop(): void {
    const food = SUPPLY_RULES.provisions;
    const smoke = SUPPLY_RULES.smokeBombs;
    this.openMenu("街の仕入先", [
      `携行食料は${PROVISIONS_PER_SLOT}個まで1枠。回復薬は1本で1枠。煙玉は枠を使わない。`,
      "帰還石は町では売られていない。地下13階以深の宝箱から、まれに見つかる。",
      `所持金 ${this.state.gold}G　鞄 ${currentItemCount(this.state)}/${bagCapacity(this.state)}枠`,
    ], [
      { label: "薬師ネヴァの薬屋", action: () => this.openApothecaryShop() },
      { label: `${food.supplier}: ${food.label} ${food.price}G（在庫制限なし）`, action: () => this.openProvisionPurchaseMenu() },
      {
        label: `${smoke.supplier}: ${smoke.label} ${smoke.price}G（残${this.state.dailySupplyStock.smokeBombs}）`,
        disabled: this.state.dailySupplyStock.smokeBombs <= 0,
        action: () => { buySupply(this.state, "smokeBombs", 1); this.openSupplyShop(); },
      },
      { label: "大口取引へ戻る", action: () => this.openBulkOrders() },
      { label: "閉じる", action: () => this.closeMenu() },
    ]);
  }

  private openApothecaryShop(): void {
    const hasRoom = currentItemCount(this.state) < bagCapacity(this.state);
    this.openMenu("薬師ネヴァの薬屋", [
      `所持金 ${this.state.gold}G　鞄 ${currentItemCount(this.state)}/${bagCapacity(this.state)}枠`,
      "冒険者は町ではこの薬屋を利用する。自宅の店頭では売れないが、迷宮では取引できる。",
      "自分や護衛の回復にも使用できる。",
    ], [
      ...APOTHECARY_MEDICINE_IDS.map((definitionId) => {
        const definition = MERCHANT_ITEM_DEFINITIONS[definitionId]!;
        return {
          label: `${definition.trueName}（HP ${definition.healing}回復） ${definition.baseValue}G`,
          disabled: !hasRoom || this.state.gold < definition.baseValue,
          action: () => { buyMedicineAtApothecary(this.state, definitionId); this.openApothecaryShop(); },
        };
      }),
      { label: "仕入先一覧へ戻る", action: () => this.openSupplyShop() },
    ]);
  }

  /** 在庫制限のない食料を、必要数だけ一度に仕入れる。 */
  private openProvisionPurchaseMenu(): void {
    const rule = SUPPLY_RULES.provisions;
    const affordable = Math.floor(this.state.gold / rule.price);
    const capacity = provisionCapacityRemaining(this.state);
    const maximum = Math.min(affordable, capacity);
    const quantities = [...new Set([1, 5, 10, maximum])].filter((amount) => amount > 0).sort((a, b) => a - b);
    this.openMenu("携行食料を仕入れる", [
      `1個 ${rule.price}G　所持 ${this.state.provisions}個（${provisionSlotCount(this.state.provisions)}枠）　所持金 ${this.state.gold}G`,
      `食品商の在庫に上限はない。食料は${PROVISIONS_PER_SLOT}個まで1枠で、現在あと${capacity}個積める。`,
    ], [
      ...quantities.map((amount) => ({
        label: amount === maximum ? `積めるだけ（${amount}個・${amount * rule.price}G）` : `${amount}個（${amount * rule.price}G）`,
        disabled: amount > maximum,
        action: () => { buySupply(this.state, "provisions", amount); this.openProvisionPurchaseMenu(); },
      })),
      { label: "仕入先一覧へ戻る", action: () => this.openSupplyShop() },
    ]);
  }

  /** 大口の話が来ているか、期日が近いかを、ボタンの名前で伝える。 */
  private bulkBadge(): string {
    const offer = refreshBulkOffer(this.state);
    const orders = bulkOrders(this.state);
    if (offer) return "大口取引（新しい話）";
    if (orders.length) {
      const nearest = Math.min(...orders.map((order) => order.dueDay - this.state.day));
      return `大口取引（あと${Math.max(0, nearest)}日）`;
    }
    return "大口取引";
  }

  private bulkOrderLine(order: BulkOrder): string {
    const name = MERCHANT_ITEM_DEFINITIONS[order.definitionId]?.trueName ?? order.definitionId;
    return `${name} ${stockedFor(this.state, order.definitionId)}/${order.quantity}　第${order.dueDay}日まで（あと${Math.max(0, order.dueDay - this.state.day)}日）`;
  }

  /**
   * 大口取引。
   *
   * 条件は書面として出す —— 数量・単価・納期・違約金・いま揃っている数。
   * 商人がそう言うのだから、こちらもそのとおり読めなければならない。
   */
  private openBulkOrders(): void {
    const offer = refreshBulkOffer(this.state);
    const orders = bulkOrders(this.state);
    const body: string[] = [`所持金 ${this.state.gold}G`];
    if (orders.length) {
      body.push("── 受けている約束 ──");
      for (const order of orders) body.push(this.bulkOrderLine(order));
    }
    if (offer) {
      const npc = this.state.npcs.find((entry) => entry.id === offer.npcId);
      const name = MERCHANT_ITEM_DEFINITIONS[offer.definitionId]?.trueName ?? offer.definitionId;
      body.push("── 今日の話 ──");
      body.push(`${npc?.name ?? "商人"}: ${name} ${offer.quantity}個 —— ${offer.unitPrice * offer.quantity}G（1個 ${offer.unitPrice}G）`);
      body.push(`納期 第${offer.dueDay}日まで　落とせば違約金 ${offer.penalty}G`);
      body.push(`いま揃っているのは ${stockedFor(this.state, offer.definitionId)}個（鞄と保管庫の合計）`);
    } else if (!orders.length) {
      body.push("今日は大口の話は来ていない。");
    }
    const choices: MenuChoice[] = [];
    for (const order of orders) {
      const ready = canDeliverBulkOrder(this.state, order.id);
      const name = MERCHANT_ITEM_DEFINITIONS[order.definitionId]?.trueName ?? order.definitionId;
      choices.push({
        label: ready ? `${name}を納める（${order.unitPrice * order.quantity}G）` : `${name}はまだ足りない`,
        disabled: !ready,
        action: () => { deliverBulkOrder(this.state, order.id); this.openBulkOrders(); },
      });
    }
    if (offer) {
      choices.push({ label: `受ける（落とせば違約金 ${offer.penalty}G）`, action: () => { acceptBulkOffer(this.state); this.openBulkOrders(); } });
      choices.push({ label: "断る", action: () => { declineBulkOffer(this.state); this.openBulkOrders(); } });
    }
    choices.push({ label: "街の仕入先へ", action: () => this.openSupplyShop() });
    choices.push({ label: "閉じる", action: () => this.closeMenu() });
    this.openMenu("大口取引", body, choices);
  }

  private openVault(): void {
    const locked = !canReorganizeHomeInventory(this.state);
    this.openMenu("自宅の金庫", [
      `所持金 ${this.state.gold}G　預金 ${this.state.vaultGold}G`,
      "預金と自宅の在庫は、探索中に倒れても失われない。",
      ...(locked ? ["営業中は入出金できない。"] : []),
    ], [
      { label: "50G預ける", disabled: locked || this.state.gold < 50, action: () => { depositGold(this.state, 50); this.openVault(); } },
      { label: "100G預ける", disabled: locked || this.state.gold < 100, action: () => { depositGold(this.state, 100); this.openVault(); } },
      { label: "所持金をすべて預ける", disabled: locked || this.state.gold <= 0, action: () => { depositGold(this.state); this.openVault(); } },
      { label: "50G引き出す", disabled: locked || this.state.vaultGold < 50, action: () => { withdrawGold(this.state, 50); this.openVault(); } },
      { label: "100G引き出す", disabled: locked || this.state.vaultGold < 100, action: () => { withdrawGold(this.state, 100); this.openVault(); } },
      { label: "預金をすべて引き出す", disabled: locked || this.state.vaultGold <= 0, action: () => { withdrawGold(this.state); this.openVault(); } },
      { label: "閉じる", action: () => this.closeMenu() },
    ]);
  }

  private openNpcVisitor(npcId: string): void {
    const npc = this.state.npcs.find((entry) => entry.id === npcId);
    if (!npc) return;
    if (this.state.escortCommission?.npcId === npcId && this.state.escortCommission.status === "accepted") {
      const expedition = canBeginExpedition(this.state);
      this.openMenu(`${npc.name} — ${this.professionLabel(npc)}`, [
        `護衛料 ${this.state.escortCommission.offeredFee}G 支払済み`,
        `危険時の後退基準: HP ${Math.round(guardRetreatRatio(this.state, npc.id) * 100)}%以下`,
        "出発すると契約の取消と返金はできない。",
      ], [
        { label: expedition.allowed ? "ダンジョンへ出発" : "次の遠征を待つ", disabled: !expedition.allowed, action: () => this.requestExpeditionStart() },
        { label: "護衛依頼を取り消す", action: () => { cancelEscortCommission(this.state); this.closeMenu(); } },
        { label: "閉じる", action: () => this.closeMenu() },
      ]);
      return;
    }
    const request = prepareCustomerPurchaseRequest(this.state, npc.id);
    const requestedItem = request ? this.state.itemsById[request.itemId] : undefined;
    const visitorBond = bondSummary(npc);
    this.openMenu(`${npc.rank ?? "E"}ランク ${npc.name} — ${this.professionLabel(npc)}`, [
      `${demandLabel(demandFor(npc))} —— ${npc.interests.map((interest) => this.categoryLabel(interest)).join(" / ")}`,
      ...(visitorBond ? [`縁: ${visitorBond}`] : []),
      requestedItem && request
        ? `${merchantItemName(requestedItem) ?? itemName(requestedItem)}を手に取っている。付け値 ${request.asking}G`
        : "欲しい商品が棚に見つからないようだ。",
      ...(request ? [request.line] : []),
    ], [
      ...(requestedItem && request && request.reaction !== "refuse" ? [
        { label: request.reaction === "haggle" ? `${request.price}Gで手を打つ` : `${request.price}Gで売る`, action: () => {
          const result = acceptCustomerPurchaseRequest(this.state);
          this.state.message = result.message;
          if (result.accepted) this.finishCustomerAndContinue();
          else this.openMenu("取引できない", [result.message], [{ label: "接客を終える", action: () => this.finishCustomerAndContinue() }]);
        } },
        { label: request.reaction === "haggle" ? "値を譲らない" : "今回は断る", action: () => {
          const message = request.reaction === "haggle"
            ? `${npc.name}は値を下げてもらえず、手ぶらで帰っていった。`
            : `${npc.name}への売却を断った。`;
          this.state.message = message;
          this.finishCustomerAndContinue();
        } },
      ] : []),
      { label: this.state.shopSession.currentNpcId === npc.id ? "接客を終える" : "閉じる", action: () => this.state.shopSession.currentNpcId === npc.id ? this.finishCustomerAndContinue() : this.closeMenu() },
    ]);
  }

  private openDungeonAdventurer(npcId: string): void {
    const adventurer = this.state.run?.adventurers.find((entry) => entry.npcId === npcId);
    const npc = this.state.npcs.find((entry) => entry.id === npcId);
    if (!adventurer || !npc) { this.closeMenu(); return; }
    const bond = bondSummary(npc);
    this.openMenu(`${npc.rank ?? "E"}ランク ${npc.name} — ${this.professionLabel(npc)}`, [
      `HP ${adventurer.hp}/${adventurer.maxHp}　攻撃 ${adventurer.damage}　所持金 ${adventurer.gold}G`,
      ...(bond ? [`縁: ${bond}`] : []),
      "この冒険者も独自に探索し、敵と戦う。取引は1ターン消費する。",
    ], [
      { label: "商品を買う", action: () => this.openDungeonAdventurerStock(npcId) },
      { label: "手持ちを売る", action: () => this.openDungeonAdventurerBuyback(npcId) },
      { label: "装備を預ける", action: () => this.openNpcGear(npcId) },
      { label: "取引しない", action: () => this.closeMenu() },
    ]);
  }

  private openDungeonAdventurerStock(npcId: string): void {
    const adventurer = this.state.run?.adventurers.find((entry) => entry.npcId === npcId);
    const npc = this.state.npcs.find((entry) => entry.id === npcId);
    if (!adventurer || !npc) { this.closeMenu(); return; }
    // 預けた装備は商品ではない。引き取るものであって、8割の値で買い戻すものではない。
    const entrustedIds = new Set(gearSlots(npc).map((slot) => slot.itemId));
    const stock = npc.inventoryIds
      .filter((id) => !entrustedIds.has(id))
      .map((id) => this.state.itemsById[id])
      .filter((item): item is ItemInstance => Boolean(item));
    this.openMenu(`${npc.name}の商品`, [stock.length ? `所持金 ${this.state.gold}G` : "売ってもらえる品は残っていない。"], [
      ...stock.map((item) => ({
        label: `買う: ${itemName(item)} ${dungeonAdventurerSellPrice(item)}G`,
        disabled: this.state.gold < dungeonAdventurerSellPrice(item),
        action: () => {
          if (currentItemCount(this.state) < bagCapacity(this.state)) {
            this.executeDungeonCommand({ type: "buyFromAdventurer", npcId, itemId: item.uuid });
          } else {
            this.openSwapMenu(item, (swapOutId) => this.executeDungeonCommand({ type: "buyFromAdventurer", npcId, itemId: item.uuid, swapOutId }), () => this.openDungeonAdventurerStock(npcId));
          }
        },
      })),
      { label: "戻る", action: () => this.openDungeonAdventurer(npcId) },
    ]);
  }

  private openDungeonAdventurerBuyback(npcId: string): void {
    const adventurer = this.state.run?.adventurers.find((entry) => entry.npcId === npcId);
    const npc = this.state.npcs.find((entry) => entry.id === npcId);
    if (!adventurer || !npc) { this.closeMenu(); return; }
    const floor = this.state.run?.floor ?? 1;
    const provisionDemand = dungeonProvisionDemandRemaining(adventurer, floor);
    const wanted = this.state.inventory.filter((item) => {
      const definition = itemDefinition(item);
      return npc.interests.includes(definition.category) || isDesperateFor(adventurer, item, floor);
    }).slice(0, 8);
    this.openMenu(`${npc.name}へ売る`, [
      `相手の所持金 ${adventurer.gold}G`,
      wanted.length || provisionDemand > 0
        ? `探している品: ${npc.interests.map((category) => this.categoryLabel(category)).join("・")}`
        : floor <= 3 ? "浅層なので食料や回復品には困っていない。" : "相手が欲しがる品を持っていない。",
    ], [
      ...(provisionDemand > 0 ? [{
        label: `携行食料をまとめて売る（相場${dungeonProvisionBuyPrice(floor)}G/個・需要${provisionDemand}個）`,
        disabled: this.state.provisions <= 0,
        action: () => this.openDungeonProvisionPriceMenu(npcId),
      }] : []),
      ...wanted.map((item) => ({
        label: `値を付ける: ${itemName(item)}（相場${dungeonAdventurerBuyPrice(item)}G）`,
        action: () => this.openDungeonPriceMenu(npcId, item),
      })),
      { label: "戻る", action: () => this.openDungeonAdventurer(npcId) },
    ]);
  }

  private openDungeonProvisionPriceMenu(npcId: string): void {
    const adventurer = this.state.run?.adventurers.find((entry) => entry.npcId === npcId);
    const npc = this.state.npcs.find((entry) => entry.id === npcId);
    const floor = this.state.run?.floor ?? 1;
    if (!adventurer || !npc) { this.closeMenu(); return; }
    const baseline = dungeonProvisionBuyPrice(floor);
    const demand = dungeonProvisionDemandRemaining(adventurer, floor);
    const desperate = dungeonProvisionDemand(floor) >= 3;
    this.openMenu("携行食料に値を付ける", [
      `${npc.name}の所持金 ${adventurer.gold}G　相場 ${baseline}G/個　需要 ${demand}個`,
      desperate ? `${npc.name}は深層で食料が尽きかけている。` : `${npc.name}にはまだ余裕があり、大幅な上乗せには応じにくい。`,
      `こちらの持ち込み ${this.state.provisions}個。成立価格で買える分をまとめて売る。`,
    ], [
      ...DUNGEON_PRICE_TIERS.map((tier) => {
        const unitPrice = Math.max(1, Math.round(baseline * tier.rate));
        const quantity = Math.min(this.state.provisions, demand, Math.floor(adventurer.gold / unitPrice));
        return {
          label: `${tier.label} ${unitPrice}G/個（最大${quantity}個）`,
          disabled: quantity <= 0,
          action: () => this.executeDungeonCommand({ type: "sellProvisionsToAdventurer", npcId, unitPrice }),
        };
      }),
      { label: "やめる", action: () => this.openDungeonAdventurerBuyback(npcId) },
    ]);
    this.render();
  }

  /**
   * 迷宮での言い値。
   *
   * ここには他に店がない。傷ついた相手の前で薬を握っているのは商人だけなので、
   * 定価の何倍でも提案が成り立つ —— ただし相手が本当に困っているときだけである。
   * 足元を見たことは、相手の性格しだいで恨みにも敬意にもなる。
   */
  private openDungeonPriceMenu(npcId: string, item: ItemInstance): void {
    const adventurer = this.state.run?.adventurers.find((entry) => entry.npcId === npcId);
    const npc = this.state.npcs.find((entry) => entry.id === npcId);
    if (!adventurer || !npc) { this.closeMenu(); return; }
    const baseline = dungeonAdventurerBuyPrice(item);
    const desperate = isDesperateFor(adventurer, item, this.state.run?.floor ?? 1);
    this.openMenu(`${itemName(item)}に値を付ける`, [
      `${npc.name}の所持金 ${adventurer.gold}G　相場 ${baseline}G`,
      desperate ? `${npc.name}は深く傷ついている。この薬を欲している。` : `${npc.name}は差し迫ってはいない。上乗せには応じないだろう。`,
    ], [
      ...DUNGEON_PRICE_TIERS.map((tier) => {
        const price = Math.max(1, Math.round(baseline * tier.rate));
        return {
          label: `${tier.label} ${price}G${tier.rate > 1 ? `（${tier.rate}倍）` : ""}`,
          disabled: adventurer.gold < price,
          action: () => this.executeDungeonCommand({ type: "sellToAdventurer", npcId, itemId: item.uuid, price }),
        };
      }),
      { label: "やめる", action: () => this.openDungeonAdventurerBuyback(npcId) },
    ]);
    this.render();
  }

  /**
   * 風呂敷を広げる前の下ごしらえ。
   *
   * 枠は道具袋の三分の一しかないので、**何を並べるかそのものが商いになる。**
   * 品を選ぶと値付けへ進み、選び直せば取り下げる。
   */
  private openStallSetup(): void {
    const readiness = stallReadiness(this.state);
    if (!readiness.allowed) {
      this.openMenu("風呂敷を広げられない", [readiness.message], [{ label: "閉じる", action: () => this.closeMenu() }]);
      this.render();
      return;
    }
    this.stallDraft ??= new Map();
    const draft = this.stallDraft;
    const slots = Math.min(stallCapacity(this.state), readiness.cells.length);
    const chosen = [...draft.keys()].filter((id) => this.state.inventory.some((item) => item.uuid === id));
    const total = chosen.reduce((sum, id) => sum + (draft.get(id) ?? 0), 0);

    this.openMenu("風呂敷を広げる", [
      `地下${this.state.run?.floor ?? 1}階。ここには他に店がない。`,
      `並べられるのは${slots}枠まで。選んだのは${chosen.length}点、締めて${total}G。`,
      "広げているあいだは動けない。敵は寄り、食料は減り、護衛は消耗する。",
    ], [
      ...this.state.inventory.map((item) => {
        const price = draft.get(item.uuid);
        const listed = price !== undefined;
        return {
          label: listed ? `✓ ${itemName(item)} — ${price}G` : `　 ${itemName(item)}`,
          disabled: !listed && chosen.length >= slots,
          action: () => {
            if (listed) { draft.delete(item.uuid); this.openStallSetup(); }
            else this.openStallPriceMenu(item);
          },
        };
      }),
      {
        label: `広げる（${chosen.length}点）`,
        disabled: chosen.length < 2,
        action: () => {
          const goods = chosen.map((itemId) => ({ itemId, price: draft.get(itemId)! }));
          this.stallDraft = undefined;
          this.executeDungeonCommand({ type: "openStall", goods });
        },
      },
      { label: "やめる", action: () => { this.stallDraft = undefined; this.closeMenu(); } },
    ]);
    this.render();
  }

  /**
   * 露店の値付け。
   *
   * 深い階には他に店がない。傷ついた相手の前で薬を握っているのが自分だけなら、
   * 定価の5倍でも10倍でも提案は成り立つ —— ただし相手が本当に困っているときだけである。
   */
  private openStallPriceMenu(item: ItemInstance): void {
    const baseline = dungeonAdventurerBuyPrice(item);
    const floor = this.state.run?.floor ?? 1;
    const wounded = this.state.run?.adventurers.filter((entry) => isDesperateFor(entry, item, floor)) ?? [];
    this.openMenu(`${itemName(item)}に値を付ける`, [
      `相場 ${baseline}G`,
      wounded.length > 0
        ? `この階に、この品を必要としている者が${wounded.length}人いる。`
        : "いま困っている者は見当たらない。上乗せには応じないだろう。",
    ], [
      ...DUNGEON_PRICE_TIERS.map((tier) => {
        const price = Math.max(1, Math.round(baseline * tier.rate));
        return {
          label: `${tier.label} ${price}G${tier.rate > 1 ? `（${tier.rate}倍）` : ""}`,
          action: () => { this.stallDraft?.set(item.uuid, price); this.openStallSetup(); },
        };
      }),
      { label: "戻る", action: () => this.openStallSetup() },
    ]);
    this.render();
  }

  private professionLabel(npc: NpcRecord): string {
    return ({ swordsman: "剣士", scout: "斥候", mercenary: "傭兵", merchant: "商人", blacksmith: "鍛冶師", apothecary: "薬師", alchemist: "錬金術師", mage: "魔法使い", noble: "貴族", collector: "蒐集家", townsperson: "街人" } as const)[npc.profession];
  }

  private categoryLabel(category: NpcRecord["interests"][number]): string {
    return ({ weapon: "武器", armor: "防具", bag: "道具袋", medicine: "薬品", material: "素材", curio: "珍品", arcane: "魔法品", relic: "遺物", gem: "宝石", book: "書物", art: "美術品" } as const)[category];
  }

  private beginExpeditionNow(): void {
    beginExpedition(this.state);
    this.closeMenu();
  }

  /** 雇用済みの護衛と装備を、出発操作の中で必ず確認できるようにする。 */
  private requestExpeditionStart(): void {
    const expedition = canBeginExpedition(this.state);
    if (!expedition.allowed) {
      this.state.message = expedition.message;
      this.closeMenu();
      return;
    }
    const commission = this.state.escortCommission;
    if (commission?.status !== "accepted" || !commission.npcId) {
      this.beginExpeditionNow();
      return;
    }
    const guard = this.state.npcs.find((npc) => npc.id === commission.npcId && npc.status === "contracted");
    if (!guard) {
      this.beginExpeditionNow();
      return;
    }
    const stats = npcCombatStats(this.state, guard);
    this.openMenu("護衛を連れていきますか？", [
      `${guard.rank ?? "E"}ランクの${guard.name}と護衛契約中。護衛料 ${commission.offeredFee}G 支払済み。`,
      `同行時 HP ${stats.maxHp}　攻撃 ${stats.damage}　防御 ${stats.defense}`,
      this.gearSummaryLine(guard) || "追加で預けた武器・防具はない。",
      "本人へ話しかけ直さなくても、このまま同行させられる。",
    ], [
      { label: `${guard.name}を連れていく`, action: () => this.beginExpeditionNow() },
      { label: "出発前に護衛装備を整える", action: () => this.openNpcGear(guard.id, () => this.requestExpeditionStart()) },
      { label: "護衛なしで入る", action: () => this.openSoloExpeditionNotice(guard) },
      { label: "出発しない", action: () => this.closeMenu() },
    ]);
  }

  private openSoloExpeditionNotice(guard: NpcRecord): void {
    const fee = this.state.escortCommission?.offeredFee ?? this.state.hiredGuardFee ?? 0;
    this.openMenu("護衛を連れずに入りますか？", [
      `${guard.name}との護衛契約を取り消し、支払い済みの${fee}Gは返金される。`,
      "この探索には護衛が同行しない。",
    ], [
      {
        label: "契約を取り消して単独で入る",
        action: () => { cancelEscortCommission(this.state); this.beginExpeditionNow(); },
      },
      { label: `${guard.name}を連れていく`, action: () => this.beginExpeditionNow() },
      { label: "戻る", action: () => this.requestExpeditionStart() },
    ]);
  }

  private openGuildMenu(): void {
    const contracted = this.state.escortCommission?.npcId ? this.state.npcs.find((npc) => npc.id === this.state.escortCommission?.npcId) : undefined;
    const expedition = canBeginExpedition(this.state);
    this.openMenu("探索準備", [
      contracted ? `${contracted.rank ?? "E"}ランクの${contracted.name}が店で出発を待っている。` : "ランクを選び、能力を見比べて護衛を指定する。",
      expedition.allowed
        ? contracted ? "出発時に、護衛の同行・装備準備・単独行を確認する。" : "護衛なしで出発することもできる。"
        : expedition.message,
    ], [
      { label: expedition.allowed ? "地下迷宮へ入る" : "本日の探索済み", disabled: !expedition.allowed, action: () => this.requestExpeditionStart() },
      { label: contracted ? "護衛依頼を確認" : "護衛を指定する", action: () => this.openEscortCommission() },
      { label: "冒険者の序列表を見る", action: () => this.openRankingBoard() },
      { label: "閉じる", action: () => this.closeMenu() },
    ]);
  }

  /**
   * ギルドの序列表。
   *
   * 町の上位を等級と実績で並べる。◆ は縁のある相手。死んだ者は遺体が
   * 迷宮に残っているあいだだけ「消息不明」として載る —— 掲示を見て
   * 取りに行ける相手だけが並ぶ、ということでもある。
   */
  private openRankingBoard(): void {
    const board = rankAdventurers(this.state);
    const missing = board.filter((entry) => entry.standing === "missing");
    const body = board.length
      ? board.map((entry, index) => rankingLine(entry, index + 1))
      : ["この町に名の通った冒険者はまだいない。"];
    const lost = recentLosses(this.state);
    this.openMenu("冒険者ギルド 序列表", body, [
      {
        label: missing.length || lost.length ? `消息不明 ${missing.length}名・喪われた者 ${lost.length}名` : "消息を絶った者はいない",
        disabled: missing.length === 0 && lost.length === 0,
        action: () => this.openMissingRoll(),
      },
      { label: "戻る", action: () => this.openGuildMenu() },
    ]);
    this.render();
  }

  /**
   * 消息を絶った者の欄。
   *
   * 遺体がまだ迷宮にある者は、どの階まで降りれば連れ戻せるかと、そこに何が残っているかが出る。
   * 迷宮に呑まれた者は名前だけが残り、しばらくすると掲示からも消える。
   */
  private openMissingRoll(): void {
    const missing = rankAdventurers(this.state, this.state.npcs.length).filter((entry) => entry.standing === "missing");
    const lost = recentLosses(this.state);
    const body = missing.map((entry) => {
      // 死んだ時点で装備は遺体へ移っているので、台帳の遺品から名を引く。
      const corpse = this.state.dungeonCorpses.find((record) => record.npcId === entry.npcId);
      const remains = (corpse?.lootIds ?? [])
        .map((id) => this.state.itemsById[id])
        .filter((item): item is NonNullable<typeof item> => item !== undefined)
        .map((item) => itemName(item));
      return `${entry.acquainted ? "◆" : "　"}${entry.name}（${entry.rank}）${entry.status}${remains.length ? ` ／ ${remains.join("　")}` : ""}`;
    });
    if (lost.length) {
      body.push("── 迷宮に呑まれた者 ──");
      for (const entry of lost.slice(0, Math.max(0, 9 - body.length))) {
        body.push(`${entry.acquainted ? "◆" : "　"}${entry.name}（${entry.rank}）${entry.status}`);
      }
    }
    this.openMenu("消息を絶った者", body.length ? body : ["消息を絶った者はいない。"], [
      { label: "戻る", action: () => this.openRankingBoard() },
    ]);
    this.render();
  }

  private openEscortCommission(): void {
    const current = this.state.escortCommission;
    if (current?.status === "accepted" && current.npcId) {
      const npc = this.state.npcs.find((entry) => entry.id === current.npcId)!;
      const rank = npc.rank ?? "E";
      this.openMenu("護衛依頼", [`${rank}ランクの${npc.name}が${current.offeredFee}Gで受注済み。`, `HP ${npc.maxHp ?? 0}　攻撃 ${npc.damage ?? 0}　推奨 地下${ADVENTURER_RANKS[rank].recommendedFloor}階まで`, `後退基準: HP ${Math.round(guardRetreatRatio(this.state, npc.id) * 100)}%以下`, "次にダンジョンへ入る際、会話し直さなくても同行する。"], [
        { label: "依頼を取り消して返金", action: () => { cancelEscortCommission(this.state); this.openGuildMenu(); } },
        { label: "戻る", action: () => this.openGuildMenu() },
      ]);
      return;
    }
    const delving = this.state.npcs.filter((npc) => npc.status === "delving").length;
    const recovering = this.state.npcs.filter((npc) => npc.status === "recovering").length;
    this.openMenu("護衛ランク", [
      `所持金: ${this.state.gold}G`,
      "高ランクほどHPと攻撃が高く、深い階層で生き残りやすい。",
      `本日は${delving}人が自分の探索で迷宮へ出ており、${recovering}人が傷を癒している。町にいる者だけを雇える。`,
    ], [
      ...ADVENTURER_RANK_ORDER.map((rank) => {
        const definition = ADVENTURER_RANKS[rank];
        const count = this.state.npcs.filter((npc) => isHireable(npc) && npc.rank === rank).length;
        return { label: `${rank}ランク — 基準${definition.escortFee}G／推奨 地下${definition.recommendedFloor}階（${count}人）`, disabled: count === 0, action: () => this.openEscortRank(rank) };
      }),
      { label: "戻る", action: () => this.openGuildMenu() },
    ]);
  }

  private openEscortRank(rank: AdventurerRank): void {
    const candidates = this.state.npcs.filter((npc) => isHireable(npc) && npc.rank === rank);
    const rankDefinition = ADVENTURER_RANKS[rank];
    this.openMenu(`${rank}ランク護衛`, [`推奨: 地下${rankDefinition.recommendedFloor}階まで`, "能力・後退判断・価格を比較して本人を指定する。"], [
      ...candidates.map((npc) => {
        const fee = escortFeeForNpc(this.state, npc);
        return {
          label: `${npc.name} HP${npc.maxHp ?? 0} 攻${npc.damage ?? 0} — ${fee}G`,
          disabled: false,
          action: () => this.openEscortProfile(npc.id),
        };
      }),
      { label: "ランク選択へ戻る", action: () => this.openEscortCommission() },
    ]);
  }

  /**
   * ギルドの掲示に出る不名誉。
   *
   * 置き去り・強請り・強奪・追いはぎは、雇う前に必ず読める。**ギルドはこれを隠さない** ——
   * 誰を連れて深く潜るかを決めるのは商人であり、決めるための材料は揃っている。
   */
  private guildRecordLine(career: GuardCareer): string {
    const marks = [
      career.betrayalCount > 0 ? `依頼主の荷を奪ったことが${career.betrayalCount}度` : "",
      career.holdupCount > 0 ? `迷宮で人を襲ったことが${career.holdupCount}度` : "",
      career.abandonCount > 0 ? `依頼主を迷宮に置いて逃げたことが${career.abandonCount}度` : "",
      career.extortionCount > 0 ? `深層で取り分を要求したことが${career.extortionCount}度` : "",
    ].filter(Boolean);
    return marks.length ? `ギルド記録: ${marks.join("、")}ある。` : "";
  }

  private openEscortProfile(npcId: string): void {
    const npc = this.state.npcs.find((entry) => entry.id === npcId && entry.adventurer);
    if (!npc) { this.openEscortCommission(); return; }
    const profile = ensureGuardProfile(this.state, npc);
    const career = profile.career;
    const fee = escortFeeForNpc(this.state, npc);
    const observations = guardObservationLines(npc);
    const recent = career.events.slice(-2);
    this.openMenu(`${npc.rank ?? "E"}ランク ${npc.name}`, [
      `HP ${npc.maxHp ?? 0}　攻撃 ${npc.damage ?? 0}　護衛料 ${fee}G`,
      `関係: ${guardTrustLabel(profile.trust)}　現在: ${guardConditionLabel(profile.stress)}`,
      ...(bondSummary(npc) ? [`縁: ${bondSummary(npc)}`] : []),
      `雇用 ${career.hireCount}回　生還 ${career.successfulReturns}回　最深 地下${career.deepestFloor || "―"}階`,
      `撃破 ${career.enemiesDefeated}体　肩代わり ${career.damageCovered}ダメージ　撤退 ${career.retreatCount}回`,
      // 置き去り・強請り・強奪は、雇う前に必ず読める。ギルドはこれを隠さない。
      this.guildRecordLine(career),
      career.rescueCount > 0 ? `評判: 迷宮で追いはぎから人をかばったことが${career.rescueCount}度ある。` : "",
      npc.famous ? `評判: 地下${career.deepestFloor}階からの生還が${career.successfulReturns}度、名の知れた冒険者だ。` : "",
      this.growthLine(npc),
      isRetained(npc) ? `第${npc.retainedSince}日から、あなたのお抱え。` : "",
      this.gearSummaryLine(npc),
      observations.length ? `観察記録: ${observations.length}件` : "まだ同行経験がなく、戦い方は分からない。",
      ...(recent.length
        ? ["直近の実績:", ...recent.reverse().map((event) => `第${event.day}日: ${event.detail}`)]
        : ["遠征実績はまだない。"]),
    ], [
      {
        label: `${fee}Gで護衛に指定する`,
        disabled: this.state.gold < fee || !isHireable(npc),
        action: () => { postEscortCommission(this.state, npc.id); this.openEscortCommission(); },
      },
      { label: "観察記録を読む", disabled: observations.length === 0, action: () => this.openEscortObservations(npc.id) },
      { label: "遠征履歴を見る", disabled: career.events.length === 0, action: () => this.openEscortHistory(npc.id) },
      { label: "護衛装備を整える", action: () => this.openNpcGear(npc.id) },
      { label: "この人との縁を読む", disabled: npcBonds(npc).length === 0, action: () => this.openNpcBonds(npc.id) },
      { label: "候補一覧へ戻る", action: () => this.openEscortRank(npc.rank ?? "E") },
    ]);
  }

  /** 育った相手にだけ出る一行。護衛料が上がっているのは、不具合ではなく誇りである。 */
  private growthLine(npc: NpcRecord): string {
    const seed = NPC_SEEDS.find((entry) => entry.id === npc.id);
    const born = seed?.rank ?? "E";
    if (!npc.rank || npc.rank === born) return "";
    return `${born}ランクから育った。いまは${npc.rank}ランク。`;
  }

  /** 預けている装備の一行。まだ何も預けていなければ空文字を返す（openMenu が落とす）。 */
  private gearSummaryLine(npc: NpcRecord): string {
    const carried = carriedGearItems(this.state, npc);
    if (!carried.length) return "";
    const terms = carried.map((item) => {
      const slot = gearSlotFor(item);
      const entry = slot ? npc.gear?.[slot] : undefined;
      return `${itemName(item)}（${entry?.withheld ? "未返却" : entry?.term === "given" ? "譲渡" : "貸与"}）`;
    });
    return `預けた装備: ${terms.join("　")}`;
  }

  /**
   * 装備の預け入れ画面。
   *
   * 貸与は次に町で会ったときに返ってくる。譲渡は返らないが、信頼が大きく動き、
   * その武器が持ち主の物語を背負っていく。
   */
  private openNpcGear(npcId: string, onBack: () => void = () => this.openEscortProfile(npcId)): void {
    const npc = this.state.npcs.find((entry) => entry.id === npcId);
    if (!npc) { this.closeMenu(); return; }
    const reorganizable = canReorganizeHomeInventory(this.state);
    const slotChoices = (["weapon", "armor"] as const).flatMap((slot) => {
      const entry = npc.gear?.[slot];
      const label = slot === "weapon" ? "武器" : "防具";
      if (!entry) {
        return [{
          label: `${label}を預ける`,
          disabled: !reorganizable,
          action: () => this.openEntrustGear(npc.id, slot, onBack),
        }];
      }
      const item = this.state.itemsById[entry.itemId];
      return [{
        label: entry.term === "given" ? `${label}: ${item ? itemName(item) : "?"}（譲渡済み）` : `${label}を引き取る: ${item ? itemName(item) : "?"}`,
        disabled: entry.term === "given" || !reorganizable,
        action: () => {
          this.state.message = reclaimGear(this.state, npc, slot).message;
          this.openNpcGear(npc.id, onBack);
        },
      }];
    });
    this.openMenu(`${npc.name}へ預ける`, [
      reorganizable ? "貸した品は次に町で会ったときに返してもらう。譲った品は返らない。" : "接客中は在庫を動かせない。",
      this.gearSummaryLine(npc) || "まだ何も預けていない。",
    ], [...slotChoices, { label: "戻る", action: onBack }]);
  }

  /** 預けられる品を鞄と保管庫から集める。 */
  private openEntrustGear(npcId: string, slot: GearSlotName, onBack: () => void): void {
    const npc = this.state.npcs.find((entry) => entry.id === npcId);
    if (!npc) { this.closeMenu(); return; }
    // 迷宮では鞄の中の物しか渡せない。保管庫は家にある。
    const source = this.state.location === "home" ? [...this.state.inventory, ...this.state.store] : this.state.inventory;
    const candidates = source.filter((item) => gearSlotFor(item) === slot).slice(0, 12);
    const hand = (itemId: string, term: "lent" | "given"): void => {
      this.state.message = entrustGear(this.state, npc, itemId, term).message;
      this.openNpcGear(npc.id, onBack);
    };
    this.openMenu(`${slot === "weapon" ? "武器" : "防具"}を選ぶ`, [
      candidates.length ? "貸すか譲るかを選ぶ。譲ると信頼が大きく上がる。" : "預けられる品を持っていない。",
    ], [
      ...candidates.flatMap((item) => {
        const definition = itemDefinition(item);
        const power = slot === "weapon" ? `攻+${definition.attack ?? 0}` : `防+${definition.defense ?? 0}`;
        return [
          { label: `貸す: ${itemName(item)}（${power}）`, action: () => hand(item.uuid, "lent") },
          { label: `譲る: ${itemName(item)}（${power}）`, action: () => hand(item.uuid, "given") },
        ];
      }),
      { label: "戻る", action: () => this.openNpcGear(npc.id, onBack) },
    ]);
  }

  /** 商人とその人物のあいだに起きたことを、新しい順に並べる。 */
  private openNpcBonds(npcId: string): void {
    const npc = this.state.npcs.find((entry) => entry.id === npcId);
    if (!npc) { this.closeMenu(); return; }
    const bonds = [...npcBonds(npc)].reverse();
    this.openMenu(`${npc.name}との縁`, bonds.length > 0
      ? bonds.map((bond) => `第${bond.day}日${bond.floor ? `・地下${bond.floor}階` : ""}: ${bond.detail}`)
      : ["この人物とのやり取りはまだない。"], [
      { label: "戻る", action: () => this.openEscortProfile(npc.id) },
    ]);
  }

  private openEscortObservations(npcId: string): void {
    const npc = this.state.npcs.find((entry) => entry.id === npcId && entry.adventurer);
    if (!npc) { this.openEscortCommission(); return; }
    const observations = guardObservationLines(npc);
    this.openMenu(`${npc.name}の観察記録`, observations.length > 0 ? observations : ["まだ同行経験がなく、戦い方は分からない。"], [
      { label: "護衛詳細へ戻る", action: () => this.openEscortProfile(npc.id) },
    ]);
  }

  private openEscortHistory(npcId: string): void {
    const npc = this.state.npcs.find((entry) => entry.id === npcId && entry.adventurer);
    if (!npc) { this.openEscortCommission(); return; }
    const events = ensureGuardProfile(this.state, npc).career.events.slice(-8).reverse();
    const lines = events.length > 0
      ? events.map((event) => `第${event.day}日・地下${event.floor || "―"}階: ${event.detail}`)
      : ["記録された遠征実績はない。"];
    this.openMenu(`${npc.name}の遠征履歴`, lines, [
      { label: "護衛詳細へ戻る", action: () => this.openEscortProfile(npc.id) },
    ]);
  }





  private openLedger(): void {
    const all = [...this.state.inventory, ...this.state.store, ...this.state.archive];
    const unique = Array.from(new Map(all.map((item) => [item.uuid, item])).values());
    const lines = unique.length === 0
      ? ["まだ記録すべき品を扱っていない。"]
      : unique.slice(-8).map((item) => {
        const latest = item.history.at(-1);
        return `${itemName(item)} — ${latest?.detail ?? "記録なし"}`;
      });
    this.openMenu("商人の記録", lines, [{ label: "閉じる", action: () => this.closeMenu() }]);
  }

  private render(): void {
    this.uiOpenTween?.remove();
    this.uiOpenTween = undefined;
    this.hungerTweens.forEach((tween) => tween.remove());
    this.hungerTweens = [];
    this.dungeonMaskShape?.destroy();
    this.dungeonMaskShape = undefined;
    this.releaseSceneObjects();
    // 破棄でハンドルが無効になるので、参照も一緒に落とす。
    this.homeBackdrop = undefined;
    this.homeWorld = undefined;
    this.homePlayer = undefined;
    if (!this.gameStarted) {
      this.renderSplashScreen();
      this.polishText();
      return;
    }
    if (this.state.location === "home") this.renderHome();
    else this.renderDungeon();
    this.pushMessage(this.state.message);
    this.renderHud();
    const overlayStart = this.children.list.length;
    if (this.inventoryView) this.renderInventoryView();
    else if (this.modal) this.renderModal();
    if (this.inventoryView || this.modal) this.fadeInWindow(overlayStart);
    this.polishText();
    this.saveAuto();
  }

  /** 同じ文面を連続で積まない。移動のたびに同じ行が並ぶのを避ける。 */
  private pushMessage(text: string): void {
    // hudTrace の更新は renderHud の中なので、この時点ではまだ前回の campaignId を持つ。
    if (this.hudTrace && this.hudTrace.campaignId !== this.state.campaignId) this.messageLog = [];
    if (!text || this.messageLog.at(-1)?.text === text) return;
    this.messageLog.push({ text, tone: messageTone(text) });
    if (this.messageLog.length > LOG_ROW_COUNT) this.messageLog.shift();
  }

  /**
   * 正面と足元から `E` で起きることを一つ選ぶ。
   * 画面上のプロンプトと右のボタン表記を同じ判断から作る。
   */
  private investigateContext(): string | undefined {
    const run = this.state.run;
    if (!run) return undefined;
    const facing = this.facingDirection();
    const facingPos = { x: run.player.x + facing.x, y: run.player.y + facing.y };
    const adventurer = run.adventurers.find((entry) => same(entry.pos, facingPos));
    if (adventurer) {
      const npc = this.state.npcs.find((entry) => entry.id === adventurer.npcId);
      return `${npc?.name ?? "冒険者"}と取引`;
    }
    const ground = run.items.find((entry) => same(entry.pos, run.player));
    if (ground) return `拾う: ${itemName(ground.item)}`;
    if (run.chests.some((entry) => same(entry.pos, run.player))) return "宝箱を開ける";
    const body = run.bodies.find((entry) => same(entry.pos, run.player));
    if (body) return body.inspected ? "遺品を漁る" : "遺体を調べる";
    if (run.map.stairsDown && same(run.player, run.map.stairsDown)) return "下りる";
    if (same(run.player, run.map.stairsUp)) return run.floor === 1 ? "地上へ戻る" : "上がる";
    return undefined;
  }

  /** 地図の上端に出す文脈プロンプト。危険が先、次に足元。 */
  private renderDungeonPrompt(): void {
    const investigate = this.investigateContext();
    const parts: string[] = [];
    if (this.facingEnemy()) {
      // 商人には殴る手がない。押して隙を作るか、護衛が退けるのを待つかである。
      if ((this.state.run?.shoveCooldown ?? 0) === 0) parts.push(`${SHORTCUTS.shove} 押し返す`);
      if (this.state.run?.guard?.mode !== "covering") parts.push("守る者がいない");
    }
    if (investigate) parts.push(`${SHORTCUTS.investigate} ${investigate}`);
    if (!parts.length) return;
    this.add.text(MAP_W / 2, 6, parts.join("　"), {
      fontSize: "10px",
      color: UI_INK.title,
      stroke: UI_INK.outline,
      strokeThickness: 3,
    }).setOrigin(0.5, 0);
  }

  /** 現在の階に貼り付いた地形の識別子。これが変われば敷き直す。 */
  private terrainKey(): string | undefined {
    const run = this.state.run;
    if (!run || this.state.location !== "dungeon") return undefined;
    return `${this.state.expeditionSerial}:${run.seed}:${run.floor}:${run.map.width}x${run.map.height}:${run.map.procedural?.themeId ?? "authored"}`;
  }

  /** 使い回せる地形を残し、それ以外の表示物だけ破棄する。 */
  private releaseSceneObjects(): void {
    const key = this.terrainKey();
    const keep = key !== undefined && this.dungeonTerrainKey === key ? this.dungeonTerrain : undefined;
    if (!keep) this.discardDungeonTerrain();
    for (const child of [...this.children.list]) {
      if (child !== keep) child.destroy();
    }
  }

  private discardDungeonTerrain(): void {
    this.dungeonTerrain?.destroy(true);
    this.dungeonTerrain = undefined;
    this.dungeonTerrainMask?.destroy();
    this.dungeonTerrainMask = undefined;
    this.dungeonTerrainKey = undefined;
  }

  /** 開いた直後のウインドウだけを淡く浮かび上がらせる。 */
  private fadeInWindow(from: number): void {
    if (this.windowRevision === this.animatedRevision) return;
    this.animatedRevision = this.windowRevision;
    const targets = this.children.list.slice(from).filter((child): child is Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Alpha => "setAlpha" in child);
    if (!targets.length) return;
    const bases = targets.map((target) => target.alpha);
    targets.forEach((target) => target.setAlpha(0));
    this.uiOpenTween = this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 140,
      ease: "Quad.easeOut",
      onUpdate: (tween) => {
        const ratio = tween.getValue() ?? 1;
        targets.forEach((target, index) => { if (target.scene) target.setAlpha(bases[index]! * ratio); });
      },
      onComplete: () => targets.forEach((target, index) => { if (target.scene) target.setAlpha(bases[index]!); }),
    });
  }

  private renderSplashScreen(): void {
    const modal = this.modal;
    this.add.rectangle(320, 180, 640, 360, 0x0d0b13);
    addWindow(this, 8, 8, 624, 344);
    addWindow(this, 24, 26, 250, 300, { variant: "inset", fill: 0x211927 });
    for (let index = 0; index < 7; index += 1) {
      this.add.rectangle(50 + index * 34, 292 - (index % 3) * 9, 24, 52 + (index % 3) * 18, index % 2 ? 0x372535 : 0x493027).setOrigin(0.5, 1);
    }
    this.add.circle(80, 73, 33, 0xd3a75b, 0.12);
    this.add.circle(80, 73, 22, 0xd3a75b, 0.16);
    const protagonist = playerActor();
    const playerTexture = (protagonist && this.craftpixActorTexture(protagonist)) ?? ASSET_MANIFEST.player.textureKey;
    const player = this.add.sprite(154, 244, playerTexture, 0);
    if (!protagonist || !this.playCraftpixActor(player, protagonist, "idle", "down", true, 2.05)) player.setOrigin(0.5, LEGACY_ACTOR_ORIGIN_Y).setScale(1.8).play("player.idle-down");
    this.add.text(296, 40, "DUNGEON", { fontSize: "14px", color: "#c8a76a", letterSpacing: 4 });
    this.add.text(296, 58, "CURIO MERCHANT", { fontSize: "24px", color: "#ffe7ad" });
    addDivider(this, 296, 94, 312);
    this.add.text(296, 102, "迷宮から珍品を持ち帰り、\n自宅兼店舗で価値をつけて売る。", { fontSize: "11px", color: "#cfc5bd", lineSpacing: 5 });
    addWindow(this, 290, 146, 322, 176, { variant: "inset" });
    if (modal) modal.choices.forEach((choice, index) => {
      const selected = index === modal.index;
      const y = 154 + index * 32;
      if (selected) addSelectionBar(this, 298, y, 306, 26);
      const hit = this.add.rectangle(298, y, 306, 26, 0xffffff, 0.001).setOrigin(0)
        .setInteractive({ useHandCursor: !choice.disabled });
      this.add.text(310, y + 7, `${selected ? "▶ " : "　"}${choice.label}`, { fontSize: "11px", color: choice.disabled ? UI_INK.disabled : selected ? UI_INK.onSelection : "#eee0ca" });
      hit.on("pointerover", () => { if (this.modal && !choice.disabled) { this.modal.index = index; this.render(); } });
      hit.on("pointerdown", () => { if (this.modal && !choice.disabled) choice.action(); });
    });
    this.add.text(296, 330, "↑↓ / マウスで選択　Enter / クリックで決定", { fontSize: "10px", color: "#918798" });
  }

  private polishText(): void {
    const visit = (child: Phaser.GameObjects.GameObject): void => {
      if (child === this.dungeonTerrain) return;
      if (child instanceof Phaser.GameObjects.Container) {
        child.list.forEach(visit);
        return;
      }
      if (!(child instanceof Phaser.GameObjects.Text)) return;
      child.setFontFamily('"Noto Sans JP Variable", "Yu Gothic UI", sans-serif');
      child.setResolution(2);
      const currentSize = Number.parseFloat(String(child.style.fontSize));
      if (Number.isFinite(currentSize) && currentSize < 10) child.setFontSize(10);
      child.setPadding(1, 1, 1, 1);
    };
    this.children.list.forEach(visit);
  }

  private renderHome(): void {
    this.drawHomeBackdrop();
    const world = this.add.container(0, 0);
    this.homeNpcs = [];
    const protagonist = playerActor();
    const playerTexture = (protagonist && this.craftpixActorTexture(protagonist)) ?? ASSET_MANIFEST.player.textureKey;
    const homeScale = this.homeScale();
    const player = this.add.sprite(this.state.homePos.x, this.state.homePos.y + this.homeMap.tileSize / 2, playerTexture, 0);
    if (!protagonist || !this.playCraftpixActor(player, protagonist, "idle", this.playerFacing, true, homeScale)) player.setOrigin(0.5, LEGACY_ACTOR_ORIGIN_Y).setScale(LEGACY_ACTOR_SCALE * homeScale).play(`player.idle-${this.playerFacing}`);
    world.add(player);
    this.homePlayer = player;
    this.drawHomeNpcs(world);
    for (const poi of this.homePoints()) {
      const position = this.poiPosition(poi);
      const label = this.add.text(position.x, position.y - 14 * homeScale, poi.name, { fontSize: "10px", color: UI_INK.title, stroke: UI_INK.outline, strokeThickness: 3 }).setOrigin(0.5);
      world.add(label);
    }
    this.homeWorld = world;
    this.dungeonMaskShape = this.make.graphics({ x: 0, y: 0 });
    this.dungeonMaskShape.fillStyle(0xffffff).fillRect(0, 0, MAP_W, MAP_H);
    const mask = this.dungeonMaskShape.createGeometryMask();
    world.setMask(mask);
    this.homeBackdrop?.setMask(mask);
    this.updateHomePresentation(true);
  }

  private renderDungeon(): void {
    const run = this.state.run;
    if (!run) return;
    const key = this.terrainKey();
    if (!this.dungeonTerrain || this.dungeonTerrainKey !== key) {
      this.discardDungeonTerrain();
      const terrain = this.add.container(0, 0);
      this.renderDungeonTerrain(terrain);
      this.dungeonTerrainMask = this.make.graphics({ x: 0, y: 0 });
      this.dungeonTerrainMask.fillStyle(0xffffff).fillRect(0, 0, MAP_W, MAP_H);
      terrain.setMask(this.dungeonTerrainMask.createGeometryMask());
      this.dungeonTerrain = terrain;
      this.dungeonTerrainKey = key;
    }
    // 地形は表示リストの先頭に残るので、以降に足す物がその上に重なる。
    const world = this.add.container(0, 0);
    this.dungeonWorld = world;
    this.renderDungeonAssets(world);
    this.updateDungeonPresentation();
    this.renderDungeonPrompt();
  }

  /**
   * 隊列は一つの升を共有する。見えているのは前に立っている者である。
   *
   * 護衛が前を務めているあいだ、商人は描かない —— 画面の上では、プレイヤーは
   * 剣を持った者を動かしている。護衛が下がるか、逃げるか、倒れるかした瞬間に
   * 商人の身体が現れて、自分がどれだけ小さいかが初めて見える。
   */
  private dungeonPartyOffsets(mode: "covering" | "retreated" | "fled" = "covering"): { player: Vec; guard: Vec } {
    const facing = DIRECTION[this.playerFacing];
    const front = { x: facing.x * 4, y: facing.y * 4 };
    const back = { x: -front.x, y: -front.y };
    // 護衛が前にいる間は商人を隠すので、護衛は升の中央に立つ。
    if (mode === "covering") return { player: back, guard: { x: 0, y: 0 } };
    return { player: front, guard: back };
  }

  /** 商人の姿が見えているか。護衛が前を務めているあいだは見えない。 */
  private merchantIsVisible(): boolean {
    return this.state.run?.guard?.mode !== "covering";
  }

  /** 階のあいだ動かない物だけを敷く。行動では作り直さない。 */
  private renderDungeonTerrain(terrain: Phaser.GameObjects.Container): void {
    const run = this.state.run;
    if (!run) return;
    const tile = run.map.tileSize ?? DUNGEON_LEGACY_TILE;
    // A sheet coarser than the map grid is one picture spanning several cells,
    // anchored at its top-left cell rather than squashed into one.
    const place = (x: number, y: number, texture: string, frame: number, assetId?: string): void => {
      const cells = assetId ? mapAssetFootprint(assetId, tile) : 1;
      const span = cells * tile;
      terrain.add(this.add.image(x * tile + span / 2, y * tile + span / 2, texture, frame).setDisplaySize(span, span));
    };
    const authored = run.map.authoredLayers;
    const hasAuthored = authored && Object.values(authored).some((values) => values?.some(Boolean));
    if (hasAuthored) {
      for (let y = 0; y < run.map.height; y += 1) for (let x = 0; x < run.map.width; x += 1) {
        const index = y * run.map.width + x;
        for (const name of ["ground", "structure", "decoration"] as const) {
          const cell = authored[name]?.[index];
          if (!cell) continue;
          const resolved = resolveMapAssetFrame(cell.assetId, cell.frame, (key) => this.textures.exists(key));
          place(x, y, resolved.textureKey, resolved.frame, cell.assetId);
        }
      }
    } else if (run.map.procedural) {
      const plan = createDungeonRenderPlan(run.map, run.seed, run.floor);
      for (let y = 0; y < run.map.height; y += 1) for (let x = 0; x < run.map.width; x += 1) {
        const index = y * run.map.width + x;
        for (const cell of [plan.ground[index], plan.structure[index], plan.decoration[index]]) {
          if (!cell) continue;
          const resolved = resolveMapAssetFrame(cell.assetId, cell.frame, (key) => this.textures.exists(key));
          place(x, y, resolved.textureKey, resolved.frame, cell.assetId);
        }
      }
    } else {
      for (let y = 0; y < run.map.height; y += 1) for (let x = 0; x < run.map.width; x += 1) {
        const wall = run.map.tiles[y]?.[x] === 1;
        place(x, y, wall ? ASSET_MANIFEST.mapTiles.dungeonWall.textureKey : ASSET_MANIFEST.mapTiles.dungeonFloor.textureKey, 0);
      }
    }
    const markerAt = (position: Vec, visual: { assetId: string; frame: number } | undefined, fallbackFrame: number): void => {
      if (!visual) {
        place(position.x, position.y, "object.dungeon", fallbackFrame);
        return;
      }
      const resolved = resolveMapAssetFrame(visual.assetId, visual.frame, (key) => this.textures.exists(key));
      place(position.x, position.y, resolved.textureKey, resolved.frame, visual.assetId);
    };
    if (!run.map.procedural) {
      if (run.map.stairsDown) markerAt(run.map.stairsDown, run.map.stairsDownVisual, DUNGEON_OBJECT_FRAMES.stairs);
      markerAt(run.map.stairsUp, run.map.stairsUpVisual, DUNGEON_OBJECT_FRAMES.returnStairs);
    }
  }

  private renderDungeonAssets(world: Phaser.GameObjects.Container): void {
    const run = this.state.run;
    if (!run) return;
    const add = <T extends Phaser.GameObjects.GameObject>(object: T): T => { world.add(object); return object; };
    const tile = run.map.tileSize ?? DUNGEON_LEGACY_TILE;
    const center = tile / 2;
    const partyOffsets = this.dungeonPartyOffsets(run.guard?.mode);
    // Everything that shares the floor is sorted by the bottom edge of its cell,
    // so what stands lower on the map draws in front.
    const depthAt = (y: number) => y * tile + tile;
    const place = (x: number, y: number, texture: string, frame: number, alpha = 1, assetId?: string): Phaser.GameObjects.Image => {
      const cells = assetId ? mapAssetFootprint(assetId, tile) : 1;
      const span = cells * tile;
      const image = this.add.image(x * tile + span / 2, y * tile + span / 2, texture, frame).setDisplaySize(span, span).setAlpha(alpha).setDepth(depthAt(y + cells - 1));
      return add(image);
    };
    // The upper half of a two-cell wall belongs to the cell below it, so it
    // sorts as that wall and can stand in front of an actor further back.
    if (run.map.procedural) {
      const plan = createDungeonRenderPlan(run.map, run.seed, run.floor);
      for (let y = 0; y < run.map.height; y += 1) for (let x = 0; x < run.map.width; x += 1) {
        const cell = plan.overhang[y * run.map.width + x];
        if (!cell || !isExplored(run.map, x, y)) continue;
        const resolved = resolveMapAssetFrame(cell.assetId, cell.frame, (key) => this.textures.exists(key));
        add(this.add.image(x * tile + tile / 2, (y - 1) * tile + tile / 2, resolved.textureKey, resolved.frame).setDisplaySize(tile, tile).setDepth(depthAt(y)));
      }
    }
    // 広げた風呂敷。床の色を変えるだけで、商人が座っている範囲が読める。
    if (run.stall) {
      for (const slot of run.stall.slots) {
        add(this.add.rectangle(slot.pos.x * tile + center, slot.pos.y * tile + center, tile - 2, tile - 2, 0x7a4a6a, 0.55)
          .setDepth(depthAt(slot.pos.y) - 1));
      }
      add(this.add.rectangle(run.player.x * tile + center, run.player.y * tile + center, tile - 2, tile - 2, 0x8d5878, 0.5)
        .setDepth(depthAt(run.player.y) - 1));
      for (const { slot, item } of stallGoods(this.state)) {
        const texture = item.visualId ? `merchant.${item.visualId}` : "";
        if (texture && this.textures.exists(texture)) place(slot.pos.x, slot.pos.y, texture, 0);
        else {
          const frame = Array.from(item.definitionId).reduce((total, character) => total + character.charCodeAt(0), 0) % 8;
          place(slot.pos.x, slot.pos.y, ASSET_MANIFEST.item.textureKey, frame);
        }
        add(this.add.text(slot.pos.x * tile + center, slot.pos.y * tile + tile, `${slot.price}`, {
          fontSize: `${Math.max(8, Math.round(tile * 0.42))}px`,
          color: "#ffe0a8",
          stroke: "#2b1420",
          strokeThickness: 3,
        }).setOrigin(0.5, 1).setDepth(depthAt(slot.pos.y) + 1));
      }
    }
    for (const entry of run.items) {
      if (!isExplored(run.map, entry.pos.x, entry.pos.y)) continue;
      const texture = entry.item.visualId ? `merchant.${entry.item.visualId}` : "";
      if (texture && this.textures.exists(texture)) place(entry.pos.x, entry.pos.y, texture, 0);
      else {
        const frame = Array.from(entry.item.definitionId).reduce((total, character) => total + character.charCodeAt(0), 0) % 8;
        place(entry.pos.x, entry.pos.y, ASSET_MANIFEST.item.textureKey, frame);
      }
    }
    // A chest and a body are placed because the run put something there, so they
    // read from the theme rather than from the decoration table. A theme that
    // names nothing keeps the shared placeholder sheet.
    const placeThemeObject = (pos: Vec, kind: DungeonThemeObjectKind, fallbackFrame: number): void => {
      const ref = run.map.procedural ? dungeonThemeObject(dungeonTheme(run.map.procedural.themeId), kind) : undefined;
      if (!ref) { place(pos.x, pos.y, "object.dungeon", fallbackFrame); return; }
      const halves = dungeonPieceHalves(ref);
      const lower = resolveMapAssetFrame(halves.lower.assetId, halves.lower.frame, (key) => this.textures.exists(key));
      place(pos.x, pos.y, lower.textureKey, lower.frame, 1, halves.lower.assetId);
      if (!halves.upper || pos.y <= 0) return;
      const upper = resolveMapAssetFrame(halves.upper.assetId, halves.upper.frame, (key) => this.textures.exists(key));
      add(this.add.image(pos.x * tile + tile / 2, (pos.y - 1) * tile + tile / 2, upper.textureKey, upper.frame).setDisplaySize(tile, tile).setDepth(depthAt(pos.y)));
    };
    for (const chest of run.chests) {
      if (!isExplored(run.map, chest.pos.x, chest.pos.y)) continue;
      placeThemeObject(chest.pos, "chest", DUNGEON_OBJECT_FRAMES.chest);
    }
    for (const body of run.bodies) {
      if (!isExplored(run.map, body.pos.x, body.pos.y)) continue;
      placeThemeObject(body.pos, "corpse", DUNGEON_OBJECT_FRAMES.bones);
    }
    for (const enemy of run.enemies) {
      if (!hasDungeonVision(run.map, run.player, enemy.pos)) continue;
      const actorDefinition = this.craftpixEnemyActor(enemy.id, enemy.actorId);
      const textureKey = actorDefinition ? (this.craftpixActorTexture(actorDefinition) ?? this.enemyTextureKey(enemy.id)) : this.enemyTextureKey(enemy.id);
      const sprite = this.add.sprite(enemy.pos.x * tile + center, enemy.pos.y * tile + tile, textureKey, 0).setName(`actor:${enemy.id}`);
      const direction = this.dungeonWalkAnimations.get(enemy.id) ?? "down";
      if (!actorDefinition || !this.playCraftpixActor(sprite, actorDefinition, "idle", direction)) sprite.setOrigin(0.5, LEGACY_ACTOR_ORIGIN_Y).setScale(LEGACY_ACTOR_SCALE).play(`${textureKey}.idle-${direction}`);
      add(sprite.setDepth(depthAt(enemy.pos.y)));
    }
    const robberId = run.holdup?.npcId;
    for (const adventurer of run.adventurers) {
      if (!hasDungeonVision(run.map, run.player, adventurer.pos)) continue;
      const npc = this.state.npcs.find((entry) => entry.id === adventurer.npcId);
      const appearance = npcAppearanceSprite(npc?.appearanceId);
      const craftpix = appearance ? actorDefinition(appearance) : undefined;
      const textureKey = craftpix ? (this.craftpixActorTexture(craftpix) ?? ASSET_MANIFEST.npc.textureKey) : ASSET_MANIFEST.npc.textureKey;
      const direction = this.dungeonWalkAnimations.get(adventurer.npcId) ?? "down";
      const sprite = this.add.sprite(adventurer.pos.x * tile + center, adventurer.pos.y * tile + tile, textureKey, 0).setName(`actor:${adventurer.npcId}`);
      if (!craftpix || !this.playCraftpixActor(sprite, craftpix, "idle", direction)) sprite.setOrigin(0.5, LEGACY_ACTOR_ORIGIN_Y).setScale(LEGACY_ACTOR_SCALE).play(`${textureKey}.idle-${direction}`);
      // 荷を狙って立っている相手は、ひと目でそうと分かる。
      if (adventurer.npcId === robberId) sprite.setTint(0xff8a7a);
      add(sprite.setDepth(depthAt(adventurer.pos.y)));
    }
    if (run.guard) {
      const npc = this.state.npcs.find((entry) => entry.id === run.guard?.guardId);
      const appearance = npcAppearanceSprite(npc?.appearanceId);
      const craftpix = appearance ? actorDefinition(appearance) : undefined;
      const textureKey = craftpix ? (this.craftpixActorTexture(craftpix) ?? ASSET_MANIFEST.npc.textureKey) : "actor.npc.scout";
      const direction = this.dungeonWalkAnimations.get(run.guard.guardId) ?? "down";
      const sprite = this.add.sprite(run.guard.pos.x * tile + center + partyOffsets.guard.x, run.guard.pos.y * tile + tile + partyOffsets.guard.y, textureKey, 0).setName(`actor:${run.guard.guardId}`);
      if (!craftpix || !this.playCraftpixActor(sprite, craftpix, "idle", direction)) sprite.setOrigin(0.5, LEGACY_ACTOR_ORIGIN_Y).setScale(LEGACY_ACTOR_SCALE).play(`${textureKey}.idle-${direction}`);
      if (run.guard.mode !== "covering") sprite.setTint(0x8b8791).setAlpha(0.72);
      add(sprite.setDepth(depthAt(run.guard.pos.y)));
    }
    const protagonist = playerActor();
    const playerTexture = (protagonist && this.craftpixActorTexture(protagonist)) ?? ASSET_MANIFEST.player.textureKey;
    const player = this.add.sprite(run.player.x * tile + center + (run.guard ? partyOffsets.player.x : 0), run.player.y * tile + tile + (run.guard ? partyOffsets.player.y : 0), playerTexture, 0).setName("actor:player");
    if (!protagonist || !this.playCraftpixActor(player, protagonist, "idle", this.playerFacing)) player.setOrigin(0.5, LEGACY_ACTOR_ORIGIN_Y).setScale(LEGACY_ACTOR_SCALE).play(`player.idle-${this.playerFacing}`);
    // 護衛の背中に隠れている商人。空腹表示や歩行アニメはこの実体を参照し続けるので、
    // 作るのをやめるのではなく、見えなくする。
    player.setVisible(this.merchantIsVisible());
    add(player.setDepth(depthAt(run.player.y)));
    // Sorting happens before the overlays so fog and the hunger aura stay on top.
    world.sort("depth");
    if (this.state.provisions === 0) this.renderHungerEffect(world, player, tile);
    if (run.guard?.mode === "covering") {
      const guardSprite = world.getByName(`actor:${run.guard.guardId}`);
      if (guardSprite) world.bringToTop(guardSprite);
    }
    this.renderDungeonFog(world);
    this.dungeonMaskShape = this.make.graphics({ x: 0, y: 0 });
    this.dungeonMaskShape.fillStyle(0xffffff).fillRect(0, 0, MAP_W, MAP_H);
    world.setMask(this.dungeonMaskShape.createGeometryMask());
  }

  /**
   * 灯りの外を闇で覆う。地形と物の上に敷くので、一度通った床は薄明かりで残り、
   * まだ知らない場所は塗り潰される。横に続く同じ濃さはひとつの矩形にまとめる。
   */
  private renderDungeonFog(world: Phaser.GameObjects.Container): void {
    const run = this.state.run;
    if (!run) return;
    const tile = run.map.tileSize ?? DUNGEON_LEGACY_TILE;
    const fog = this.add.graphics().setName("dungeon:fog");
    for (let y = 0; y < run.map.height; y += 1) {
      let start = 0;
      let shade = -1;
      const flush = (end: number): void => {
        if (shade > 0) fog.fillStyle(FOG_INK, shade).fillRect(start * tile, y * tile, (end - start) * tile, tile);
      };
      for (let x = 0; x < run.map.width; x += 1) {
        const value = dungeonFogOpacity(run.map, run.player, { x, y }, isExplored(run.map, x, y));
        if (value !== shade) {
          flush(x);
          start = x;
          shade = value;
        }
      }
      flush(run.map.width);
    }
    world.add(fog);
  }

  private renderHungerEffect(world: Phaser.GameObjects.Container, player: Phaser.GameObjects.Sprite, tile: number): void {
    player.setTint(0xffb36b);
    const aura = this.add.graphics().setPosition(player.x, player.y - tile * 0.55).setName("effect:hunger");
    aura.lineStyle(Math.max(1, tile / 16), 0xff8c42, 0.9).strokeCircle(0, 0, tile * 0.52);
    aura.fillStyle(0xffc078, 0.9).fillCircle(-tile * 0.35, -tile * 0.2, Math.max(1.5, tile * 0.09)).fillCircle(tile * 0.38, tile * 0.12, Math.max(1.2, tile * 0.07));
    const label = this.add.text(player.x, player.y - tile * 1.8, "空腹", { fontSize: `${Math.max(10, tile * 0.55)}px`, color: "#ffd29a", stroke: "#4d170d", strokeThickness: 3 }).setOrigin(0.5, 1).setName("effect:hunger-label");
    world.add([aura, label]);
    this.hungerTweens.push(
      this.tweens.add({ targets: player, alpha: 0.68, duration: 460, ease: "Sine.InOut", yoyo: true, repeat: -1 }),
      this.tweens.add({ targets: [aura, label], alpha: 0.42, scaleX: 1.12, scaleY: 1.12, duration: 620, ease: "Sine.InOut", yoyo: true, repeat: -1 }),
    );
  }

  private animateDungeonEvents(events: DungeonEvent[]): void {
    const world = this.dungeonWorld;
    if (!world || this.state.location !== "dungeon") return;
    const actor = (id: string): Phaser.GameObjects.Sprite | undefined => world.getByName(`actor:${id}`) as Phaser.GameObjects.Sprite | undefined;
    const actorDefinitionFor = (id: string): CraftpixActorDefinition | undefined => {
      // 名簿の人物を敵の表から引かないこと。詳細は dungeonActorAppearance を参照。
      const appearance = dungeonActorAppearance(this.state, id);
      if (!appearance) return undefined;
      return actorDefinition(appearance);
    };
    const actorOffset = (id: string): Vec => {
      const guard = this.state.run?.guard;
      if (!guard) return { x: 0, y: 0 };
      const offsets = this.dungeonPartyOffsets(guard.mode);
      if (id === "player") return offsets.player;
      if (id === guard.guardId) return offsets.guard;
      return { x: 0, y: 0 };
    };
    const tile = this.state.run?.map.tileSize ?? DUNGEON_LEGACY_TILE;
    // 倒された相手のスプライトは描画時点で既に無い。撃破地点を引き当てて数値を出す。
    const defeatedAt = new Map<string, Vec>();
    for (const event of events) {
      if (event.type === "defeated" && event.pos) defeatedAt.set(event.actorId, event.pos);
    }
    /** 主人公・護衛・冒険者は味方。敵のIDはアクター名から作られるので一覧に載らない。 */
    const isAlly = (id: string): boolean => id === "player" || this.state.npcs.some((npc) => npc.id === id);
    const worldPoint = (id: string): Vec | undefined => {
      const sprite = actor(id);
      if (sprite) return { x: sprite.x, y: sprite.y - tile * 0.9 };
      const pos = defeatedAt.get(id);
      if (!pos) return undefined;
      return { x: pos.x * tile + tile / 2, y: pos.y * tile + tile * 0.1 };
    };
    for (const event of events) {
      if (event.type === "move" || (event.type === "shove" && event.success)) {
        const sprite = actor(event.type === "move" ? event.actorId : event.enemyId);
        if (!sprite) continue;
        const from = event.from;
        const to = event.to;
        const center = tile / 2;
        const offset = actorOffset(event.type === "move" ? event.actorId : event.enemyId);
        sprite.setPosition(from.x * tile + center + offset.x, from.y * tile + tile + offset.y);
        this.tweens.add({ targets: sprite, x: to.x * tile + center + offset.x, y: to.y * tile + tile + offset.y, duration: event.type === "shove" ? 130 : 90, ease: "Quad.Out" });
      } else if (event.type === "shove" && !event.success) {
        const sprite = actor(event.enemyId);
        if (sprite) this.tweens.add({ targets: sprite, x: sprite.x + 2, duration: 45, yoyo: true, repeat: 1 });
      } else if (event.type === "defeated") {
        if (event.pos) {
          world.add(addDefeatBurst(this, event.pos.x * tile + tile / 2, event.pos.y * tile + tile / 2, tile));
        }
      } else if (event.type === "guardMode") {
        const sprite = actor(event.guardId);
        if (sprite) this.tweens.add({ targets: sprite, alpha: event.mode === "retreated" ? 0.72 : 1, duration: 160, yoyo: true, repeat: 1 });
      } else if (event.type === "attack") {
        const point = worldPoint(event.targetId);
        if (point) {
          const ally = isAlly(event.targetId);
          world.add(addFloatingValue(this, point.x, point.y, `${event.damage}`, ally ? FLOATING_INK.ally : FLOATING_INK.enemy));
        }
        if (event.targetId === "player") addEdgeFlash(this, 0, 0, MAP_W, MAP_H, 0xd83b32);
        const attacker = actor(event.attackerId);
        const target = actor(event.targetId);
        if (!attacker || !target) continue;
        const attackerDefinition = actorDefinitionFor(event.attackerId);
        const targetDefinition = actorDefinitionFor(event.targetId);
        const attackerDirection = this.dungeonWalkAnimations.get(event.attackerId) ?? this.playerFacing;
        const targetDirection = this.dungeonWalkAnimations.get(event.targetId) ?? "down";
        if (attackerDefinition) this.playCraftpixActor(attacker, attackerDefinition, "attack", attackerDirection, false);
        if (targetDefinition) this.playCraftpixActor(target, targetDefinition, "hurt", targetDirection, false);
        const dx = Math.sign(target.x - attacker.x) * 5;
        const dy = Math.sign(target.y - attacker.y) * 5;
        this.tweens.add({ targets: attacker, x: attacker.x + dx, y: attacker.y + dy, duration: 55, yoyo: true, ease: "Quad.Out" });
        target.setTintFill(0xffc2c2);
        this.time.delayedCall(220, () => {
          if (!target.scene) return;
          target.clearTint();
          if (targetDefinition) this.playCraftpixActor(target, targetDefinition, "idle", targetDirection, false);
        });
      }
    }
  }

  private updateDungeonPresentation(): void {
    const run = this.state.run;
    if (!run || !this.dungeonWorld) return;
    const tile = run.map.tileSize ?? DUNGEON_LEGACY_TILE;
    const worldWidth = run.map.width * tile;
    const worldHeight = run.map.height * tile;
    const playerX = run.player.x * tile + tile / 2;
    const playerY = run.player.y * tile + tile / 2;
    const targetX = Phaser.Math.Clamp(playerX - MAP_W / 2, 0, Math.max(0, worldWidth - MAP_W));
    const targetY = Phaser.Math.Clamp(playerY - MAP_H / 2, 0, Math.max(0, worldHeight - MAP_H));
    this.dungeonWorld.setPosition(-Math.round(targetX), -Math.round(targetY));
    this.dungeonTerrain?.setPosition(-Math.round(targetX), -Math.round(targetY));
  }

  private homePoints(): HomePoint[] {
    const markerPosition = (kind: "homeSpawn" | "dungeonEntrance" | "homePreparation" | "homeVisitors" | "customerCounter", fallback: { x: number; y: number }) => {
      const marker = this.homeMap.markers.find((candidate) => candidate.kind === kind);
      return marker ? { x: marker.x, y: marker.y } : fallback;
    };
    const entrance = markerPosition("dungeonEntrance", { x: 16, y: 2 });
    const homeSpawn = markerPosition("homeSpawn", HOME_SPAWN);
    const preparation = markerPosition("homePreparation", HOME_POI.preparation);
    const visitors = markerPosition("homeVisitors", HOME_POI.visitors);
    const occupied = [
      homeSpawn,
      preparation,
      visitors,
      entrance,
    ];
    const visibleNpcIds = [...new Set([
      ...this.state.visitorNpcIds,
      ...(this.state.escortCommission?.status === "accepted" && this.state.escortCommission.npcId ? [this.state.escortCommission.npcId] : []),
    ])];
    const npcById = new Map(this.state.npcs.map((npc) => [npc.id, npc]));
    const customerCounter = markerPosition("customerCounter", visitors);
    const customers = assignHomeVisitorCells(this.homeMap, visibleNpcIds, occupied).map(({ visitorId, pos }) => {
      const customer = npcById.get(visitorId)!;
      return {
        id: `customer-${customer.id}`,
        name: customer.name,
        kind: "customer" as const,
        customerId: customer.id,
        pos: this.state.shopSession.currentNpcId === visitorId ? customerCounter : pos,
      };
    });
    const expedition = canBeginExpedition(this.state);
    const points = HOME_POINTS.map((point) => point.id === "entrance"
      ? { ...point, name: expedition.reason === "alreadyExplored" ? "ダンジョン入口（本日の探索済み）" : point.name, pos: entrance }
      : point.id === "guild" ? { ...point, pos: preparation }
        : point.id === "visitors" ? { ...point, pos: visitors }
          : point);
    return [...points, ...customers];
  }

  private enemyTextureKey(enemyId: string): string {
    if (enemyId.startsWith("bat")) return "actor.enemy.bat";
    if (enemyId.startsWith("crawler")) return "actor.enemy.lizard";
    return "actor.enemy.goblin";
  }

  private craftpixEnemyActor(enemyId: string, actorId?: string): CraftpixActorDefinition | undefined {
    if (actorId) {
      const actor = actorDefinition(actorId);
      return actorSupportsDirectionalMovement(actor) ? actor : undefined;
    }
    const ids = Object.keys(CRAFTPIX_ENEMY_ACTORS) as (keyof typeof CRAFTPIX_ENEMY_ACTORS)[];
    const hash = Array.from(enemyId).reduce((total, character) => total + character.charCodeAt(0), 0);
    const actor = CRAFTPIX_ENEMY_ACTORS[ids[hash % ids.length]!];
    return actor;
  }

  private updateHomePresentation(immediate = false): void {
    if (!this.homeWorld || !this.homePlayer) return;
    this.homePlayer.setPosition(this.state.homePos.x, this.state.homePos.y + this.homeMap.tileSize / 2);
    // Small interiors use integer pixel enlargement without changing save coordinates.
    const zoom = this.homeMap.width * this.homeMap.tileSize <= MAP_W / 2 ? 2 : 1;
    this.homeWorld.setScale(zoom);
    this.homeBackdrop?.setScale(zoom);
    const width = this.homeMap.width * this.homeMap.tileSize * zoom;
    const height = this.homeMap.height * this.homeMap.tileSize * zoom;
    const targetX = width < MAP_W ? -(MAP_W - width) / 2 : Phaser.Math.Clamp(this.state.homePos.x * zoom - MAP_W / 2, 0, width - MAP_W);
    const targetY = height < MAP_H ? -(MAP_H - height) / 2 : Phaser.Math.Clamp(this.state.homePos.y * zoom - MAP_H / 2, 0, height - MAP_H);
    const currentX = -this.homeWorld.x;
    const currentY = -this.homeWorld.y;
    const nextX = -Math.round(immediate ? targetX : Phaser.Math.Linear(currentX, targetX, 0.18));
    const nextY = -Math.round(immediate ? targetY : Phaser.Math.Linear(currentY, targetY, 0.18));
    this.homeWorld.setPosition(nextX, nextY);
    this.homeBackdrop?.setPosition(nextX, nextY);
  }

  /** 家の手動レイヤーを、保存されたフレーム番号のまま描画する。 */
  private drawHomeBackdrop(): void {
    const map = this.homeMap;
    const world = this.add.container(0, 0);
    const authored = map.layers;
    const hasAuthored = authored && Object.values(authored).some((values) => values?.some(Boolean));
    for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) {
      const index = y * map.width + x;
      if (hasAuthored) for (const name of ["ground", "structure", "decoration"] as const) {
        const cell = authored[name]?.[index];
        if (cell) {
          const resolved = resolveMapAssetFrame(cell.assetId, cell.frame, (key) => this.textures.exists(key));
          world.add(this.add.image(x * map.tileSize + map.tileSize / 2, y * map.tileSize + map.tileSize / 2, resolved.textureKey, resolved.frame).setDisplaySize(map.tileSize, map.tileSize));
        }
      }
      else {
        const id = map.terrain[index];
        if (id) {
          const legacyTexture = id === "home.wall" ? ASSET_MANIFEST.mapTiles.homeWall.textureKey : ASSET_MANIFEST.mapTiles.homeFloor.textureKey;
          world.add(this.add.image(x * map.tileSize + map.tileSize / 2, y * map.tileSize + map.tileSize / 2, legacyTexture, 0).setDisplaySize(map.tileSize, map.tileSize));
        }
      }
    }
    this.homeBackdrop = world as unknown as Phaser.Tilemaps.TilemapLayer;
  }

  private playHomePlayerMotion(horizontal: number, vertical: number): void {
    if (!this.homePlayer) return;
    const direction = (Math.abs(horizontal) > Math.abs(vertical)
      ? horizontal < 0 ? "player.walk-left" : "player.walk-right"
      : vertical < 0 ? "player.walk-up" : "player.walk-down");
    const facing = direction.endsWith("left") ? "left" : direction.endsWith("right") ? "right" : direction.endsWith("up") ? "up" : "down";
    const protagonist = playerActor();
    if (!protagonist || !this.playCraftpixActor(this.homePlayer, protagonist, "walk", facing, true, this.homeScale())) {
      if (this.homePlayer.anims.currentAnim?.key !== direction) this.homePlayer.play(direction, true);
    }
  }

  private drawHomeNpcs(world: Phaser.GameObjects.Container): void {
    this.homePoints().forEach((poi, index) => {
      if (poi.kind === "entrance" || poi.kind === "guild" || poi.kind === "visitors") return;
      const center = this.poiPosition(poi);
      const homeScale = this.homeScale();
      const npc = poi.customerId ? this.state.npcs.find((entry) => entry.id === poi.customerId) : undefined;
      const visual = npcAppearanceSprite(npc?.appearanceId);
      const craftpix = visual ? actorDefinition(visual) : undefined;
      if (craftpix) {
        const texture = this.craftpixActorTexture(craftpix) ?? ASSET_MANIFEST.npc.textureKey;
        const sprite = this.add.sprite(center.x, center.y + this.homeMap.tileSize / 2, texture, 0).setName(poi.customerId ? `customer:${poi.customerId}` : "");
        if (!this.playCraftpixActor(sprite, craftpix, "idle", "down", true, homeScale)) sprite.setOrigin(0.5, LEGACY_ACTOR_ORIGIN_Y).setScale(LEGACY_ACTOR_SCALE * homeScale);
        world.add(sprite);
        return;
      }
      const legacyTexture: Record<string, string> = {
        "legacy.guard.mina": "actor.guard.mina",
        "legacy.guard.rolf": "actor.guard.rolf",
        "legacy.npc.trader": "actor.npc.trader",
        "legacy.npc.mage": "actor.npc.mage",
        "legacy.npc.innkeeper": "actor.npc.innkeeper",
        "legacy.npc.scout": "actor.npc.scout",
      };
      const textureKey = legacyTexture[visual ?? ""] ?? NPC_ASSET_VARIANTS[index % NPC_ASSET_VARIANTS.length]!.textureKey;
      const sprite = this.add.sprite(center.x, center.y + this.homeMap.tileSize / 2, textureKey, 0).setName(poi.customerId ? `customer:${poi.customerId}` : "").setOrigin(0.5, LEGACY_ACTOR_ORIGIN_Y).setScale(LEGACY_ACTOR_SCALE * homeScale);
      sprite.play(`${textureKey}.idle-down`);
      world.add(sprite);
      if (poi.kind === "customer") return;
      const staticResident = poi.kind === "customer" || poi.kind === "entrance";
      this.homeNpcs.push({
        sprite,
        textureKey,
        center: { x: center.x, y: center.y + this.homeMap.tileSize / 2 },
        radius: staticResident ? { x: 6 * homeScale, y: 4 * homeScale } : { x: 18 * homeScale, y: 11 * homeScale },
        phase: index * 1.71,
        facing: "down",
      });
    });
  }

  private updateHomeNpcs(delta: number): void {
    const seconds = this.time.now / 1000;
    for (const npc of this.homeNpcs) {
      const targetX = npc.center.x + Math.sin(seconds * 0.7 + npc.phase) * npc.radius.x;
      const targetY = npc.center.y + Math.cos(seconds * 0.53 + npc.phase) * npc.radius.y;
      const previousX = npc.sprite.x;
      const previousY = npc.sprite.y;
      npc.sprite.x = Phaser.Math.Linear(previousX, targetX, Math.min(1, delta / 850));
      npc.sprite.y = Phaser.Math.Linear(previousY, targetY, Math.min(1, delta / 850));
      const horizontal = npc.sprite.x - previousX;
      const vertical = npc.sprite.y - previousY;
      const animation = Math.abs(horizontal) > Math.abs(vertical)
        ? horizontal < 0 ? "walk-left" : "walk-right"
        : vertical < 0 ? "walk-up" : "walk-down";
      if (Math.abs(horizontal) + Math.abs(vertical) < 0.03) npc.sprite.play(`${npc.textureKey}.idle-${npc.facing}`, true);
      else {
        npc.facing = animation.replace("walk-", "") as RoamingNpc["facing"];
        if (npc.sprite.anims.currentAnim?.key !== `${npc.textureKey}.${animation}`) npc.sprite.play(`${npc.textureKey}.${animation}`, true);
      }
    }
  }

  private renderHud(): void {
    this.renderStatusPanel();
    this.renderMessageWindow();
  }

  /** 右のステータス窓。数値はアイコンとゲージで一目で読めるように並べる。 */
  private renderStatusPanel(): void {
    addWindow(this, PANEL_X, 0, PANEL_W, 360);
    const x = PANEL_CONTENT_X;
    const width = PANEL_CONTENT_W;
    const time = ({ morning: "朝", afternoon: "昼", evening: "夕", night: "夜" } as const)[this.state.timeSlot];
    addWindow(this, x, 9, width, 21, { variant: "inset" });
    this.add.text(x + width / 2, 13, `第${this.state.day}日・${time}`, { fontSize: "12px", color: UI_INK.title }).setOrigin(0.5, 0);
    addDivider(this, x, 36, width);

    const hp = hpGaugeColors(this.state.hp, this.state.maxHp);
    addUiIcon(this, x, 49, UI_ICON.heart, 0xe4574c);
    addGauge(this, x + 20, 43, width - 20 - GAUGE_VALUE_W, 12, { value: this.state.hp, max: this.state.maxHp, ...hp });
    this.add.text(x + width, 44, `${this.state.hp}/${this.state.maxHp}`, { fontSize: "10px", color: UI_INK.value }).setOrigin(1, 0);

    addUiIcon(this, x, 69, UI_ICON.coins, 0xf0c95d);
    this.add.text(x + 20, 63, `${this.state.gold}G`, { fontSize: "11px", color: UI_INK.accent });
    this.traceHudValues(x, width);
    // 商人は戦わないので攻撃力も防御力も無い。数字の代わりに、いま背負っている袋を出す。
    const carriedBag = equippedBag(this.state);
    addUiIcon(this, x + 92, 69, UI_ICON.chest, 0xc9ab7c);
    this.add.text(x + 112, 63, carriedBag ? itemName(carriedBag) : "手ぶら", { fontSize: "10px", color: UI_INK.dim });

    const itemCount = currentItemCount(this.state);
    const bag = capacityGaugeColors(itemCount, bagCapacity(this.state));
    addUiIcon(this, x, 89, UI_ICON.chest, 0xc9ab7c);
    addGauge(this, x + 20, 83, width - 20 - GAUGE_VALUE_W, 12, { value: itemCount, max: bagCapacity(this.state), ...bag });
    this.add.text(x + width, 84, `${itemCount}/${bagCapacity(this.state)}`, { fontSize: "10px", color: UI_INK.value }).setOrigin(1, 0);

    const inDungeon = this.state.location === "dungeon";
    const stall = this.state.run?.stall;
    const nextMeal = dungeonTimeUntilNextMeal(this.state);
    const mealCost = dungeonMealProvisionCost(this.state);
    const provisionShortage = this.state.provisions < mealCost;
    const provisionColor = provisionShortage ? "#ff8b62" : this.state.provisions === mealCost ? "#ffd166" : "#b7d8e8";
    const provisionText = provisionShortage
      ? `食料${this.state.provisions}　次回要${mealCost}（不足）あと${nextMeal ?? "-"}行動`
      : `食料${this.state.provisions}　次回${mealCost}個　あと${nextMeal ?? "-"}行動`;
    this.add.text(x, 101, inDungeon ? provisionText : `食料 ${this.state.provisions}　煙玉 ${this.state.smokeBombs}　帰還石 ${this.state.returnStones}`, { fontSize: "10px", color: inDungeon ? provisionColor : "#b7d8e8" });
    if (inDungeon) this.add.text(x, 115, `煙玉 ${this.state.smokeBombs}　帰還石 ${this.state.returnStones}`, { fontSize: "10px", color: "#b7d8e8" });
    const location = this.state.location === "home"
      ? "自宅兼店舗"
      : `地下${this.state.run?.floor ?? 1}階・${this.state.run?.turn ?? 0}手・押返${this.state.run?.shoveCooldown === 0 ? "可" : this.state.run?.shoveCooldown}`;
    this.add.text(x, inDungeon ? 129 : 115, location, { fontSize: "10px", color: "#d9c89e" });
    if (!inDungeon) this.add.text(x, 129, `金庫 ${this.state.vaultGold}G`, { fontSize: "10px", color: "#d9c89e" });
    const guard = this.state.run?.guard;
    if (guard) {
      const npc = this.state.npcs.find((entry) => entry.id === guard.guardId);
      const status = guard.mode === "covering" ? "護衛中" : `後退 ${guard.safeTurns}/${guardRecoveryTurns(this.state, guard.guardId)}`;
      this.add.text(x, inDungeon ? 143 : 129, `護衛 ${npc ? `${npc.rank ?? "E"} ${npc.name}` : "同行者"} HP${guard.hp} ${status}`, { fontSize: "10px", color: guard.mode === "covering" ? "#eee5d1" : "#d6a5a5" });
    }
    if (stall) {
      this.add.text(x, guard ? 157 : 143, `露店 ${stall.slots.length}点　売上 ${stall.earned}G（${stall.soldCount}点）`, { fontSize: "10px", color: "#ffd8a0" });
    }
    const actionTop = (guard ? ACTION_BUTTON_TOP + 14 : ACTION_BUTTON_TOP) + (stall ? 14 : 0);
    addSectionLabel(this, x, actionTop - 14, width, "アクション");
    if (!this.modal && !this.inventoryView) this.renderActionButtons(actionTop);
  }

  /**
   * 前回描画からのHPと所持金の差を、その項目のそばへ浮かせる。
   * キャンペーンが変わった直後は比較対象がないので記録だけ取る。
   */
  private traceHudValues(x: number, width: number): void {
    const previous = this.hudTrace;
    this.hudTrace = { campaignId: this.state.campaignId, hp: this.state.hp, gold: this.state.gold };
    if (!previous || previous.campaignId !== this.state.campaignId) return;
    const hpDelta = this.state.hp - previous.hp;
    if (hpDelta !== 0) {
      addFloatingValue(this, x + width - GAUGE_VALUE_W, 44, `${hpDelta > 0 ? "+" : ""}${hpDelta}`, hpDelta > 0 ? FLOATING_INK.heal : FLOATING_INK.ally);
    }
    const goldDelta = this.state.gold - previous.gold;
    if (goldDelta !== 0) {
      addFloatingValue(this, x + width - 24, 64, `${goldDelta > 0 ? "+" : ""}${goldDelta}G`, goldDelta > 0 ? FLOATING_INK.gold : FLOATING_INK.ally);
    }
  }

  /** 画面下のメッセージ窓。最新の文章は省略せず、複数行で読ませる。 */
  private renderMessageWindow(): void {
    addWindow(this, 0, LOG_Y, MAP_W, LOG_H);
    const entries = this.messageLog.slice(-LOG_ROW_COUNT);
    const previous = entries.length > 1 ? entries[0] : undefined;
    const newest = entries.at(-1);
    if (previous) {
      addSingleLineText(this, LOG_TEXT_X, LOG_Y + LOG_PREVIOUS_Y, LOG_TEXT_W, LOG_PREVIOUS_H, previous.text, {
        fontSize: "11px",
        color: UI_INK.dim,
      }).setAlpha(0.6);
    }
    if (newest) {
      const top = previous ? LOG_LATEST_AFTER_PREVIOUS_Y : LOG_LATEST_SINGLE_Y;
      this.add.text(LOG_TEXT_X, LOG_Y + top, newest.text, {
        fontSize: "11px",
        color: toneInk(newest.tone),
        lineSpacing: 2,
        wordWrap: { width: LOG_TEXT_W, useAdvancedWrap: true },
        maxLines: previous ? 3 : 4,
      }).setFixedSize(LOG_TEXT_W, LOG_H - top - 5);
    }
  }

  private renderActionButtons(startY: number): void {
    const expedition = canBeginExpedition(this.state);
    const buttons: Array<{ label: string; key: string; action: () => void; disabled?: boolean }> = this.state.location === "home"
      ? isShopSessionActive(this.state)
        ? [
          { label: "接客中", key: "", action: () => { const id = this.state.shopSession.currentNpcId; if (id) this.openNpcVisitor(id); }, disabled: !this.state.shopSession.currentNpcId },
          { label: "閉店", key: SHORTCUTS.shop, action: () => this.closeActiveShop() },
          { label: "在庫管理（営業中）", key: SHORTCUTS.inventory, action: () => this.openInventory() },
        ]
        : [
          { label: "調べる", key: SHORTCUTS.investigate, action: () => { this.investigateHome(); this.render(); } },
          { label: "話す", key: SHORTCUTS.talk, action: () => { this.talkHome(); this.render(); } },
          { label: canOpenShop(this.state) ? "開店" : "開店準備", key: SHORTCUTS.shop, action: () => this.openShopForDay() },
          { label: "在庫管理", key: SHORTCUTS.inventory, action: () => this.openInventory() },
          { label: `金庫 (${this.state.vaultGold}G)`, key: "", action: () => this.openVault() },
          { label: this.bulkBadge(), key: "", action: () => this.openBulkOrders() },
          { label: "護衛依頼", key: "", action: () => this.openEscortCommission() },
          { label: expedition.allowed ? "ダンジョン" : expedition.reason === "alreadyExplored" ? "本日の探索済み" : "ダンジョン", key: "", action: () => this.requestExpeditionStart(), disabled: !expedition.allowed },
          { label: "休む", key: "", action: () => { restUntilMorning(this.state); this.render(); } },
        ]
      : [
        { label: this.investigateContext() ?? "調べる", key: SHORTCUTS.investigate, action: () => { this.interactDungeon(); this.render(); }, disabled: !this.investigateContext() },
        { label: "押し返し", key: SHORTCUTS.shove, action: () => this.executeDungeonCommand({ type: "shove", direction: this.facingDirection() }), disabled: !this.facingEnemy() || (this.state.run?.shoveCooldown ?? 0) > 0 },
        this.state.run?.stall
          ? { label: `風呂敷を畳む (${this.state.run.stall.earned}G)`, key: "", action: () => this.executeDungeonCommand({ type: "closeStall" }) }
          : { label: "風呂敷を広げる", key: "", action: () => this.openStallSetup(), disabled: !stallReadiness(this.state).allowed },
        { label: `煙玉 (${this.state.smokeBombs})`, key: "", action: () => this.executeDungeonCommand({ type: "smoke" }), disabled: this.state.smokeBombs <= 0 },
        { label: `帰還石 (${this.state.returnStones})`, key: "", action: () => this.executeDungeonCommand({ type: "return" }), disabled: this.state.returnStones <= 0 },
        { label: "待機", key: "", action: () => this.executeDungeonCommand({ type: "wait" }) },
        { label: "護衛状態", key: "", action: () => this.openActiveGuardStatus(), disabled: !this.state.run?.guard },
        { label: "インベントリ", key: SHORTCUTS.inventory, action: () => this.openInventory() },
      ];
    buttons.forEach((button, index) => this.addActionButton(PANEL_CONTENT_X, startY + index * ACTION_BUTTON_PITCH, PANEL_CONTENT_W, ACTION_BUTTON_H, button.label, button.key, button.action, Boolean(button.disabled)));
  }

  private facingEnemy(): boolean {
    const run = this.state.run;
    if (!run) return false;
    const direction = this.facingDirection();
    return run.enemies.some((enemy) => enemy.pos.x === run.player.x + direction.x && enemy.pos.y === run.player.y + direction.y);
  }

  private addActionButton(x: number, y: number, width: number, height: number, label: string, key: string, action: () => void, disabled = false, active = false): void {
    addSkinButton(this, x, y, width, height, {
      label,
      key: key || undefined,
      disabled,
      active,
      onActivate: () => {
        action();
        if (this.modal && !this.inventoryView) this.render();
      },
    });
  }

  private renderInventoryView(): void {
    const view = this.inventoryView;
    if (!view) return;
    this.add.rectangle(320, 180, 640, 360, 0x08070c, 0.94);
    addWindow(this, 10, 10, 620, 340, { shadow: 4 });
    this.add.text(26, 20, this.state.location === "home" ? "在庫管理" : "インベントリ", { fontSize: "17px", color: UI_INK.title });
    this.add.text(614, 26, `鞄 ${currentItemCount(this.state)}/${bagCapacity(this.state)}枠　食料${this.state.provisions}（${provisionSlotCount(this.state.provisions)}枠） 煙玉${this.state.smokeBombs} 帰還石${this.state.returnStones}`, { fontSize: "10px", color: "#cdd8df" }).setOrigin(1, 0);
    addDivider(this, 26, 46, 588);
    const equipmentCount = this.state.equipment.bagItemId ? 1 : 0;
    const tabs: Array<[InventoryTab, string]> = [
      ["bag", `鞄 ${currentItemCount(this.state)}`],
      ["equipment", `道具袋 ${equipmentCount}`],
      ["storage", `保管庫 ${this.state.store.length}`],
      ["display", `店頭 ${this.state.display.length}/${DISPLAY_CAPACITY}`],
    ];
    tabs.forEach(([tab, label], index) => this.addActionButton(26 + index * 146, 54, 140, 22, label, "", () => {
      if (!this.inventoryView) return;
      this.inventoryView.tab = tab;
      this.inventoryView.selectedId = this.inventoryItems(tab)[0]?.uuid;
      this.inventoryView.checkedIds.clear();
      this.inventoryView.page = 0;
      this.render();
    }, false, view.tab === tab));
    const items = this.inventoryItems(view.tab);
    const itemIds = new Set(items.map((item) => item.uuid));
    view.checkedIds = new Set([...view.checkedIds].filter((id) => itemIds.has(id)));
    const pageCount = Math.max(1, Math.ceil(items.length / INVENTORY_PAGE_SIZE));
    view.page = Phaser.Math.Clamp(view.page, 0, pageCount - 1);
    const pageItems = items.slice(view.page * INVENTORY_PAGE_SIZE, (view.page + 1) * INVENTORY_PAGE_SIZE);
    const selected = items.find((item) => item.uuid === view.selectedId) ?? items[0];
    if (selected && view.selectedId !== selected.uuid) view.selectedId = selected.uuid;
    addWindow(this, 26, 84, 300, 240, { variant: "inset" });
    this.add.text(40, 90, this.state.location === "home" && view.tab !== "equipment" ? "□で複数選択" : `${items.length}点`, { fontSize: "10px", color: UI_INK.dim });
    if (pageCount > 1) {
      this.add.text(220, 90, `${view.page + 1}/${pageCount}`, { fontSize: "10px", color: UI_INK.dim }).setOrigin(0.5, 0);
      this.addActionButton(246, 87, 32, 16, "◀", "", () => {
        if (!this.inventoryView) return;
        this.inventoryView.page = Math.max(0, this.inventoryView.page - 1);
        this.inventoryView.selectedId = this.inventoryItems(this.inventoryView.tab)[this.inventoryView.page * INVENTORY_PAGE_SIZE]?.uuid;
        this.render();
      }, view.page === 0);
      this.addActionButton(282, 87, 32, 16, "▶", "", () => {
        if (!this.inventoryView) return;
        this.inventoryView.page = Math.min(pageCount - 1, this.inventoryView.page + 1);
        this.inventoryView.selectedId = this.inventoryItems(this.inventoryView.tab)[this.inventoryView.page * INVENTORY_PAGE_SIZE]?.uuid;
        this.render();
      }, view.page === pageCount - 1);
    }
    if (!items.length) this.add.text(40, 112, "ここには品物がない。", { fontSize: "12px", color: "#9e94a2" });
    pageItems.forEach((item, index) => {
      const chosen = item.uuid === selected?.uuid;
      const definition = itemDefinition(item);
      const column = Math.floor(index / 11);
      const rowIndex = index % 11;
      const left = 30 + column * 146;
      const top = 106 + rowIndex * 19;
      if (chosen) addSelectionBar(this, left, top, 144, 17);
      const batchEnabled = this.state.location === "home" && view.tab !== "equipment";
      const rowLeft = batchEnabled ? left + 18 : left;
      const row = this.add.rectangle(rowLeft, top, batchEnabled ? 126 : 144, 17, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true });
      if (batchEnabled) {
        const checked = view.checkedIds.has(item.uuid);
        const checkbox = this.add.text(left + 3, top + 1, checked ? "☑" : "☐", { fontSize: "11px", color: checked ? UI_INK.accent : UI_INK.body });
        checkbox.setInteractive({ useHandCursor: true }).on("pointerdown", () => {
          if (!this.inventoryView) return;
          if (this.inventoryView.checkedIds.has(item.uuid)) this.inventoryView.checkedIds.delete(item.uuid); else this.inventoryView.checkedIds.add(item.uuid);
          this.inventoryView.selectedId = item.uuid;
          this.render();
        });
      }
      this.drawRarityPip(left + (batchEnabled ? 26 : 8), top + 8, definition?.rarity);
      const priced = view.tab === "display";
      this.add.text(left + (batchEnabled ? 36 : 18), top + 2, `${itemName(item)}${view.tab === "storage" && this.state.display.includes(item.uuid) ? " ★" : ""}`, {
        fontSize: "10px",
        color: chosen ? UI_INK.onSelection : rarityInk(definition?.rarity),
        // 値札のぶんだけ名前の幅を詰める。行の高さは19pxしかないので折り返させない。
        ...(priced ? { wordWrap: { width: 72 }, maxLines: 1 } : {}),
      });
      if (priced) {
        this.add.text(left + 142, top + 2, `${askingPriceFor(item)}G`, { fontSize: "10px", color: chosen ? UI_INK.onSelection : UI_INK.dim }).setOrigin(1, 0);
      }
      row.on("pointerdown", () => { if (this.inventoryView) this.inventoryView.selectedId = item.uuid; this.render(); });
    });
    addWindow(this, 336, 84, 278, 240, { variant: "inset" });
    if (selected) {
      const definition = itemDefinition(selected);
      addWindow(this, 346, 94, 44, 44, { variant: "inset", fill: UI_COLORS.sunkenTop });
      const artKey = definition?.visualId ? `merchant.${definition.visualId}` : undefined;
      if (artKey && this.textures.exists(artKey)) this.add.image(368, 116, artKey);
      this.add.text(400, 96, itemName(selected), { fontSize: "14px", color: rarityInk(definition?.rarity), wordWrap: { width: 206 } });
      this.add.text(400, 120, `${definition ? this.categoryLabel(definition.category) : selected.definitionId}　${rarityLabel(definition?.rarity)}`, { fontSize: "10px", color: UI_INK.dim });
      addDivider(this, 346, 146, 258, false);
      addUiIcon(this, 346, 160, UI_ICON.sword, 0xe6cfa4);
      this.add.text(366, 154, `${definition?.attack ?? 0}`, { fontSize: "11px", color: UI_INK.value });
      addUiIcon(this, 408, 160, UI_ICON.shield, 0x9fc8e8);
      this.add.text(428, 154, `${definition?.defense ?? 0}`, { fontSize: "11px", color: UI_INK.value });
      // 値段は隠さない。棚に出ている品は付け値も並べる。
      const market = marketPrice(selected);
      const shelved = this.state.display.includes(selected.uuid);
      this.add.text(604, 154, shelved ? `付け値 ${askingPriceFor(selected)}G` : `相場 ${market}G`, { fontSize: "11px", color: shelved ? UI_INK.accent : UI_INK.value }).setOrigin(1, 0);
      const legend = itemLegendLines(this.state, selected);
      this.add.text(346, 178, definition?.description ?? "", {
        fontSize: "10px",
        color: UI_INK.body,
        lineSpacing: 4,
        wordWrap: { width: 258 },
        maxLines: legend.length ? 2 : 4,
      });
      // 由来は説明の下。銘・担がれた深さ・喪った持ち主の三行まで。
      if (legend.length) {
        // Phaser の Text は配列をそのまま複数行として受ける。
        this.add.text(346, 208, legend, {
          fontSize: "10px",
          color: UI_INK.accent,
          lineSpacing: 3,
          wordWrap: { width: 258 },
          maxLines: 3,
        });
      }
      this.renderInventoryActions(selected, 346, 246);
    } else if (view.tab === "equipment") {
      const carried = equippedBag(this.state);
      this.add.text(348, 98, [
        `いま背負っているもの: ${carried ? itemName(carried) : "なし"}`,
        `積める数: ${currentItemCount(this.state)}/${bagCapacity(this.state)}`,
        "",
        "商人は武器も防具も持たない。持っても使いこなせない。",
        "身に着けるのは袋ひとつで、それが一日の稼ぎの上限になる。",
        "大きな袋は金では買えず、迷宮の底からしか出てこない。",
      ].join("\n"), { fontSize: "11px", color: UI_INK.body, lineSpacing: 7, wordWrap: { width: 258 } });
    }
    if (this.state.location === "home" && view.tab !== "equipment") this.renderInventoryBatchToolbar(items);
    else this.add.text(26, 328, `${SHORTCUTS.inventory} / Esc で閉じる。品物は1点1枠、食料は${PROVISIONS_PER_SLOT}個で1枠。`, { fontSize: "10px", color: UI_INK.dim });
  }

  private renderInventoryBatchToolbar(items: ItemInstance[]): void {
    const view = this.inventoryView;
    if (!view) return;
    const selectable = items;
    const selected = selectable.filter((item) => view.checkedIds.has(item.uuid));
    const allSelected = selectable.length > 0 && selected.length === selectable.length;
    const finish = (): void => {
      if (!this.inventoryView) return;
      this.inventoryView.checkedIds.clear();
      const remaining = this.inventoryItems(this.inventoryView.tab);
      this.inventoryView.page = Math.min(this.inventoryView.page, Math.max(0, Math.ceil(remaining.length / INVENTORY_PAGE_SIZE) - 1));
      this.inventoryView.selectedId = remaining[this.inventoryView.page * INVENTORY_PAGE_SIZE]?.uuid;
      this.render();
    };
    this.add.text(26, 332, `選択 ${selected.length}`, { fontSize: "10px", color: selected.length ? UI_INK.accent : UI_INK.dim });
    this.addActionButton(82, 327, 74, 18, allSelected ? "全解除" : "全選択", "", () => {
      if (!this.inventoryView) return;
      this.inventoryView.checkedIds = allSelected ? new Set() : new Set(selectable.map((item) => item.uuid));
      this.render();
    }, selectable.length === 0);

    const ids = selected.map((item) => item.uuid);
    const includesHomeUnsellable = selected.some((item) => !canSellInHomeShop(item));
    if (view.tab === "bag") {
      const displaySlots = Math.max(0, DISPLAY_CAPACITY - this.state.display.length);
      this.addActionButton(160, 327, 122, 18, "保管庫へ", "", () => { moveInventoryItems(this.state, ids, "storage"); finish(); }, selected.length === 0);
      this.addActionButton(286, 327, 122, 18, includesHomeUnsellable ? "薬は店頭販売不可" : `店頭へ（空${displaySlots}）`, "", () => { moveInventoryItems(this.state, ids, "display"); finish(); }, selected.length === 0 || selected.length > displaySlots || includesHomeUnsellable);
    } else if (view.tab === "storage") {
      const newDisplayItems = selected.filter((item) => !this.state.display.includes(item.uuid));
      const displaySlots = Math.max(0, DISPLAY_CAPACITY - this.state.display.length);
      const bagSlots = bagCapacity(this.state) - currentItemCount(this.state);
      this.addActionButton(160, 327, 122, 18, `鞄へ（空${bagSlots}）`, "", () => { moveStoreItemsToInventory(this.state, ids); finish(); }, selected.length === 0 || selected.length > bagSlots);
      this.addActionButton(286, 327, 122, 18, includesHomeUnsellable ? "薬は店頭販売不可" : `店頭へ（空${displaySlots}）`, "", () => { setDisplayedItems(this.state, [...this.state.display, ...ids]); finish(); }, newDisplayItems.length === 0 || newDisplayItems.length > displaySlots || includesHomeUnsellable);
    } else if (view.tab === "display") {
      this.addActionButton(160, 327, 122, 18, "保管庫へ戻す", "", () => {
        const selectedIds = new Set(ids);
        setDisplayedItems(this.state, this.state.display.filter((id) => !selectedIds.has(id)));
        finish();
      }, selected.length === 0);
    }
    this.add.text(422, 332, "R/Esc 閉じる", { fontSize: "10px", color: UI_INK.dim });
  }

  /** 一覧の左端に置く希少度の印。名前の文字色と同じ色で揃える。 */
  private drawRarityPip(x: number, y: number, rarity: ItemRarity | undefined): void {
    const color = Phaser.Display.Color.HexStringToColor(rarityInk(rarity)).color;
    const graphics = this.add.graphics();
    graphics.fillStyle(UI_COLORS.outline, 0.8).fillRect(x - 3, y - 3, 6, 6);
    graphics.fillStyle(color, 1);
    graphics.fillRect(x, y - 2, 1, 1).fillRect(x - 1, y - 1, 3, 1).fillRect(x - 2, y, 5, 1).fillRect(x - 1, y + 1, 3, 1).fillRect(x, y + 2, 1, 1);
  }

  private inventoryItems(tab: InventoryTab): ItemInstance[] {
    if (tab === "bag") return this.state.inventory;
    if (tab === "storage") return this.state.store;
    if (tab === "display") return this.state.display.map((id) => this.state.itemsById[id]).filter((item): item is ItemInstance => Boolean(item));
    const carried = equippedBag(this.state);
    return carried ? [carried] : [];
  }

  private renderInventoryActions(item: ItemInstance, x: number, y: number): void {
    const tab = this.inventoryView?.tab;
    const definition = itemDefinition(item);
    const button = (label: string, action: () => void, disabled = false, row = 0) => this.addActionButton(x, y + row * 26, 258, 22, label, "", action, disabled);
    if (tab === "bag") {
      const isBag = definition?.category === "bag";
      const medicine = (definition?.healing ?? 0) > 0;
      button(medicine ? "自分に使う" : isBag ? `この袋に荷を移す（${definition?.capacity ?? 0}枠）` : "身に着けられない", () => {
        if (medicine) this.executeDungeonCommand({ type: "useMedicine", itemId: item.uuid, target: "player" });
        else { equipBag(this.state, item.uuid); this.render(); }
      }, medicine ? this.state.location !== "dungeon" || this.state.hp >= this.state.maxHp : !isBag, 0);
      if (medicine && this.state.location === "dungeon") button("護衛に使う", () => this.executeDungeonCommand({ type: "useMedicine", itemId: item.uuid, target: "guard" }), !this.state.run?.guard || this.state.run.guard.hp >= this.state.run.guard.maxHp, 1);
      button(this.state.location === "home" ? "保管庫へ移す" : "足元に置く", () => {
        if (this.state.location === "home") moveToStore(this.state, item); else dropItem(this.state, item.uuid);
        if (this.inventoryView) this.inventoryView.selectedId = this.inventoryItems("bag")[0]?.uuid;
        this.render();
      }, false, medicine && this.state.location === "dungeon" ? 2 : 1);
    } else if (tab === "storage") {
      const showing = this.state.display.includes(item.uuid);
      button(showing ? "店頭から下げる" : canSellInHomeShop(item) ? "店頭商品にする" : "回復薬は店頭販売できない", () => { toggleDisplay(this.state, item); this.render(); }, !showing && !canSellInHomeShop(item));
      button("鞄へ戻す", () => { this.retrieveItemToInventory(item); this.render(); }, currentItemCount(this.state) >= bagCapacity(this.state), 1);
    } else if (tab === "display") {
      button("値を付ける", () => this.openShelfPriceMenu(item));
      button("店頭から下げる", () => { toggleDisplay(this.state, item); if (this.inventoryView) this.inventoryView.selectedId = this.inventoryItems("display")[0]?.uuid; this.render(); }, false, 1);
    }
  }

  /**
   * 棚の値付け。
   *
   * 店では高値は通らない。客はよそでも買えるので、相場を大きく超えた品には
   * 値切りもせず「よそをあたる」と言って帰る。ここで稼ぐのは幅ではなく数である。
   */
  private openShelfPriceMenu(item: ItemInstance): void {
    const market = marketPrice(item);
    const current = askingPriceFor(item);
    this.openMenu(`${itemName(item)}の値を決める`, [
      `相場 ${market}G　いまの付け値 ${current}G`,
      "客はよそでも買える。相場を大きく超えれば、値切りもせず帰っていく。",
    ], [
      ...SHOP_PRICE_TIERS.map((tier) => {
        const price = Math.max(1, Math.round(market * tier.rate));
        return {
          label: `${tier.label} ${price}G${price === current ? "（現在）" : ""}`,
          action: () => {
            item.askingPrice = price;
            this.state.message = `${itemName(item)}に${price}Gの値を付けた。`;
            this.closeMenu();
          },
        };
      }),
      { label: "やめる", action: () => this.closeMenu() },
    ]);
    this.render();
  }

  private retrieveItemToInventory(item: ItemInstance): void {
    moveStoreItemsToInventory(this.state, [item.uuid]);
  }

  private renderModal(): void {
    const modal = this.modal;
    if (!modal) return;
    this.add.rectangle(320, 180, 640, 360, 0x07060b, 0.88).setInteractive();
    addWindow(this, 40, 20, 560, 320, { shadow: 4 });
    this.add.text(56, 32, modal.title, { fontSize: "16px", color: UI_INK.title });
    addDivider(this, 56, 56, 528);
    let bodyBottom = 64;
    modal.body.forEach((line) => {
      const text = this.add.text(56, bodyBottom, line, { fontSize: "11px", color: UI_INK.body, lineSpacing: 2, wordWrap: { width: 528, useAdvancedWrap: true } });
      bodyBottom += Math.max(18, text.height + 4);
    });
    const choiceStart = Math.max(140, bodyBottom + 8);
    const visibleCount = Math.max(1, Math.min(8, Math.floor((309 - choiceStart) / 20)));
    const firstChoice = Phaser.Math.Clamp(modal.index - visibleCount + 1, 0, Math.max(0, modal.choices.length - visibleCount));
    if (firstChoice > 0) this.add.text(584, choiceStart - 12, "▲", { fontSize: "10px", color: UI_INK.dim }).setOrigin(1, 0);
    if (firstChoice + visibleCount < modal.choices.length) this.add.text(584, choiceStart + visibleCount * 20 - 2, "▼", { fontSize: "10px", color: UI_INK.dim }).setOrigin(1, 0);
    modal.choices.slice(firstChoice, firstChoice + visibleCount).forEach((choice, index) => {
      const choiceIndex = firstChoice + index;
      const selected = choiceIndex === modal.index;
      const color = choice.disabled ? UI_INK.disabled : selected ? UI_INK.onSelection : "#e7ddc9";
      const top = choiceStart + index * 20 - 2;
      if (selected) addSelectionBar(this, 52, top, 532, 19);
      const hit = this.add.rectangle(318, top + 9, 532, 19, 0xffffff, 0.001)
        .setInteractive({ useHandCursor: !choice.disabled });
      this.add.text(60, choiceStart + index * 20, `${selected ? "▶" : "　"}${choice.label}`, { fontSize: "11px", color });
      hit.on("pointerover", () => {
        if (this.modal && !choice.disabled && this.modal.index !== choiceIndex) {
          this.modal.index = choiceIndex;
          this.render();
        }
      });
      hit.on("pointerdown", () => {
        if (this.modal && !choice.disabled) {
          choice.action();
          if (this.modal) this.render();
        }
      });
    });
    addDivider(this, 56, 314, 528, false);
    this.add.text(56, 320, "↑↓ / マウス 選択　Enter / クリック 決定　Esc 戻る", { fontSize: "10px", color: UI_INK.dim });
  }
}
