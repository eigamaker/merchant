import Phaser from "phaser";
import {
  ACTOR_WALK_FRAMES,
  ASSET_MANIFEST,
  ENEMY_ASSET_VARIANTS,
  NPC_ASSET_VARIANTS,
  GUARD_ASSET_VARIANTS,
  DUNGEON_OBJECT_FRAMES,
} from "../game/assets";
import { CRAFTPIX_ACTORS, CRAFTPIX_ENEMY_ACTORS, CRAFTPIX_PLAYER_ACTOR, actorFrame, type ActorAction, type ActorDirection, type CraftpixActorDefinition } from "../game/craftpixActors";
import { CRAFTPIX_UI } from "../game/craftpixUi";
import {
  DIRECTION,
  INVENTORY_CAPACITY,
  acceptQuest,
  activeQuestSummary,
  appraiseItem,
  beginExpedition,
  cancelGuard,
  createNewGame,
  currentBulk,
  dropItem,
  guardDefinition,
  guardFee,
  hireGuard,
  initialOffer,
  inspectBody,
  isQuestItemProtected,
  itemBulk,
  itemName,
  lootBodyItem,
  movePlayer,
  moveToStore,
  performDungeonCommand,
  questProgressText,
  reportQuest,
  resolveRing,
  scoutRevealsTrap,
  sellItem,
  toggleDisplay,
  tryOpenChest,
  tryPickup,
  tryStairs,
  useSmokeBomb,
} from "../game/engine";
import { SaveRepository, type SaveSlot } from "../game/save";
import { HOME_POI, HOME_SPAWN, createHomeMap } from "../game/homeMap";
import { isMapPositionWalkable, moveMapPosition } from "../game/mapTiles";
import { compileMap, loadTrialMap, loadTrialMapPack } from "../game/mapDocument";
import { MAP_ASSET_CATALOG } from "../game/mapAssetCatalog.generated";
import { MISSING_MAP_ASSET_TEXTURE, resolveMapAssetFrame } from "../game/mapAssetRuntime";
import type { Customer, DungeonCommand, DungeonEvent, GameState, ItemInstance, MenuChoice, Vec } from "../game/types";
/** Viewport and generated fallback textures stay at the game's base pixel grid. */
const VIEWPORT_BASE_TILE = 16;
const PLACEHOLDER_TILE = 16;
const DUNGEON_LEGACY_TILE = 16;
const LEGACY_ACTOR_SCALE = 0.9;
const LEGACY_ACTOR_ORIGIN_Y = 0.94;
const GRID_W = 21;
const GRID_H = 12;
const MAP_W = GRID_W * VIEWPORT_BASE_TILE;
const MAP_H = GRID_H * VIEWPORT_BASE_TILE;

