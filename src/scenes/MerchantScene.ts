import Phaser from "phaser";
import {
  ACTOR_WALK_FRAMES,
  ASSET_MANIFEST,
  ENEMY_ASSET_VARIANTS,
  NPC_ASSET_VARIANTS,
  GUARD_ASSET_VARIANTS,
  DUNGEON_OBJECT_FRAMES,
} from "../game/assets";
import { CRAFTPIX_ENEMY_ACTORS, CRAFTPIX_PLAYER_ACTOR, actorFrame, type ActorAction, type ActorDirection, type CraftpixActorDefinition } from "../game/craftpixActors";
import { ACTOR_CATALOG, actorDefinition, actorSupportsDirectionalMovement } from "../game/actorCatalog";
import { CRAFTPIX_UI } from "../game/craftpixUi";
import {
  DIRECTION,
  INVENTORY_CAPACITY,
  acceptQuest,
  activeQuestSummary,
  beginExpedition,
  cancelGuard,
  createNewGame,
  currentItemCount,
  dungeonAdventurerBuyPrice,
  dungeonAdventurerSellPrice,
  dropItem,
  guardDefinition,
  guardFee,
  guardRetreatRatio,
  guardRetreatThreshold,
  hireGuard,
  inspectBody,
  isQuestItemProtected,
  itemDefinition,
  itemName,
  lootBodyItem,
  moveInventoryItems,
  movePlayer,
  moveStoreItemsToInventory,
  moveToStore,
  performDungeonCommand,
  questProgressText,
  reportQuest,
  resolveRing,
  scoutRevealsTrap,
  setDisplayedItems,
  toggleDisplay,
  tryOpenChest,
  tryPickup,
  tryStairs,
} from "../game/engine";
import { SaveRepository, type SaveSlot } from "../game/save";
import { HOME_POI, HOME_SPAWN, createHomeMap } from "../game/homeMap";
import { moveMapPosition } from "../game/mapTiles";
import { assignHomeVisitorCells, findHomeVisitorPath } from "../game/homeVisitors";
import { compileMap, loadTrialMap, loadTrialMapPack } from "../game/mapDocument";
import { MAP_ASSET_CATALOG } from "../game/mapAssetCatalog.generated";
import { MISSING_MAP_ASSET_TEXTURE, resolveMapAssetFrame } from "../game/mapAssetRuntime";
import { acceptCustomerPurchaseRequest, cancelEscortCommission, escortFeeForNpc, merchantItemName, postEscortCommission, prepareCustomerPurchaseRequest } from "../game/merchantEconomy";
import {
  SUPPLY_RULES,
  buySupply,
  canOpenShop,
  closeShopSession,
  dungeonMealProvisionCost,
  dungeonTimeUntilNextMeal,
  equipItem,
  finishCurrentCustomer,
  isShopSessionActive,
  playerAttackPower,
  playerDefensePower,
  restUntilMorning,
  startShopSession,
  summonNextCustomer,
  unequipItem,
} from "../game/merchantSystems";
import { ADVENTURER_RANK_ORDER, ADVENTURER_RANKS, ITEM_VISUALS, NPC_APPEARANCES } from "../game/merchantContent";
import type { AdventurerRank, DungeonCommand, DungeonEvent, GameState, ItemInstance, ItemRarity, MenuChoice, NpcRecord, Vec } from "../game/types";
import {
  UI_COLORS,
  UI_INK,
  capacityGaugeColors,
  frameBorderWidth,
  hpGaugeColors,
  rarityInk,
  rarityLabel,
} from "../game/uiTheme";
import { UI_ICON, addDivider, addGauge, addSectionLabel, addSelectionBar, addSkinButton, addUiIcon, addWindow } from "./uiSkin";
const ALL_CRAFTPIX_ACTORS: readonly CraftpixActorDefinition[] = Object.values(ACTOR_CATALOG);
/** Viewport and generated fallback textures stay at the game's base pixel grid. */
const VIEWPORT_BASE_TILE = 16;
const PLACEHOLDER_TILE = 16;
const DUNGEON_LEGACY_TILE = 16;
const LEGACY_ACTOR_SCALE = 0.9;
const LEGACY_ACTOR_ORIGIN_Y = 0.94;
const MAP_W = 448;
const MAP_H = 288;
const LOG_Y = 288;
const LOG_H = 72;
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
  attack: "Space",
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
  `${SHORTCUTS.attack}: 正面を攻撃`,
  `${SHORTCUTS.shove}: 正面を押し返す`,
  `${SHORTCUTS.inventory}: インベントリ`,
  `${SHORTCUTS.menu}: メニュー`,
];
const HOME_SHORTCUT_HINT = `${SHORTCUTS.investigate} 調べる　${SHORTCUTS.talk} 話す　${SHORTCUTS.inventory} 在庫管理　${SHORTCUTS.shop} 開店　${SHORTCUTS.menu} メニュー`;
const DUNGEON_SHORTCUT_HINT = `${SHORTCUTS.investigate} 調べる　${SHORTCUTS.attack} 攻撃　${SHORTCUTS.shove} 押し返し　${SHORTCUTS.inventory} インベントリ　${SHORTCUTS.menu} メニュー`;

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
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private readonly saves = new SaveRepository();
  private gameStarted = false;
  private lastAutoSaveAt = Number.NEGATIVE_INFINITY;
  private gameOverHandled = false;
  private homeWorld?: Phaser.GameObjects.Container;
  private homeBackdrop?: Phaser.Tilemaps.TilemapLayer;
  private homePlayer?: Phaser.GameObjects.Sprite;
  private homeNpcs: RoamingNpc[] = [];
  private customerWalking = false;
  private dungeonWalkAnimations = new Map<string, "up" | "down" | "left" | "right">();
  private playerFacing: "up" | "down" | "left" | "right" = "down";
  private dungeonWorld?: Phaser.GameObjects.Container;
  private dungeonMaskShape?: Phaser.GameObjects.Graphics;
  private hungerTweens: Phaser.Tweens.Tween[] = [];
  /** ウインドウを開いた回数。同じウインドウの再描画では出現演出を繰り返さない。 */
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
    for (const asset of MAP_ASSET_CATALOG) this.load.spritesheet(`map.asset.${asset.id}`, asset.path, { frameWidth: asset.tileSize, frameHeight: asset.tileSize, margin: asset.margin, spacing: asset.spacing });
    this.load.image(ASSET_MANIFEST.mapTiles.homeFloor.textureKey, ASSET_MANIFEST.mapTiles.homeFloor.path);
    this.load.spritesheet(ASSET_MANIFEST.mapTiles.homeWall.textureKey, ASSET_MANIFEST.mapTiles.homeWall.path, { frameWidth: 16, frameHeight: 16 });
    this.load.image(ASSET_MANIFEST.mapTiles.dungeonFloor.textureKey, ASSET_MANIFEST.mapTiles.dungeonFloor.path);
    this.load.spritesheet(ASSET_MANIFEST.mapTiles.dungeonWall.textureKey, ASSET_MANIFEST.mapTiles.dungeonWall.path, { frameWidth: 16, frameHeight: 16 });
    this.load.image("ui.craftpix.panel", CRAFTPIX_UI.panel.path);
    this.load.spritesheet("ui.craftpix.buttons", CRAFTPIX_UI.buttons.path, { frameWidth: CRAFTPIX_UI.buttons.frameWidth, frameHeight: CRAFTPIX_UI.buttons.frameHeight });
    this.load.spritesheet("ui.craftpix.icons", CRAFTPIX_UI.icons.path, { frameWidth: CRAFTPIX_UI.icons.frameWidth, frameHeight: CRAFTPIX_UI.icons.frameHeight });
    this.load.image("ui.craftpix.character-panel", CRAFTPIX_UI.characterPanel.path);
  }

  create(): void {
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
        this.state.run = { seed: Date.now(), floor: trial.floor, map, player: { x: entrance?.x ?? map.stairsUp.x, y: entrance?.y ?? map.stairsUp.y }, enemies: [], items: [], chests: [], traps: [], bodies: [], adventurers: [], shoveCooldown: 0, highestFloor: trial.floor, turn: 0, timeUnits: 0, settledTimeBands: 0, floorStates: {} };
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
    if (this.gameStarted && this.state.status === "gameOver") {
      if (!this.gameOverHandled) this.showGameOver();
      return;
    }
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
      let changed = false;
      if (this.just("up") || this.just("w")) {
        this.modal.index = (this.modal.index - 1 + this.modal.choices.length) % this.modal.choices.length;
        changed = true;
      }
      if (this.just("down") || this.just("s")) {
        this.modal.index = (this.modal.index + 1) % this.modal.choices.length;
        changed = true;
      }
      if (this.just("enter") || this.just("space")) {
        const choice = this.modal.choices[this.modal.index];
        if (choice && !choice.disabled) choice.action();
        changed = true;
      }
      if (changed) this.render();
      return;
    }

    if (!this.gameStarted) return;

    if (this.state.location === "home") this.updateHome(delta);
    else this.updateDungeon();
  }

  private just(key: string): boolean {
    return Phaser.Input.Keyboard.JustDown(this.keys[key]!);
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
      if (this.customerWalking) return;
      if (this.just("r")) this.openInventory();
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
      if (!this.playCraftpixActor(this.homePlayer, CRAFTPIX_PLAYER_ACTOR, "idle", this.playerFacing, true, this.homeScale())) this.homePlayer.play(`player.idle-${this.playerFacing}`, true);
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
    if (this.just("space")) { events.push(...performDungeonCommand(this.state, { type: "attack", direction: this.facingDirection() }).events); acted = true; }
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
        beginExpedition(this.state);
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
      if (currentItemCount(this.state) < INVENTORY_CAPACITY) tryPickup(this.state);
      else this.openSwapMenu(ground.item, (swapOutId) => { tryPickup(this.state, swapOutId); this.closeMenu(); });
      return;
    }
    const chest = run.chests.find((entry) => same(entry.pos, run.player));
    if (chest) {
      if (currentItemCount(this.state) < INVENTORY_CAPACITY) tryOpenChest(this.state, chest.id);
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
      tryStairs(this.state);
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
    this.render();
    this.animateDungeonEvents(result.events);
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
    const definition = guardDefinition(active.guardId);
    const retreatPercent = Math.round(guardRetreatRatio(this.state, active.guardId) * 100);
    const mode = active.mode === "covering" ? "カバー中" : `後退中（安全確認 ${active.safeTurns}/2）`;
    this.openMenu("護衛状態", [
      `${npc ? `${npc.rank ?? "E"}ランク ${npc.name}` : definition?.name ?? active.guardId} — ${npc ? this.professionLabel(npc) : definition?.title ?? "護衛"}`,
      `HP ${active.hp}/${active.maxHp}　攻撃 ${active.damage}　${mode}`,
      `HPが${guardRetreatThreshold(this.state, active)}（${retreatPercent}%）以下になると後退。敵が6マス外に2ターンいれば復帰する。`,
      npc ? "主人公と同じ隊列で近くの敵を自動攻撃する。致命傷を受けると死亡する。" : definition?.description ?? "主人公を自動で守る。",
    ], [{ label: "閉じる", action: () => this.closeMenu() }]);
  }

  private openBodyMenu(bodyId: string): void {
    const body = this.state.run?.bodies.find((entry) => entry.id === bodyId);
    if (!body) return;
    const deadNpc = body.npcId ? this.state.npcs.find((npc) => npc.id === body.npcId) : undefined;
    const lines = deadNpc
      ? [`${deadNpc.name}という名の${this.professionLabel(deadNpc)}だ。`, body.loot.length > 0 ? "所持品を選んで回収する。" : "所持品は残っていない。"]
      : body.id === "aron"
      ? ["認識票には『アロン』と刻まれている。", body.loot.length > 0 ? "残された遺品を選んで回収する。" : "回収できる遺品は残っていない。"]
      : ["身元不明の古い遺体だ。", "持ち帰れる物は残っていない。"];
    this.openMenu(body.name, lines, [
      ...body.loot.map((item) => ({
        label: `回収: ${itemName(item)}`,
        action: () => {
          if (currentItemCount(this.state) < INVENTORY_CAPACITY) {
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

  private openSwapMenu(incoming: ItemInstance, onSwap: (swapOutId: string) => void, onBack: () => void = () => this.closeMenu()): void {
    this.openMenu("持ち物を入れ替える", [
      `鞄は${INVENTORY_CAPACITY}個でいっぱいだ。${itemName(incoming)}を持つには1個置く必要がある。`,
      "どのアイテムも1枠。置いた品は足元に残る。",
    ], [
      ...this.state.inventory.map((item) => ({
        label: `置く: ${itemName(item)}`,
        action: () => onSwap(item.uuid),
      })),
      { label: "やめる", action: onBack },
    ]);
  }

  private poiPosition(poi: HomePoint): Vec {
    return { x: poi.pos.x * this.homeMap.tileSize + this.homeMap.tileSize / 2, y: poi.pos.y * this.homeMap.tileSize + this.homeMap.tileSize / 2 };
  }

  private homeScale(): number { return this.homeMap.tileSize / VIEWPORT_BASE_TILE; }

  private openMenu(title: string, body: string[], choices: MenuChoice[]): void {
    this.modal = { title, body, choices, index: 0 };
    this.windowRevision += 1;
  }

  private closeMenu(): void {
    this.modal = undefined;
    this.render();
  }

  private async openTitle(): Promise<void> {
    const choices = (available: SaveSlot[]): MenuChoice[] => [
      { label: "新しい商人として始める", action: () => { this.state = createNewGame(); this.gameOverHandled = false; this.gameStarted = true; this.closeMenu(); } },
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
    await this.saves.save(slot, this.state);
    this.state.message = `${slot.replace("manual-", "手動保存 ")}へ記録した。`;
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
    this.openMenu("メニュー", [
      this.state.location === "dungeon" ? "探索中はメニューを開いてもターンは進まない。" : `自宅兼店舗 ${this.state.day}日目`,
      `所持金 ${this.state.gold}G　所持数 ${currentItemCount(this.state)}/${INVENTORY_CAPACITY}`,
    ], [
      { label: this.state.location === "home" ? "在庫管理" : "持ち物", action: () => this.openInventory() },
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
    const visual = npc ? NPC_APPEARANCES[npc.appearanceId] : undefined;
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
    this.openMenu("街の仕入先", ["食料・煙玉・帰還石はアイテム枠を使わない。", `所持金 ${this.state.gold}G`], [
      ...(["provisions", "smokeBombs", "returnStones"] as const).map((kind) => ({
        label: `${SUPPLY_RULES[kind].supplier}: ${SUPPLY_RULES[kind].label} ${SUPPLY_RULES[kind].price}G（残${this.state.dailySupplyStock[kind]}）`,
        disabled: this.state.dailySupplyStock[kind] <= 0,
        action: () => { buySupply(this.state, kind, 1); this.openSupplyShop(); },
      })),
      { label: "閉じる", action: () => this.closeMenu() },
    ]);
  }

  private openNpcVisitor(npcId: string): void {
    const npc = this.state.npcs.find((entry) => entry.id === npcId);
    if (!npc) return;
    if (this.state.escortCommission?.npcId === npcId && this.state.escortCommission.status === "accepted") {
      this.openMenu(`${npc.name} — ${this.professionLabel(npc)}`, [
        `護衛料 ${this.state.escortCommission.offeredFee}G 支払済み`,
        `危険時の後退基準: HP ${Math.round(guardRetreatRatio(this.state, npc.id) * 100)}%以下`,
        "出発すると契約の取消と返金はできない。",
      ], [
        { label: "一緒にダンジョンへ出発", action: () => { beginExpedition(this.state); this.closeMenu(); } },
        { label: "護衛依頼を取り消す", action: () => { cancelEscortCommission(this.state); this.closeMenu(); } },
        { label: "閉じる", action: () => this.closeMenu() },
      ]);
      return;
    }
    const request = prepareCustomerPurchaseRequest(this.state, npc.id);
    const requestedItem = request ? this.state.itemsById[request.itemId] : undefined;
    this.openMenu(`${npc.rank ?? "E"}ランク ${npc.name} — ${this.professionLabel(npc)}`, [
      `興味: ${npc.interests.map((interest) => this.categoryLabel(interest)).join(" / ")}`,
      requestedItem && request
        ? `${npc.name}「${merchantItemName(requestedItem) ?? itemName(requestedItem)}を${request.price}Gで譲ってほしい」`
        : "欲しい商品が棚に見つからないようだ。",
    ], [
      ...(requestedItem && request ? [
        { label: `${request.price}Gで売る`, action: () => {
          const result = acceptCustomerPurchaseRequest(this.state);
          this.state.message = result.message;
          this.openMenu(result.accepted ? "売買成立" : "取引できない", [result.message], [{ label: "接客を終える", action: () => this.finishCustomerAndContinue() }]);
        } },
        { label: "今回は断る", action: () => {
          const message = `${npc.name}への売却を断った。`;
          this.state.message = message;
          this.openMenu("売却を断った", [message], [{ label: "接客を終える", action: () => this.finishCustomerAndContinue() }]);
        } },
      ] : []),
      { label: this.state.shopSession.currentNpcId === npc.id ? "接客を終える" : "閉じる", action: () => this.state.shopSession.currentNpcId === npc.id ? this.finishCustomerAndContinue() : this.closeMenu() },
    ]);
  }

  private openDungeonAdventurer(npcId: string): void {
    const adventurer = this.state.run?.adventurers.find((entry) => entry.npcId === npcId);
    const npc = this.state.npcs.find((entry) => entry.id === npcId);
    if (!adventurer || !npc) { this.closeMenu(); return; }
    this.openMenu(`${npc.rank ?? "E"}ランク ${npc.name} — ${this.professionLabel(npc)}`, [
      `HP ${adventurer.hp}/${adventurer.maxHp}　攻撃 ${adventurer.damage}　所持金 ${adventurer.gold}G`,
      "この冒険者も独自に探索し、敵と戦う。取引は1ターン消費する。",
    ], [
      { label: "商品を買う", action: () => this.openDungeonAdventurerStock(npcId) },
      { label: "手持ちを売る", action: () => this.openDungeonAdventurerBuyback(npcId) },
      { label: "取引しない", action: () => this.closeMenu() },
    ]);
  }

  private openDungeonAdventurerStock(npcId: string): void {
    const adventurer = this.state.run?.adventurers.find((entry) => entry.npcId === npcId);
    const npc = this.state.npcs.find((entry) => entry.id === npcId);
    if (!adventurer || !npc) { this.closeMenu(); return; }
    const stock = npc.inventoryIds.map((id) => this.state.itemsById[id]).filter((item): item is ItemInstance => Boolean(item));
    this.openMenu(`${npc.name}の商品`, [stock.length ? `所持金 ${this.state.gold}G` : "売ってもらえる品は残っていない。"], [
      ...stock.map((item) => ({
        label: `買う: ${itemName(item)} ${dungeonAdventurerSellPrice(item)}G`,
        disabled: this.state.gold < dungeonAdventurerSellPrice(item),
        action: () => {
          if (currentItemCount(this.state) < INVENTORY_CAPACITY) {
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
    const wanted = this.state.inventory.filter((item) => {
      const definition = itemDefinition(item);
      return npc.interests.includes(definition.category) || (adventurer.hp < adventurer.maxHp && (definition.healing ?? 0) > 0);
    }).slice(0, 8);
    this.openMenu(`${npc.name}へ売る`, [
      `相手の所持金 ${adventurer.gold}G`,
      wanted.length ? `探している品: ${npc.interests.map((category) => this.categoryLabel(category)).join("・")}` : "相手が欲しがる品を持っていない。",
    ], [
      ...wanted.map((item) => ({
        label: `売る: ${itemName(item)} ${dungeonAdventurerBuyPrice(item)}G`,
        disabled: isQuestItemProtected(this.state, item) || adventurer.gold < dungeonAdventurerBuyPrice(item),
        action: () => this.executeDungeonCommand({ type: "sellToAdventurer", npcId, itemId: item.uuid }),
      })),
      { label: "戻る", action: () => this.openDungeonAdventurer(npcId) },
    ]);
  }

  private professionLabel(npc: NpcRecord): string {
    return ({ swordsman: "剣士", scout: "斥候", mercenary: "傭兵", merchant: "商人", blacksmith: "鍛冶師", apothecary: "薬師", noble: "貴族", townsperson: "街人" } as const)[npc.profession];
  }

  private categoryLabel(category: NpcRecord["interests"][number]): string {
    return ({ weapon: "武器", armor: "防具", medicine: "薬品", material: "素材", curio: "珍品", arcane: "魔法品", relic: "遺物", gem: "宝石", book: "書物", art: "美術品" } as const)[category];
  }

  private openGuildMenu(): void {
    const contracted = this.state.escortCommission?.npcId ? this.state.npcs.find((npc) => npc.id === this.state.escortCommission?.npcId) : undefined;
    this.openMenu("探索準備", [
      contracted ? `${contracted.rank ?? "E"}ランクの${contracted.name}が店で出発を待っている。` : "ランクを選び、能力を見比べて護衛を指定する。",
      "護衛なしで出発することもできる。",
    ], [
      { label: "地下迷宮へ入る", action: () => { beginExpedition(this.state); this.closeMenu(); } },
      { label: contracted ? "護衛依頼を確認" : "護衛を指定する", action: () => this.openEscortCommission() },
      { label: "閉じる", action: () => this.closeMenu() },
    ]);
  }

  private openEscortCommission(): void {
    const current = this.state.escortCommission;
    if (current?.status === "accepted" && current.npcId) {
      const npc = this.state.npcs.find((entry) => entry.id === current.npcId)!;
      const rank = npc.rank ?? "E";
      this.openMenu("護衛依頼", [`${rank}ランクの${npc.name}が${current.offeredFee}Gで受注済み。`, `HP ${npc.maxHp ?? 0}　攻撃 ${npc.damage ?? 0}　推奨 地下${ADVENTURER_RANKS[rank].recommendedFloor}階まで`, `後退基準: HP ${Math.round(guardRetreatRatio(this.state, npc.id) * 100)}%以下`, "店内の本人へ話しかけると一緒に出発できる。"], [
        { label: "依頼を取り消して返金", action: () => { cancelEscortCommission(this.state); this.openGuildMenu(); } },
        { label: "戻る", action: () => this.openGuildMenu() },
      ]);
      return;
    }
    this.openMenu("護衛ランク", [`所持金: ${this.state.gold}G`, "高ランクほどHPと攻撃が高く、深い階層で生き残りやすい。"], [
      ...ADVENTURER_RANK_ORDER.map((rank) => {
        const definition = ADVENTURER_RANKS[rank];
        const count = this.state.npcs.filter((npc) => npc.adventurer && npc.rank === rank && (npc.status === "inTown" || npc.status === "visiting")).length;
        return { label: `${rank}ランク — 基準${definition.escortFee}G／推奨 地下${definition.recommendedFloor}階（${count}人）`, disabled: count === 0, action: () => this.openEscortRank(rank) };
      }),
      { label: "戻る", action: () => this.openGuildMenu() },
    ]);
  }

  private openEscortRank(rank: AdventurerRank): void {
    const candidates = this.state.npcs.filter((npc) => npc.adventurer && npc.rank === rank && (npc.status === "inTown" || npc.status === "visiting"));
    const rankDefinition = ADVENTURER_RANKS[rank];
    this.openMenu(`${rank}ランク護衛`, [`推奨: 地下${rankDefinition.recommendedFloor}階まで`, "能力・後退判断・価格を比較して本人を指定する。"], [
      ...candidates.map((npc) => {
        const fee = escortFeeForNpc(this.state, npc);
        return {
          label: `${npc.name} HP${npc.maxHp ?? 0} 攻${npc.damage ?? 0} 後退${Math.round((npc.retreatHpRatio ?? 0.25) * 100)}% — ${fee}G`,
          disabled: this.state.gold < fee,
          action: () => { postEscortCommission(this.state, npc.id); this.openEscortCommission(); },
        };
      }),
      { label: "ランク選択へ戻る", action: () => this.openEscortCommission() },
    ]);
  }

  private openQuestBoard(): void {
    this.openEscortCommission();
    return;
    /* Legacy player-received quests are intentionally unreachable in v5. */
    const active = activeQuestSummary(this.state).split("\n");
    const visible = this.state.quests.filter((quest) => quest.status !== "locked");
    this.openMenu("依頼と報告", ["受注中", ...active, "", "完了条件を満たした依頼はここで報告する。"], [
      ...visible.map((quest) => ({
        label: `${quest.status === "active" ? "▶" : quest.status === "readyToReport" ? "!" : quest.status === "complete" ? "✓" : "○"} ${quest.title} — ${questProgressText(this.state, quest)}`,
        disabled: quest.status === "active" || quest.status === "complete",
        action: () => {
          if (quest.status === "readyToReport") {
            if (quest.id === "old-ring") this.openRingResolution();
            else { reportQuest(this.state, quest.id); this.openQuestBoard(); }
          } else {
            acceptQuest(this.state, quest.id);
            this.openQuestBoard();
          }
        },
      })),
      { label: "ギルドへ戻る", action: () => this.openGuildMenu() },
      { label: "閉じる", action: () => this.closeMenu() },
    ]);
  }

  private openRingResolution(): void {
    this.openMenu("古びた指輪の行方", [
      "三人から得た情報を踏まえ、取り消せない決断をする。",
      "選択は報酬、関係、今後の護衛料に影響する。",
    ], [
      { label: "遺族へ返す — 250G／ギルド評判+2", action: () => this.finishRingResolution("family") },
      { label: "学者へ託す — 700G／エリス関係+2", action: () => this.finishRingResolution("scholar") },
      { label: "宝石商へ売る — 1300G／サフィ関係+2", action: () => this.finishRingResolution("jeweler") },
      { label: "まだ決めない", action: () => this.openQuestBoard() },
    ]);
  }

  private finishRingResolution(resolution: "family" | "scholar" | "jeweler"): void {
    const result = resolveRing(this.state, resolution);
    this.openMenu("序章完了", [result, "黒い長剣の噂がギルドに届いた。"], [{ label: "閉じる", action: () => this.closeMenu() }]);
  }

  private openGuardRoster(): void {
    const hired = this.state.hiredGuardId ? guardDefinition(this.state.hiredGuardId) : undefined;
    this.openMenu("護衛契約", [
      hired ? `契約中: ${hired.name}（${this.state.hiredGuardFee}G支払済）` : "次の遠征1回分を前払いで契約する。",
      "出発前なら契約変更・取消時に全額返金される。",
    ], [
      ...this.state.guards.filter((guard) => guard.unlocked).map((guard) => {
        const definition = guardDefinition(guard.id)!;
        const injured = (guard.injuredUntilDay ?? 0) > this.state.day;
        return {
          label: `${definition.name} Lv${guard.level} HP${definition.baseMaxHp + guard.level - 1} 攻${definition.damage} 後退${Math.round(definition.retreatHpRatio * 100)}% — ${injured ? `${guard.injuredUntilDay}日目まで療養` : `${guardFee(this.state, guard.id)}G`}`,
          disabled: injured || this.state.hiredGuardId === guard.id,
          action: () => { hireGuard(this.state, guard.id); this.openGuardRoster(); },
        };
      }),
      { label: "契約を取り消す", disabled: !this.state.hiredGuardId, action: () => { cancelGuard(this.state); this.openGuardRoster(); } },
      { label: "ギルドへ戻る", action: () => this.openGuildMenu() },
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
    this.children.removeAll(true);
    // removeAll(true) destroys the backdrop layer; drop the stale handle too.
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
    this.renderHud();
    const overlayStart = this.children.list.length;
    if (this.inventoryView) this.renderInventoryView();
    else if (this.modal) this.renderModal();
    if (this.inventoryView || this.modal) this.fadeInWindow(overlayStart);
    this.polishText();
    this.saveAuto();
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
    const playerTexture = this.craftpixActorTexture(CRAFTPIX_PLAYER_ACTOR) ?? ASSET_MANIFEST.player.textureKey;
    const player = this.add.sprite(154, 244, playerTexture, 0);
    if (!this.playCraftpixActor(player, CRAFTPIX_PLAYER_ACTOR, "idle", "down", true, 2.05)) player.setOrigin(0.5, LEGACY_ACTOR_ORIGIN_Y).setScale(1.8).play("player.idle-down");
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
    const playerTexture = this.craftpixActorTexture(CRAFTPIX_PLAYER_ACTOR) ?? ASSET_MANIFEST.player.textureKey;
    const homeScale = this.homeScale();
    const player = this.add.sprite(this.state.homePos.x, this.state.homePos.y + this.homeMap.tileSize / 2, playerTexture, 0);
    if (!this.playCraftpixActor(player, CRAFTPIX_PLAYER_ACTOR, "idle", this.playerFacing, true, homeScale)) player.setOrigin(0.5, LEGACY_ACTOR_ORIGIN_Y).setScale(LEGACY_ACTOR_SCALE * homeScale).play(`player.idle-${this.playerFacing}`);
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
    const world = this.add.container(0, 0);
    this.dungeonWorld = world;
    this.renderDungeonAssets(world);
    this.updateDungeonPresentation();
  }

  private dungeonPartyOffsets(mode: "covering" | "retreated" = "covering"): { player: Vec; guard: Vec } {
    const facing = DIRECTION[this.playerFacing];
    const front = { x: facing.x * 4, y: facing.y * 4 };
    const back = { x: -front.x, y: -front.y };
    return mode === "covering" ? { player: back, guard: front } : { player: front, guard: back };
  }

  private renderDungeonAssets(world: Phaser.GameObjects.Container): void {
    const run = this.state.run;
    if (!run) return;
    const add = <T extends Phaser.GameObjects.GameObject>(object: T): T => { world.add(object); return object; };
    const tile = run.map.tileSize ?? DUNGEON_LEGACY_TILE;
    const center = tile / 2;
    const partyOffsets = this.dungeonPartyOffsets(run.guard?.mode);
    const place = (x: number, y: number, texture: string, frame: number, alpha = 1): Phaser.GameObjects.Image => {
      const image = this.add.image(x * tile + center, y * tile + center, texture, frame).setDisplaySize(tile, tile).setAlpha(alpha);
      return add(image);
    };
    {
      const authored = run.map.authoredLayers;
      const hasAuthored = authored && Object.values(authored).some((values) => values?.some(Boolean));
      if (hasAuthored) {
        for (let y = 0; y < run.map.height; y += 1) for (let x = 0; x < run.map.width; x += 1) {
          const index = y * run.map.width + x;
          for (const name of ["ground", "structure", "decoration"] as const) {
            const cell = authored[name]?.[index];
            if (cell) {
              const resolved = resolveMapAssetFrame(cell.assetId, cell.frame, (key) => this.textures.exists(key));
              place(x, y, resolved.textureKey, resolved.frame);
            }
          }
        }
      } else {
        for (let y = 0; y < run.map.height; y += 1) for (let x = 0; x < run.map.width; x += 1) {
          const terrain = run.map.tiles[y]?.[x] === 1 ? "dungeon.wall" : "dungeon.floor";
          place(x, y, terrain === "dungeon.wall" ? ASSET_MANIFEST.mapTiles.dungeonWall.textureKey : ASSET_MANIFEST.mapTiles.dungeonFloor.textureKey, 0);
        }
      }
    }

    {
      const markerAt = (position: Vec, visual: { assetId: string; frame: number } | undefined, fallbackFrame: number): void => {
        if (!visual) {
          place(position.x, position.y, "object.dungeon", fallbackFrame);
          return;
        }
        const resolved = resolveMapAssetFrame(visual.assetId, visual.frame, (key) => this.textures.exists(key));
        place(position.x, position.y, resolved.textureKey, resolved.frame);
      };
      if (run.map.stairsDown) markerAt(run.map.stairsDown, run.map.stairsDownVisual, DUNGEON_OBJECT_FRAMES.stairs);
      markerAt(run.map.stairsUp, run.map.stairsUpVisual, DUNGEON_OBJECT_FRAMES.returnStairs);
      if (run.map.specialRoom) place(run.map.specialRoom.x, run.map.specialRoom.y, "object.dungeon", DUNGEON_OBJECT_FRAMES.torch);
    }
    for (const entry of run.items) {
      const texture = entry.item.visualId ? `merchant.${entry.item.visualId}` : "";
      if (texture && this.textures.exists(texture)) place(entry.pos.x, entry.pos.y, texture, 0);
      else {
        const frame = Array.from(entry.item.definitionId).reduce((total, character) => total + character.charCodeAt(0), 0) % 8;
        place(entry.pos.x, entry.pos.y, ASSET_MANIFEST.item.textureKey, frame);
      }
    }
    for (const chest of run.chests) {
      place(chest.pos.x, chest.pos.y, "object.dungeon", DUNGEON_OBJECT_FRAMES.chest);
    }
    for (const trap of run.traps) {
      const revealed = same(trap, run.player) || scoutRevealsTrap(this.state, trap);
      if (revealed) place(trap.x, trap.y, "object.dungeon", DUNGEON_OBJECT_FRAMES.trap, 0.72);
    }
    for (const body of run.bodies) {
      place(body.pos.x, body.pos.y, "object.dungeon", DUNGEON_OBJECT_FRAMES.bones);
    }
    for (const enemy of run.enemies) {
      const actorDefinition = this.craftpixEnemyActor(enemy.id, enemy.actorId);
      const textureKey = actorDefinition ? (this.craftpixActorTexture(actorDefinition) ?? this.enemyTextureKey(enemy.id)) : this.enemyTextureKey(enemy.id);
      const sprite = this.add.sprite(enemy.pos.x * tile + center, enemy.pos.y * tile + tile, textureKey, 0).setName(`actor:${enemy.id}`);
      const direction = this.dungeonWalkAnimations.get(enemy.id) ?? "down";
      if (!actorDefinition || !this.playCraftpixActor(sprite, actorDefinition, "idle", direction)) sprite.setOrigin(0.5, LEGACY_ACTOR_ORIGIN_Y).setScale(LEGACY_ACTOR_SCALE).play(`${textureKey}.idle-${direction}`);
      add(sprite);
    }
    for (const adventurer of run.adventurers) {
      const npc = this.state.npcs.find((entry) => entry.id === adventurer.npcId);
      const appearance = npc ? NPC_APPEARANCES[npc.appearanceId] : undefined;
      const craftpix = appearance ? actorDefinition(appearance) : undefined;
      const textureKey = craftpix ? (this.craftpixActorTexture(craftpix) ?? ASSET_MANIFEST.npc.textureKey) : ASSET_MANIFEST.npc.textureKey;
      const direction = this.dungeonWalkAnimations.get(adventurer.npcId) ?? "down";
      const sprite = this.add.sprite(adventurer.pos.x * tile + center, adventurer.pos.y * tile + tile, textureKey, 0).setName(`actor:${adventurer.npcId}`);
      if (!craftpix || !this.playCraftpixActor(sprite, craftpix, "idle", direction)) sprite.setOrigin(0.5, LEGACY_ACTOR_ORIGIN_Y).setScale(LEGACY_ACTOR_SCALE).play(`${textureKey}.idle-${direction}`);
      add(sprite);
    }
    if (run.guard) {
      const npc = this.state.npcs.find((entry) => entry.id === run.guard?.guardId);
      const appearance = npc ? NPC_APPEARANCES[npc.appearanceId] : undefined;
      const craftpix = appearance ? actorDefinition(appearance) : undefined;
      const definition = guardDefinition(run.guard.guardId);
      const textureKey = craftpix ? (this.craftpixActorTexture(craftpix) ?? ASSET_MANIFEST.npc.textureKey) : definition?.textureKey ?? "actor.npc.scout";
      const direction = this.dungeonWalkAnimations.get(run.guard.guardId) ?? "down";
      const sprite = this.add.sprite(run.guard.pos.x * tile + center + partyOffsets.guard.x, run.guard.pos.y * tile + tile + partyOffsets.guard.y, textureKey, 0).setName(`actor:${run.guard.guardId}`);
      if (!craftpix || !this.playCraftpixActor(sprite, craftpix, "idle", direction)) sprite.setOrigin(0.5, LEGACY_ACTOR_ORIGIN_Y).setScale(LEGACY_ACTOR_SCALE).play(`${textureKey}.idle-${direction}`);
      if (run.guard.mode === "retreated") sprite.setTint(0x8b8791).setAlpha(0.72);
      add(sprite);
    }
    const playerTexture = this.craftpixActorTexture(CRAFTPIX_PLAYER_ACTOR) ?? ASSET_MANIFEST.player.textureKey;
    const player = this.add.sprite(run.player.x * tile + center + (run.guard ? partyOffsets.player.x : 0), run.player.y * tile + tile + (run.guard ? partyOffsets.player.y : 0), playerTexture, 0).setName("actor:player");
    if (!this.playCraftpixActor(player, CRAFTPIX_PLAYER_ACTOR, "idle", this.playerFacing)) player.setOrigin(0.5, LEGACY_ACTOR_ORIGIN_Y).setScale(LEGACY_ACTOR_SCALE).play(`player.idle-${this.playerFacing}`);
    add(player);
    if (this.state.provisions === 0) this.renderHungerEffect(world, player, tile);
    if (run.guard?.mode === "covering") {
      const guardSprite = world.getByName(`actor:${run.guard.guardId}`);
      if (guardSprite) world.bringToTop(guardSprite);
    }
    this.dungeonMaskShape = this.make.graphics({ x: 0, y: 0 });
    this.dungeonMaskShape.fillStyle(0xffffff).fillRect(0, 0, MAP_W, MAP_H);
    world.setMask(this.dungeonMaskShape.createGeometryMask());
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
      if (id === "player") return CRAFTPIX_PLAYER_ACTOR;
      const guard = this.state.run?.guard;
      if (guard?.guardId === id) {
        const npc = this.state.npcs.find((entry) => entry.id === id);
        const appearance = npc ? NPC_APPEARANCES[npc.appearanceId] : undefined;
        return appearance ? actorDefinition(appearance) : undefined;
      }
      const enemy = this.state.run?.enemies.find((entry) => entry.id === id);
      return this.craftpixEnemyActor(id, enemy?.actorId);
    };
    const actorOffset = (id: string): Vec => {
      const guard = this.state.run?.guard;
      if (!guard) return { x: 0, y: 0 };
      const offsets = this.dungeonPartyOffsets(guard.mode);
      if (id === "player") return offsets.player;
      if (id === guard.guardId) return offsets.guard;
      return { x: 0, y: 0 };
    };
    for (const event of events) {
      if (event.type === "move" || (event.type === "shove" && event.success)) {
        const sprite = actor(event.type === "move" ? event.actorId : event.enemyId);
        if (!sprite) continue;
        const from = event.from;
        const to = event.to;
        const tile = this.state.run?.map.tileSize ?? DUNGEON_LEGACY_TILE;
        const center = tile / 2;
        const offset = actorOffset(event.type === "move" ? event.actorId : event.enemyId);
        sprite.setPosition(from.x * tile + center + offset.x, from.y * tile + tile + offset.y);
        this.tweens.add({ targets: sprite, x: to.x * tile + center + offset.x, y: to.y * tile + tile + offset.y, duration: event.type === "shove" ? 130 : 90, ease: "Quad.Out" });
      } else if (event.type === "shove" && !event.success) {
        const sprite = actor(event.enemyId);
        if (sprite) this.tweens.add({ targets: sprite, x: sprite.x + 2, duration: 45, yoyo: true, repeat: 1 });
      } else if (event.type === "guardMode") {
        const sprite = actor(event.guardId);
        if (sprite) this.tweens.add({ targets: sprite, alpha: event.mode === "retreated" ? 0.72 : 1, duration: 160, yoyo: true, repeat: 1 });
      } else if (event.type === "attack") {
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
    const points = HOME_POINTS.map((point) => point.id === "entrance" ? { ...point, pos: entrance } : point.id === "guild" ? { ...point, pos: preparation } : point.id === "visitors" ? { ...point, pos: visitors } : point);
    return [...points, ...customers];
  }

  private showGameOver(): void {
    this.gameOverHandled = true;
    const campaignId = this.state.campaignId;
    void this.saves.deleteCampaign(campaignId).catch(() => undefined);
    this.openMenu("ゲームオーバー", [
      this.state.message,
      `到達日: ${this.state.day}日目${this.state.run ? `　地下${this.state.run.floor}階` : ""}`,
      "この商人の自動保存・手動保存はすべて無効になりました。",
    ], [{ label: "新しい商人として始める", action: () => {
      this.state = createNewGame();
      this.gameOverHandled = false;
      this.gameStarted = true;
      this.closeMenu();
    } }]);
    this.render();
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
    const targetX = Phaser.Math.Clamp(this.state.homePos.x - MAP_W / 2, 0, Math.max(0, this.homeMap.width * this.homeMap.tileSize - MAP_W));
    const targetY = Phaser.Math.Clamp(this.state.homePos.y - MAP_H / 2, 0, Math.max(0, this.homeMap.height * this.homeMap.tileSize - MAP_H));
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
    if (!this.playCraftpixActor(this.homePlayer, CRAFTPIX_PLAYER_ACTOR, "walk", facing, true, this.homeScale())) {
      if (this.homePlayer.anims.currentAnim?.key !== direction) this.homePlayer.play(direction, true);
    }
  }

  private drawHomeNpcs(world: Phaser.GameObjects.Container): void {
    this.homePoints().forEach((poi, index) => {
      if (poi.kind === "entrance" || poi.kind === "guild" || poi.kind === "visitors") return;
      const center = this.poiPosition(poi);
      const homeScale = this.homeScale();
      const npc = poi.customerId ? this.state.npcs.find((entry) => entry.id === poi.customerId) : undefined;
      const visual = npc ? NPC_APPEARANCES[npc.appearanceId] : undefined;
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
    addUiIcon(this, x + 92, 69, UI_ICON.sword, 0xe6cfa4);
    this.add.text(x + 112, 63, `${playerAttackPower(this.state)}`, { fontSize: "11px", color: UI_INK.value });
    addUiIcon(this, x + 134, 69, UI_ICON.shield, 0x9fc8e8);
    this.add.text(x + 154, 63, `${playerDefensePower(this.state)}`, { fontSize: "11px", color: UI_INK.value });

    const itemCount = currentItemCount(this.state);
    const bag = capacityGaugeColors(itemCount, INVENTORY_CAPACITY);
    addUiIcon(this, x, 89, UI_ICON.chest, 0xc9ab7c);
    addGauge(this, x + 20, 83, width - 20 - GAUGE_VALUE_W, 12, { value: itemCount, max: INVENTORY_CAPACITY, ...bag });
    this.add.text(x + width, 84, `${itemCount}/${INVENTORY_CAPACITY}`, { fontSize: "10px", color: UI_INK.value }).setOrigin(1, 0);

    const inDungeon = this.state.location === "dungeon";
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
    const guard = this.state.run?.guard;
    if (guard) {
      const npc = this.state.npcs.find((entry) => entry.id === guard.guardId);
      const status = guard.mode === "covering" ? "護衛中" : `後退 ${guard.safeTurns}/2`;
      this.add.text(x, inDungeon ? 143 : 129, `護衛 ${npc ? `${npc.rank ?? "E"} ${npc.name}` : "同行者"} HP${guard.hp} ${status}`, { fontSize: "10px", color: guard.mode === "covering" ? "#eee5d1" : "#d6a5a5" });
    }
    const actionTop = guard ? ACTION_BUTTON_TOP + 14 : ACTION_BUTTON_TOP;
    addSectionLabel(this, x, actionTop - 14, width, "アクション");
    if (!this.modal && !this.inventoryView) this.renderActionButtons(actionTop);
  }

  /** 画面下のメッセージ窓。本文と操作ヒントを罫線で分ける。 */
  private renderMessageWindow(): void {
    addWindow(this, 0, LOG_Y, MAP_W, LOG_H);
    this.add.text(10, LOG_Y + 10, this.state.message, { fontSize: "11px", color: UI_INK.value, lineSpacing: 2, wordWrap: { width: MAP_W - 20, useAdvancedWrap: true } });
    addDivider(this, 10, LOG_Y + 44, MAP_W - 20, false);
    const hint = this.state.location === "home" ? HOME_SHORTCUT_HINT : DUNGEON_SHORTCUT_HINT;
    this.add.text(10, LOG_Y + 48, hint, { fontSize: "10px", color: UI_INK.dim });
  }

  private renderActionButtons(startY: number): void {
    const buttons: Array<{ label: string; key: string; action: () => void; disabled?: boolean }> = this.state.location === "home"
      ? isShopSessionActive(this.state)
        ? [
          { label: "接客中", key: "", action: () => { const id = this.state.shopSession.currentNpcId; if (id) this.openNpcVisitor(id); }, disabled: !this.state.shopSession.currentNpcId },
          { label: "閉店", key: SHORTCUTS.shop, action: () => this.closeActiveShop() },
          { label: "在庫管理", key: SHORTCUTS.inventory, action: () => this.openInventory() },
        ]
        : [
          { label: "調べる", key: SHORTCUTS.investigate, action: () => { this.investigateHome(); this.render(); } },
          { label: "話す", key: SHORTCUTS.talk, action: () => { this.talkHome(); this.render(); } },
          { label: canOpenShop(this.state) ? "開店" : "開店準備", key: SHORTCUTS.shop, action: () => this.openShopForDay() },
          { label: "在庫管理", key: SHORTCUTS.inventory, action: () => this.openInventory() },
          { label: "探索用品", key: "", action: () => this.openSupplyShop() },
          { label: "護衛依頼", key: "", action: () => this.openQuestBoard() },
          { label: "ダンジョン", key: "", action: () => { beginExpedition(this.state); this.render(); }, disabled: this.state.timeSlot === "night" },
          { label: "休む", key: "", action: () => { restUntilMorning(this.state); this.render(); }, disabled: this.state.timeSlot === "morning" || this.state.timeSlot === "afternoon" },
        ]
      : [
        { label: "攻撃", key: SHORTCUTS.attack, action: () => this.executeDungeonCommand({ type: "attack", direction: this.facingDirection() }), disabled: !this.facingEnemy() },
        { label: "調べる", key: SHORTCUTS.investigate, action: () => { this.interactDungeon(); this.render(); } },
        { label: "押し返し", key: SHORTCUTS.shove, action: () => this.executeDungeonCommand({ type: "shove", direction: this.facingDirection() }), disabled: !this.facingEnemy() || (this.state.run?.shoveCooldown ?? 0) > 0 },
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
    this.add.text(614, 26, `鞄 ${currentItemCount(this.state)}/${INVENTORY_CAPACITY}個　食料${this.state.provisions} 煙玉${this.state.smokeBombs} 帰還石${this.state.returnStones}`, { fontSize: "10px", color: "#cdd8df" }).setOrigin(1, 0);
    addDivider(this, 26, 46, 588);
    const equipmentCount = [this.state.equipment.weaponItemId, this.state.equipment.armorItemId].filter(Boolean).length;
    const tabs: Array<[InventoryTab, string]> = [
      ["bag", `鞄 ${this.state.inventory.length}`],
      ["equipment", `装備 ${equipmentCount}`],
      ["storage", `保管庫 ${this.state.store.length}`],
      ["display", `店頭 ${this.state.display.length}/4`],
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
      const protectedItem = view.tab === "bag" && isQuestItemProtected(this.state, item);
      const rowLeft = batchEnabled ? left + 18 : left;
      const row = this.add.rectangle(rowLeft, top, batchEnabled ? 126 : 144, 17, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true });
      if (batchEnabled) {
        const checked = view.checkedIds.has(item.uuid);
        const checkbox = this.add.text(left + 3, top + 1, protectedItem ? "◆" : checked ? "☑" : "☐", { fontSize: "11px", color: protectedItem ? UI_INK.dim : checked ? UI_INK.accent : UI_INK.body });
        if (!protectedItem) checkbox.setInteractive({ useHandCursor: true }).on("pointerdown", () => {
          if (!this.inventoryView) return;
          if (this.inventoryView.checkedIds.has(item.uuid)) this.inventoryView.checkedIds.delete(item.uuid); else this.inventoryView.checkedIds.add(item.uuid);
          this.inventoryView.selectedId = item.uuid;
          this.render();
        });
      }
      this.drawRarityPip(left + (batchEnabled ? 26 : 8), top + 8, definition?.rarity);
      this.add.text(left + (batchEnabled ? 36 : 18), top + 2, `${protectedItem && !batchEnabled ? "◆" : ""}${itemName(item)}${view.tab === "storage" && this.state.display.includes(item.uuid) ? " ★" : ""}`, { fontSize: "10px", color: chosen ? UI_INK.onSelection : rarityInk(definition?.rarity) });
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
      this.add.text(346, 178, definition?.description ?? "", { fontSize: "10px", color: UI_INK.body, lineSpacing: 4, wordWrap: { width: 258 } });
      this.renderInventoryActions(selected, 346, 246);
    } else if (view.tab === "equipment") {
      this.add.text(348, 98, `武器: ${this.equippedName("weapon")}\n防具: ${this.equippedName("armor")}\n\n攻撃 ${playerAttackPower(this.state)}　防御 ${playerDefensePower(this.state)}`, { fontSize: "11px", color: UI_INK.body, lineSpacing: 7 });
    }
    if (this.state.location === "home" && view.tab !== "equipment") this.renderInventoryBatchToolbar(items);
    else this.add.text(26, 328, `${SHORTCUTS.inventory} / Esc で閉じる。どのアイテムも1個で1枠。`, { fontSize: "10px", color: UI_INK.dim });
  }

  private renderInventoryBatchToolbar(items: ItemInstance[]): void {
    const view = this.inventoryView;
    if (!view) return;
    const selectable = items.filter((item) => view.tab !== "bag" || !isQuestItemProtected(this.state, item));
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
    if (view.tab === "bag") {
      const displaySlots = Math.max(0, 4 - this.state.display.length);
      this.addActionButton(160, 327, 122, 18, "保管庫へ", "", () => { moveInventoryItems(this.state, ids, "storage"); finish(); }, selected.length === 0);
      this.addActionButton(286, 327, 122, 18, `店頭へ（空${displaySlots}）`, "", () => { moveInventoryItems(this.state, ids, "display"); finish(); }, selected.length === 0 || selected.length > displaySlots);
    } else if (view.tab === "storage") {
      const newDisplayItems = selected.filter((item) => !this.state.display.includes(item.uuid));
      const displaySlots = Math.max(0, 4 - this.state.display.length);
      const bagSlots = INVENTORY_CAPACITY - currentItemCount(this.state);
      this.addActionButton(160, 327, 122, 18, `鞄へ（空${bagSlots}）`, "", () => { moveStoreItemsToInventory(this.state, ids); finish(); }, selected.length === 0 || selected.length > bagSlots);
      this.addActionButton(286, 327, 122, 18, `店頭へ（空${displaySlots}）`, "", () => { setDisplayedItems(this.state, [...this.state.display, ...ids]); finish(); }, newDisplayItems.length === 0 || newDisplayItems.length > displaySlots);
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
    const ids = [this.state.equipment.weaponItemId, this.state.equipment.armorItemId].filter((id): id is string => Boolean(id));
    return ids.map((id) => this.state.itemsById[id] ?? this.state.inventory.find((item) => item.uuid === id)).filter((item): item is ItemInstance => Boolean(item));
  }

  private equippedName(slot: "weapon" | "armor"): string {
    const id = slot === "weapon" ? this.state.equipment.weaponItemId : this.state.equipment.armorItemId;
    const item = id ? this.state.inventory.find((entry) => entry.uuid === id) : undefined;
    return item ? itemName(item) : "なし";
  }

  private renderInventoryActions(item: ItemInstance, x: number, y: number): void {
    const tab = this.inventoryView?.tab;
    const definition = itemDefinition(item);
    const button = (label: string, action: () => void, disabled = false, row = 0) => this.addActionButton(x, y + row * 26, 258, 22, label, "", action, disabled);
    if (tab === "bag") {
      const equipSlot = definition?.category === "weapon" ? "weapon" : definition?.category === "armor" ? "armor" : undefined;
      const medicine = (definition?.healing ?? 0) > 0;
      button(medicine ? "自分に使う" : equipSlot ? "装備する" : "装備できない", () => {
        if (medicine) this.executeDungeonCommand({ type: "useMedicine", itemId: item.uuid, target: "player" });
        else { equipItem(this.state, item.uuid); this.render(); }
      }, medicine ? this.state.location !== "dungeon" || this.state.hp >= this.state.maxHp : !equipSlot, 0);
      if (medicine && this.state.location === "dungeon") button("護衛に使う", () => this.executeDungeonCommand({ type: "useMedicine", itemId: item.uuid, target: "guard" }), !this.state.run?.guard || this.state.run.guard.hp >= this.state.run.guard.maxHp, 1);
      button(this.state.location === "home" ? "保管庫へ移す" : "足元に置く", () => {
        if (this.state.location === "home") moveToStore(this.state, item); else dropItem(this.state, item.uuid);
        if (this.inventoryView) this.inventoryView.selectedId = this.inventoryItems("bag")[0]?.uuid;
        this.render();
      }, isQuestItemProtected(this.state, item), medicine && this.state.location === "dungeon" ? 2 : 1);
    } else if (tab === "equipment") {
      const slot = this.state.equipment.weaponItemId === item.uuid ? "weapon" : "armor";
      button("装備を外す", () => { unequipItem(this.state, slot); if (this.inventoryView) this.inventoryView.selectedId = this.inventoryItems("equipment")[0]?.uuid; this.render(); });
    } else if (tab === "storage") {
      button(this.state.display.includes(item.uuid) ? "店頭から下げる" : "店頭商品にする", () => { toggleDisplay(this.state, item); this.render(); });
      button("鞄へ戻す", () => { this.retrieveItemToInventory(item); this.render(); }, currentItemCount(this.state) >= INVENTORY_CAPACITY, 1);
    } else if (tab === "display") button("店頭から下げる", () => { toggleDisplay(this.state, item); if (this.inventoryView) this.inventoryView.selectedId = this.inventoryItems("display")[0]?.uuid; this.render(); });
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
    modal.body.forEach((line, index) => this.add.text(56, 64 + index * 18, line, { fontSize: "11px", color: UI_INK.body, lineSpacing: 2, wordWrap: { width: 528 } }));
    const choiceStart = Math.max(140, 74 + modal.body.length * 18 + 8);
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
        if (this.modal && !choice.disabled) choice.action();
      });
    });
    addDivider(this, 56, 314, 528, false);
    this.add.text(56, 320, "↑↓ / マウス 選択　Enter / クリック 決定　Esc 戻る", { fontSize: "10px", color: UI_INK.dim });
  }
}