type HomePoint = { id: string; name: string; kind: "entrance" | "shop" | "guild" | "visitors" | "customer"; pos: { x: number; y: number }; customerId?: string };
const HOME_POINTS: HomePoint[] = [
  { id: "entrance", name: "ダンジョン入口", kind: "entrance", pos: { x: 16, y: 2 } },
  { id: "shop", name: "保管・陳列", kind: "shop", pos: HOME_POI.storage },
  { id: "guild", name: "依頼・探索準備", kind: "guild", pos: HOME_POI.preparation },
  { id: "visitors", name: "来客", kind: "visitors", pos: HOME_POI.visitors },
];
const PANEL_X = MAP_W + 8;

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
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private readonly saves = new SaveRepository();
  private gameStarted = false;
  private lastAutoSaveAt = Number.NEGATIVE_INFINITY;
  private homeWorld?: Phaser.GameObjects.Container;
  private homeBackdrop?: Phaser.Tilemaps.TilemapLayer;
  private homePlayer?: Phaser.GameObjects.Sprite;
  private homeNpcs: RoamingNpc[] = [];
  private dungeonWalkAnimations = new Map<string, "up" | "down" | "left" | "right">();
  private playerFacing: "up" | "down" | "left" | "right" = "down";
  private dungeonWorld?: Phaser.GameObjects.Container;
  private dungeonMaskShape?: Phaser.GameObjects.Graphics;

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
    for (const actor of Object.values(CRAFTPIX_ACTORS)) {
      for (const [action, clip] of Object.entries(actor.clips)) {
        if (!clip) continue;
        this.load.spritesheet(`craftpix.actor.${actor.id}.${action}`, clip.path, { frameWidth: clip.frameWidth, frameHeight: clip.frameHeight });
      }
    }
    this.load.spritesheet(ASSET_MANIFEST.item.textureKey, ASSET_MANIFEST.item.path, {
      frameWidth: ASSET_MANIFEST.item.frameWidth,
      frameHeight: ASSET_MANIFEST.item.frameHeight,
    });
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
      space: Phaser.Input.Keyboard.KeyCodes.SPACE,
      escape: Phaser.Input.Keyboard.KeyCodes.ESC,
      i: Phaser.Input.Keyboard.KeyCodes.I,
      l: Phaser.Input.Keyboard.KeyCodes.L,
      q: Phaser.Input.Keyboard.KeyCodes.Q,
      r: Phaser.Input.Keyboard.KeyCodes.R,
      h: Phaser.Input.Keyboard.KeyCodes.H,
      z: Phaser.Input.Keyboard.KeyCodes.Z,
      f1: Phaser.Input.Keyboard.KeyCodes.F1,
      f2: Phaser.Input.Keyboard.KeyCodes.F2,
      f3: Phaser.Input.Keyboard.KeyCodes.F3,
    }) as Record<string, Phaser.Input.Keyboard.Key>;
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
        this.state.run = { seed: Date.now(), floor: trial.floor, map, player: { x: entrance?.x ?? map.stairsUp.x, y: entrance?.y ?? map.stairsUp.y }, enemies: [], items: [], chests: [], traps: [], bodies: [], shoveCooldown: 0, highestFloor: trial.floor, turn: 0, floorStates: {} };
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
    if (this.gameStarted && this.just("escape")) {
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
    for (const actor of Object.values(CRAFTPIX_ACTORS)) {
      for (const [actionName, clip] of Object.entries(actor.clips) as [ActorAction, NonNullable<CraftpixActorDefinition["clips"][ActorAction]>][]) {
        if (!clip || !this.textures.exists(`craftpix.actor.${actor.id}.${actionName}`)) continue;
        for (const direction of clip.directions) {
          const key = this.craftpixAnimationKey(actor.id, actionName, direction);
          if (this.anims.exists(key)) continue;
          const frames = Array.from({ length: clip.columns }, (_, index) => ({
            key: `craftpix.actor.${actor.id}.${actionName}`,
            frame: actorFrame(clip, direction, index),
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
    const interact = this.just("enter") || this.just("space");
    const inventory = this.just("i");
    const ledger = this.just("l");
    const quest = this.just("q");
    const help = this.just("h");
    if (interact) this.interactHome();
    if (inventory) this.openInventory();
    if (ledger) this.openLedger();
    if (quest) this.openQuestBoard();
    if (help) this.openHelp();
    if (this.just("f1")) void this.saveManual("manual-1");
    if (this.just("f2")) void this.saveManual("manual-2");
    if (this.just("f3")) void this.saveManual("manual-3");
    if (moved) {
      this.playHomePlayerMotion(horizontal, vertical);
      this.updateHomePresentation();
      this.saveAuto();
    } else if (this.homePlayer) {
      if (!this.playCraftpixActor(this.homePlayer, CRAFTPIX_PLAYER_ACTOR, "idle", this.playerFacing, true, this.homeScale())) this.homePlayer.play(`player.idle-${this.playerFacing}`, true);
    }
    this.updateHomeNpcs(delta);
    if (interact || inventory || ledger || quest || help) this.render();
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
    if (this.just("enter")) { this.interactDungeon(); acted = true; }
    if (this.just("space")) { this.openDungeonActionMenu(); acted = true; }
    if (this.just("r")) {
      events.push(...performDungeonCommand(this.state, { type: "return" }).events);
      acted = true;
    }
    if (this.just("z")) { events.push(...useSmokeBomb(this.state).events); acted = true; }
    if (this.just("i")) this.openInventory();
    if (this.just("l")) this.openLedger();
    if (this.just("h")) this.openHelp();
    if (acted) this.captureDungeonWalkAnimations(beforePlayer, beforeEnemies, beforeGuard);
    if (acted || this.just("i") || this.just("l") || this.just("h")) {
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

  private interactHome(): void {
    const interactionDistance = 30 * this.homeScale();
    const poi = this.homePoints().find((entry) => distanceSquared(this.poiPosition(entry), this.state.homePos) <= interactionDistance * interactionDistance);
    if (!poi) {
      this.state.message = "近くに話せる相手や施設はない。";
      return;
    }
    switch (poi.kind) {
      case "entrance":
        beginExpedition(this.state);
        return;
      case "shop":
        this.openStore();
        return;
      case "guild":
        this.openGuildMenu();
        return;
      case "visitors":
        this.openMenu("来客待機場所", ["家に来た客へ品物を見せたり、話を聞いたりできます。"], [{ label: "閉じる", action: () => this.closeMenu() }]);
        return;
      case "customer":
        if (poi.customerId) this.openCustomer(poi.customerId);
        return;
    }
  }

  private interactDungeon(): void {
    const run = this.state.run;
    if (!run) return;
    const ground = run.items.find((entry) => same(entry.pos, run.player));
    if (ground) {
      if (currentBulk(this.state) + itemBulk(ground.item) <= INVENTORY_CAPACITY) tryPickup(this.state);
      else this.openSwapMenu(ground.item, (swapOutId) => { tryPickup(this.state, swapOutId); this.closeMenu(); });
      return;
    }
    const chest = run.chests.find((entry) => same(entry.pos, run.player));
    if (chest) {
      if (currentBulk(this.state) + itemBulk(chest.item) <= INVENTORY_CAPACITY) tryOpenChest(this.state, chest.id);
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
        { label: "戻る", action: () => this.openDungeonActionMenu() },
      ]);
      return;
    }
    const definition = guardDefinition(active.guardId);
    this.openMenu("護衛状態", [
      `${definition?.name ?? active.guardId} — ${definition?.title ?? "護衛"}`,
      `HP ${active.hp}/${active.maxHp}　攻撃 ${active.damage}`,
      definition?.description ?? "主人公を自動で守る。",
    ], [{ label: "戻る", action: () => this.openDungeonActionMenu() }]);
  }

  private openBodyMenu(bodyId: string): void {
    const body = this.state.run?.bodies.find((entry) => entry.id === bodyId);
    if (!body) return;
    const lines = body.id === "aron"
      ? ["認識票には『アロン』と刻まれている。", body.loot.length > 0 ? "残された遺品を選んで回収する。" : "回収できる遺品は残っていない。"]
      : ["身元不明の古い遺体だ。", "持ち帰れる物は残っていない。"];
    this.openMenu(body.name, lines, [
      ...body.loot.map((item) => ({
        label: `回収: ${itemName(item)} [${itemBulk(item)}]`,
        action: () => {
          if (currentBulk(this.state) + itemBulk(item) <= INVENTORY_CAPACITY) {
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
    const required = currentBulk(this.state) + itemBulk(incoming) - INVENTORY_CAPACITY;
    this.openMenu("持ち物を入れ替える", [
      `${itemName(incoming)} [${itemBulk(incoming)}]を持つには、容量を${required}以上空ける必要がある。`,
      "置いた品は足元に残る。",
    ], [
      ...this.state.inventory.map((item) => ({
        label: `置く: ${itemName(item)} [${itemBulk(item)}]`,
        disabled: itemBulk(item) < required,
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
  }

  private closeMenu(): void {
    this.modal = undefined;
    this.render();
  }

  private async openTitle(): Promise<void> {
    const available = await this.saves.availableSlots();
    const choices: MenuChoice[] = [
      { label: "新しい商人として始める", action: () => { this.state = createNewGame(); this.gameStarted = true; this.closeMenu(); } },
      ...(["autosave", "manual-1", "manual-2", "manual-3"] as SaveSlot[]).map((slot) => ({
        label: slot === "autosave" ? "自動保存を再開" : `手動保存 ${slot.at(-1)} を読み込む`,
        disabled: !available.includes(slot),
        action: () => { void this.loadSlot(slot); },
      })),
    ];
    this.openMenu("Dungeon Curio Merchant", ["命懸けで珍品を持ち帰り、価値を見抜く商人RPG。", "自動保存1枠・手動保存3枠。"], choices);
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
      `所持金 ${this.state.gold}G　容量 ${currentBulk(this.state)}/${INVENTORY_CAPACITY}`,
    ], [
      { label: "持ち物", action: () => this.openInventory() },
      { label: "依頼", action: () => this.openQuestBoard() },
      { label: "商人の記録", action: () => this.openLedger() },
      { label: "操作", action: () => this.openHelp() },
      { label: "手動保存 1", action: () => { void this.saveManual("manual-1"); } },
      { label: "手動保存 2", action: () => { void this.saveManual("manual-2"); } },
      { label: "手動保存 3", action: () => { void this.saveManual("manual-3"); } },
      { label: "ゲームへ戻る", action: () => this.closeMenu() },
    ]);
  }

  private openHelp(): void {
    const controls = this.state.location === "home"
      ? ["移動: 矢印 / WASD", "決定・会話: Enter / Space", "Esc: メニュー", "I: 持ち物  L: 商人の記録", "Q: 依頼  F1〜F3: 手動保存"]
      : ["移動・向き変更: 矢印 / WASD", "Enter: 足元を調べる", "Space: 行動（押し返す・道具・待機）", "Z: 煙玉  R: 帰還石", "Esc: メニュー  I: 持ち物"];
    this.openMenu("操作", controls, [{ label: "閉じる", action: () => this.closeMenu() }]);
  }

  private openInventory(): void {
    const items = this.state.inventory;
    if (items.length === 0) {
      this.openMenu("持ち物", ["持ち物は空だ。", `容量 ${currentBulk(this.state)} / ${INVENTORY_CAPACITY}`], [{ label: "閉じる", action: () => this.closeMenu() }]);
      return;
    }
    this.openMenu("持ち物", [`容量 ${currentBulk(this.state)} / ${INVENTORY_CAPACITY}`, "品を選ぶと詳細を確認できる。"], [
      ...items.map((item) => ({ label: `${isQuestItemProtected(this.state, item) ? "◆" : ""}${itemName(item)} [${itemBulk(item)}]`, action: () => this.openItemMenu(item) })),
      { label: "閉じる", action: () => this.closeMenu() },
    ]);
  }

  private openItemMenu(item: ItemInstance): void {
    const definition = item.definitionId;
    const lines = [
      itemName(item),
      `知識: ${item.knowledge === "unknown" ? "未鑑定" : item.knowledge === "suspected" ? "推測" : "判明"}`,
      `容量: ${itemBulk(item)}  ${definition}`,
    ];
    const choices: MenuChoice[] = [];
    if (this.state.location === "home") {
      choices.push({ label: "店へ保管する", disabled: isQuestItemProtected(this.state, item), action: () => { moveToStore(this.state, item); this.openStore(); } });
      choices.push({ label: "買い手を探す", disabled: isQuestItemProtected(this.state, item), action: () => this.openCustomerList(item) });
    } else {
      choices.push({ label: "足元に置く", action: () => { dropItem(this.state, item.uuid); this.openInventory(); } });
    }
    choices.push({ label: "戻る", action: () => this.openInventory() });
    this.openMenu("品物の詳細", lines, choices);
  }

  private openStore(): void {
    const lines = [`保管品 ${this.state.store.length}点 / 展示 ${this.state.display.length}点`, "展示品は特別な来客を呼ぶことがある。"];
    const choices: MenuChoice[] = [
      ...this.state.inventory.map((item) => ({ label: `保管する: ${itemName(item)}`, disabled: isQuestItemProtected(this.state, item), action: () => { moveToStore(this.state, item); this.openStore(); } })),
      ...this.state.store.map((item) => ({ label: `保管品: ${itemName(item)}${this.state.display.includes(item.uuid) ? " ★展示中" : ""}`, action: () => this.openStoredItem(item) })),
      { label: "閉じる", action: () => this.closeMenu() },
    ];
    this.openMenu("珍品店", lines, choices);
  }

  private openStoredItem(item: ItemInstance): void {
    const showing = this.state.display.includes(item.uuid);
    this.openMenu(itemName(item), ["店の保管庫にある一点物。", `現在: ${showing ? "展示中" : "保管中"}`], [
      { label: showing ? "展示をやめる" : "展示する", action: () => { toggleDisplay(this.state, item); this.openStore(); } },
      { label: "買い手を探す", action: () => this.openCustomerList(item) },
      { label: "持ち物へ戻す", action: () => this.retrieveItem(item) },
      { label: "戻る", action: () => this.openStore() },
    ]);
  }

  private retrieveItem(item: ItemInstance): void {
    if (currentBulk(this.state) + itemBulk(item) > INVENTORY_CAPACITY) {
      this.openMenu("持ち物がいっぱい", ["持ち物の容量を空けてから取り出そう。"], [{ label: "戻る", action: () => this.openStoredItem(item) }]);
      return;
    }
    this.state.store = this.state.store.filter((entry) => entry.uuid !== item.uuid);
    this.state.display = this.state.display.filter((uuid) => uuid !== item.uuid);
    item.owner = "player";
    this.state.inventory.push(item);
    this.state.message = `${itemName(item)}を持ち物へ戻した。`;
    this.openStore();
  }

  private openCustomerList(item?: ItemInstance): void {
    this.openMenu("誰に見せる？", [item ? `${itemName(item)}を見せる相手を選ぶ。` : "相手を選ぶ。"], [
      ...this.state.customers.map((customer) => ({ label: `${customer.name}（${customer.title}）`, action: () => item ? this.openOffer(item, customer) : this.openCustomer(customer.id) })),
      { label: "戻る", action: () => item ? (this.state.store.includes(item) ? this.openStoredItem(item) : this.openItemMenu(item)) : this.closeMenu() },
    ]);
  }

  private openCustomer(customerId: string): void {
    const customer = this.state.customers.find((entry) => entry.id === customerId);
    if (!customer) return;
    const items = [...this.state.inventory, ...this.state.store];
    const choices: MenuChoice[] = [
      ...items.map((item) => ({ label: `品を見せる: ${itemName(item)}`, action: () => this.openOffer(item, customer) })),
    ];
    const ring = items.find((item) => item.definitionId === "old-ring");
    if (ring && ["scholar", "jeweler", "duke"].includes(customer.id)) {
      const consulted = this.state.story.early.ringConsulted.includes(customer.id);
      choices.unshift({
        label: `${consulted ? "✓ " : ""}古びた指輪について相談する`,
        action: () => this.finishAppraisal(ring, customer),
      });
    }
    if (customer.id === "scholar" && this.state.story.blackSword === "tomb") {
      choices.unshift({ label: "墓所の碑文を照合する", action: () => this.resolveBlackSword(customer) });
    }
    choices.push({ label: "閉じる", action: () => this.closeMenu() });
    this.openMenu(`${customer.name} — ${customer.title}`, [
      `関係: ${customer.relation >= 0 ? "+" : ""}${customer.relation}`,
      `興味: ${customer.interests.join(" / ")}`,
      items.length > 0 ? "品を選んで、鑑定または売却できる。" : "売れる品を持っていない。",
    ], choices);
  }

  private resolveBlackSword(customer: Customer): void {
    const sword = this.state.archive.find((item) => item.definitionId === "black-sword");
    if (!sword) return;
    const result = appraiseItem(this.state, sword, customer);
    this.openMenu("碑文の照合", [result, "商品帳簿の表示名が更新された。"], [{ label: "閉じる", action: () => this.closeMenu() }]);
  }

  private openOffer(item: ItemInstance, customer: Customer): void {
    if (isQuestItemProtected(this.state, item)) {
      this.openMenu(`${itemName(item)}を見せる`, ["依頼に関わる品のため、通常売却はできない。"], [
        { label: "鑑定・相談する", action: () => this.finishAppraisal(item, customer) },
        { label: "やめる", action: () => this.openCustomer(customer.id) },
      ]);
      return;
    }
    const offer = initialOffer(this.state, item, customer);
    const explain = `${customer.name}の提示額: ${offer}G`;
    this.openMenu(`${itemName(item)}の取引`, [explain, "反提案は一度だけ。高すぎれば関係が悪化する。"], [
      { label: `${offer}Gで売る`, action: () => this.finishSale(item, customer, 1) },
      { label: `${Math.floor(offer * 1.1)}Gを提案`, action: () => this.finishSale(item, customer, 1.1) },
      { label: `${Math.floor(offer * 1.25)}Gを提案`, action: () => this.finishSale(item, customer, 1.25) },
      { label: `${Math.floor(offer * 1.5)}Gを提案`, action: () => this.finishSale(item, customer, 1.5) },
      { label: "鑑定だけして戻る", action: () => this.finishAppraisal(item, customer) },
      { label: "やめる", action: () => this.openCustomer(customer.id) },
    ]);
  }

  private finishAppraisal(item: ItemInstance, customer: Customer): void {
    const result = appraiseItem(this.state, item, customer);
    this.openMenu("鑑定結果", [result], [{ label: "戻る", action: () => this.openCustomer(customer.id) }]);
  }

  private finishSale(item: ItemInstance, customer: Customer, multiplier: number): void {
    const result = sellItem(this.state, item, customer.id, multiplier);
    this.openMenu("取引結果", [result, `所持金: ${this.state.gold}G`], [{ label: "閉じる", action: () => this.closeMenu() }]);
  }

  private openGuildMenu(): void {
    this.openMenu("冒険者ギルド", [
      `ギルド評判 ${this.state.guildReputation}`,
      this.state.story.early.guardHiringUnlocked ? "依頼の報告と護衛契約を扱う。" : "まずは序章の依頼を進めよう。",
    ], [
      { label: "地下迷宮へ入る", action: () => { beginExpedition(this.state); this.closeMenu(); } },
      { label: "依頼と報告", action: () => this.openQuestBoard() },
      { label: "護衛を雇う", disabled: !this.state.story.early.guardHiringUnlocked, action: () => this.openGuardRoster() },
      { label: "閉じる", action: () => this.closeMenu() },
    ]);
  }

  private openQuestBoard(): void {
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
          label: `${definition.name} Lv${guard.level} HP${definition.baseMaxHp + guard.level - 1} 攻${definition.damage} — ${injured ? `${guard.injuredUntilDay}日目まで療養` : `${guardFee(this.state, guard.id)}G`}`,
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
    this.dungeonMaskShape?.destroy();
    this.dungeonMaskShape = undefined;
    this.children.removeAll(true);
    // removeAll(true) destroys the backdrop layer; drop the stale handle too.
    this.homeBackdrop = undefined;
    this.homeWorld = undefined;
    this.homePlayer = undefined;
    if (this.state.location === "home") this.renderHome();
    else this.renderDungeon();
    this.renderHud();
    if (this.modal) this.renderModal();
    this.polishText();
    this.saveAuto();
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
      const label = this.add.text(position.x, position.y - 14 * homeScale, poi.name, { fontSize: "10px", color: "#fff2d7", backgroundColor: "#251d25cc", padding: { x: 2, y: 1 } }).setOrigin(0.5);
      world.add(label);
    }
    this.homeWorld = world;
    this.updateHomePresentation(true);
    this.add.text(8, 8, `自宅兼店舗 — ${this.state.day}日目`, { fontSize: "12px", color: "#fff2d7", stroke: "#1b1620", strokeThickness: 1 });
  }

  private renderDungeon(): void {
    const run = this.state.run;
    if (!run) return;
    const world = this.add.container(0, 0);
    this.dungeonWorld = world;
    this.renderDungeonAssets(world);
    this.updateDungeonPresentation();
  }

  private renderDungeonAssets(world: Phaser.GameObjects.Container): void {
    const run = this.state.run;
    if (!run) return;
    const add = <T extends Phaser.GameObjects.GameObject>(object: T): T => { world.add(object); return object; };
    const tile = run.map.tileSize ?? DUNGEON_LEGACY_TILE;
    const center = tile / 2;
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
      const frame = Array.from(entry.item.definitionId).reduce((total, character) => total + character.charCodeAt(0), 0) % 8;
      place(entry.pos.x, entry.pos.y, ASSET_MANIFEST.item.textureKey, frame);
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
      const actorDefinition = this.craftpixEnemyActor(enemy.id);
      const textureKey = actorDefinition ? (this.craftpixActorTexture(actorDefinition) ?? this.enemyTextureKey(enemy.id)) : this.enemyTextureKey(enemy.id);
      const sprite = this.add.sprite(enemy.pos.x * tile + center, enemy.pos.y * tile + tile, textureKey, 0).setName(`actor:${enemy.id}`);
      const direction = this.dungeonWalkAnimations.get(enemy.id) ?? "down";
      if (!actorDefinition || !this.playCraftpixActor(sprite, actorDefinition, "idle", direction)) sprite.setOrigin(0.5, LEGACY_ACTOR_ORIGIN_Y).setScale(LEGACY_ACTOR_SCALE).play(`${textureKey}.idle-${direction}`);
      add(sprite);
    }
    if (run.guard) {
      const definition = guardDefinition(run.guard.guardId);
      const textureKey = definition?.textureKey ?? "actor.npc.scout";
      const direction = this.dungeonWalkAnimations.get(run.guard.guardId) ?? "down";
      const sprite = this.add.sprite(run.guard.pos.x * tile + center, run.guard.pos.y * tile + tile, textureKey, 0).setOrigin(0.5, LEGACY_ACTOR_ORIGIN_Y).setScale(LEGACY_ACTOR_SCALE).setName(`actor:${run.guard.guardId}`);
      sprite.play(`${textureKey}.idle-${direction}`);
      add(sprite);
    }
    const playerTexture = this.craftpixActorTexture(CRAFTPIX_PLAYER_ACTOR) ?? ASSET_MANIFEST.player.textureKey;
    const player = this.add.sprite(run.player.x * tile + center, run.player.y * tile + tile, playerTexture, 0).setName("actor:player");
    if (!this.playCraftpixActor(player, CRAFTPIX_PLAYER_ACTOR, "idle", this.playerFacing)) player.setOrigin(0.5, LEGACY_ACTOR_ORIGIN_Y).setScale(LEGACY_ACTOR_SCALE).play(`player.idle-${this.playerFacing}`);
    add(player);
    this.dungeonMaskShape = this.make.graphics({ x: 0, y: 0 });
    this.dungeonMaskShape.fillStyle(0xffffff).fillRect(0, 0, MAP_W, MAP_H);
    world.setMask(this.dungeonMaskShape.createGeometryMask());
    this.add.text(8, 8, `深層ダンジョン 地下${run.floor}階 / ${run.turn}手 / 押返${run.shoveCooldown === 0 ? "可" : run.shoveCooldown}`, { fontSize: "12px", color: "#fff2d7", stroke: "#1b1620", strokeThickness: 1 });
  }

  private animateDungeonEvents(events: DungeonEvent[]): void {
    const world = this.dungeonWorld;
    if (!world || this.state.location !== "dungeon") return;
    const actor = (id: string): Phaser.GameObjects.Sprite | undefined => world.getByName(`actor:${id}`) as Phaser.GameObjects.Sprite | undefined;
    for (const event of events) {
      if (event.type === "move" || (event.type === "shove" && event.success)) {
        const sprite = actor(event.type === "move" ? event.actorId : event.enemyId);
        if (!sprite) continue;
        const from = event.from;
        const to = event.to;
        const tile = this.state.run?.map.tileSize ?? DUNGEON_LEGACY_TILE;
        const center = tile / 2;
        sprite.setPosition(from.x * tile + center, from.y * tile + tile);
        this.tweens.add({ targets: sprite, x: to.x * tile + center, y: to.y * tile + tile, duration: event.type === "shove" ? 130 : 90, ease: "Quad.Out" });
      } else if (event.type === "shove" && !event.success) {
        const sprite = actor(event.enemyId);
        if (sprite) this.tweens.add({ targets: sprite, x: sprite.x + 2, duration: 45, yoyo: true, repeat: 1 });
      } else if (event.type === "attack") {
        const attacker = actor(event.attackerId);
        const target = actor(event.targetId);
        if (!attacker || !target) continue;
        const attackerDefinition = event.attackerId === "player" ? CRAFTPIX_PLAYER_ACTOR : this.craftpixEnemyActor(event.attackerId);
        const targetDefinition = event.targetId === "player" ? CRAFTPIX_PLAYER_ACTOR : this.craftpixEnemyActor(event.targetId);
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
    const markerPosition = (kind: "homeSpawn" | "dungeonEntrance" | "homeStorage" | "homePreparation" | "homeVisitors", fallback: { x: number; y: number }) => {
      const marker = this.homeMap.markers.find((candidate) => candidate.kind === kind);
      return marker ? { x: marker.x, y: marker.y } : fallback;
    };
    const entrance = markerPosition("dungeonEntrance", { x: 16, y: 2 });
    const homeSpawn = markerPosition("homeSpawn", HOME_SPAWN);
    const storage = markerPosition("homeStorage", HOME_POI.storage);
    const preparation = markerPosition("homePreparation", HOME_POI.preparation);
    const visitors = markerPosition("homeVisitors", HOME_POI.visitors);
    const occupied = [
      homeSpawn,
      storage,
      preparation,
      visitors,
      entrance,
    ];
    const candidates: Array<{ x: number; y: number }> = [];
    for (let y = 1; y < this.homeMap.height - 1; y += 1) for (let x = 1; x < this.homeMap.width - 1; x += 1) candidates.push({ x, y });
    const tile = this.homeMap.tileSize;
    const customers = this.state.customers.map((customer) => {
      const pos = candidates.find((candidate) => !occupied.some((point) => point.x === candidate.x && point.y === candidate.y) && isMapPositionWalkable(this.homeMap, { x: candidate.x * tile + tile / 2, y: candidate.y * tile + tile / 2 }, Math.max(2, tile / 4))) ?? visitors;
      occupied.push(pos);
      return {
      id: `customer-${customer.id}`,
      name: customer.name,
      kind: "customer" as const,
      customerId: customer.id,
      pos,
      };
    });
    const points = HOME_POINTS.map((point) => point.id === "entrance" ? { ...point, pos: entrance } : point.id === "shop" ? { ...point, pos: storage } : point.id === "guild" ? { ...point, pos: preparation } : point.id === "visitors" ? { ...point, pos: visitors } : point);
    return [...points, ...customers];
  }

  private enemyTextureKey(enemyId: string): string {
    if (enemyId.startsWith("bat")) return "actor.enemy.bat";
    if (enemyId.startsWith("crawler")) return "actor.enemy.lizard";
    return "actor.enemy.goblin";
  }

  private craftpixEnemyActor(enemyId: string): CraftpixActorDefinition | undefined {
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
      if (poi.kind === "entrance" || poi.kind === "shop" || poi.kind === "guild" || poi.kind === "visitors") return;
      const center = this.poiPosition(poi);
      const homeScale = this.homeScale();
      const actor = NPC_ASSET_VARIANTS[index % NPC_ASSET_VARIANTS.length]!;
      const sprite = this.add.sprite(center.x, center.y + this.homeMap.tileSize / 2, actor.textureKey, 0).setOrigin(0.5, LEGACY_ACTOR_ORIGIN_Y).setScale(LEGACY_ACTOR_SCALE * homeScale);
      sprite.play(`${actor.textureKey}.idle-down`);
      world.add(sprite);
      const staticResident = poi.kind === "customer" || poi.kind === "entrance";
      this.homeNpcs.push({
        sprite,
        textureKey: actor.textureKey,
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
    this.addUiPanel(PANEL_X + 62, 180, 128, 360, 0x201a2a);
    const hpWidth = Math.max(0, Math.floor((this.state.hp / this.state.maxHp) * 96));
    this.add.text(PANEL_X + 8, 14, "珍品商", { fontSize: "12px", color: "#ffe4a0" });
    this.add.text(PANEL_X + 8, 34, `HP ${this.state.hp}/${this.state.maxHp}`, { fontSize: "10px", color: "#f5ddd6" });
    this.add.rectangle(PANEL_X + 56, 50, 98, 7, 0x4c3741).setOrigin(0.5);
    this.add.rectangle(PANEL_X + 7 + hpWidth / 2, 50, hpWidth, 5, 0xbc5866).setOrigin(0.5);
    this.add.text(PANEL_X + 8, 65, `${this.state.gold}G`, { fontSize: "12px", color: "#f7cf75" });
    this.add.text(PANEL_X + 8, 84, `所持 ${currentBulk(this.state)}/${INVENTORY_CAPACITY}`, { fontSize: "10px", color: "#cdd8df" });
    this.add.text(PANEL_X + 8, 100, `帰還石 ${this.state.returnStones}`, { fontSize: "10px", color: "#b7d8e8" });
    this.add.text(PANEL_X + 8, 114, `煙玉 ${this.state.smokeBombs}`, { fontSize: "10px", color: "#d2b5e8" });
    this.add.text(PANEL_X + 8, 134, "受注中", { fontSize: "10px", color: "#bca7d8" });
    const quests = this.state.quests.filter((quest) => quest.status === "active" || quest.status === "readyToReport").slice(0, 3);
    quests.forEach((quest, index) => this.add.text(PANEL_X + 8, 151 + index * 24, quest.title, { fontSize: "10px", color: "#eee5d1", wordWrap: { width: 110 } }));
    this.add.rectangle(MAP_W / 2, 323, MAP_W, 72, 0x17131e).setStrokeStyle(1, 0x78624b);
    this.add.text(10, 299, this.state.message, { fontSize: "11px", color: "#f6ecd5", lineSpacing: 2, wordWrap: { width: 485, useAdvancedWrap: true } });
    const hint = this.state.location === "home" ? "Enter: 話す  Esc:メニュー  Q:依頼  H:操作" : "Enter: 調べる  Space:行動  Z:煙玉  R:帰還  Esc:メニュー";
    this.add.text(10, 340, hint, { fontSize: "10px", color: "#ad9eb1" });
  }

  private addUiPanel(x: number, y: number, width: number, height: number, fallbackColor: number, alpha = 1): void {
    if (this.textures.exists("ui.craftpix.panel")) {
      // Main_tiles is an atlas. Crop one neutral brown panel tile before
      // stretching it; drawing the entire atlas makes the UI look like a
      // bookshelf instead of a window.
      this.add.image(x, y, "ui.craftpix.panel").setCrop(0, 0, 96, 96).setDisplaySize(width, height).setAlpha(alpha).setOrigin(0.5);
      this.add.rectangle(x, y, width, height, 0x0c0a11, 0.12).setStrokeStyle(2, 0xd4af72);
      return;
    }
    this.add.rectangle(x, y, width, height, fallbackColor, alpha).setStrokeStyle(2, 0xd4af72);
  }

  private renderModal(): void {
    const modal = this.modal;
    if (!modal) return;
    this.addUiPanel(320, 180, 560, 320, 0x0c0a11, 0.92);
    this.add.text(52, 34, modal.title, { fontSize: "16px", color: "#ffe8ab" });
    modal.body.forEach((line, index) => this.add.text(52, 62 + index * 18, line, { fontSize: "11px", color: "#e8e0d1", lineSpacing: 2, wordWrap: { width: 536 } }));
    const choiceStart = Math.max(142, 72 + modal.body.length * 18 + 10);
    const visibleCount = Math.max(1, Math.min(8, Math.floor((318 - choiceStart) / 20)));
    const firstChoice = Phaser.Math.Clamp(modal.index - visibleCount + 1, 0, Math.max(0, modal.choices.length - visibleCount));
    modal.choices.slice(firstChoice, firstChoice + visibleCount).forEach((choice, index) => {
      const choiceIndex = firstChoice + index;
      const selected = choiceIndex === modal.index;
      const color = choice.disabled ? "#71697a" : selected ? "#16121b" : "#e7ddc9";
      const hit = this.add.rectangle(318, choiceStart + index * 20 + 7, 526, 18, selected ? 0xb07a50 : 0x0c0a11, selected ? 1 : 0.001)
        .setInteractive({ useHandCursor: !choice.disabled });
      const choiceText = this.add.text(58, choiceStart + index * 20, `${selected ? "▶" : "　"}${choice.label}`, { fontSize: "11px", color });
      hit.on("pointerover", () => {
        if (this.modal && !choice.disabled) {
          this.modal.index = choiceIndex;
          hit.setFillStyle(0xb07a50, 1);
          choiceText.setColor("#16121b");
        }
      });
      hit.on("pointerout", () => {
        hit.setFillStyle(0x0c0a11, 0.001);
        choiceText.setColor(choice.disabled ? "#71697a" : "#e7ddc9");
      });
      hit.on("pointerdown", () => {
        if (this.modal && !choice.disabled) choice.action();
      });
    });
    this.add.text(52, 326, "↑↓ / マウス 選択　Enter / クリック 決定　Esc 戻る", { fontSize: "10px", color: "#a89cad" });
  }
}
