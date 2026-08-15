import { CRAFTPIX_ACTORS, CRAFTPIX_PLAYER_ACTOR, CRAFTPIX_ENEMY_ACTORS, CRAFTPIX_NPC_ACTORS } from "./craftpixActors";
import { CRAFTPIX_UI } from "./craftpixUi";
import { CRAFTPIX_ENVIRONMENT_SHEETS } from "./craftpixEnvironment";

/**
 * 本番アート差し替え用の唯一の参照先。
 * 実装中は同じ textureKey をコード生成テクスチャに割り当て、納品時は path の PNG
 * スプライトシートを Phaser の load.spritesheet で読み込む。
 */
export const ASSET_MANIFEST = {
  player: {
    textureKey: "actor.player",
    path: "assets/actors/player.png",
    frameWidth: 32,
    frameHeight: 32,
    animations: { idle: [0], walkDown: [0, 1, 2, 3], walkLeft: [4, 5, 6, 7], walkRight: [8, 9, 10, 11], walkUp: [12, 13, 14, 15] },
  },
  enemy: { textureKey: "actor.enemy", path: "assets/actors/enemy.png", frameWidth: 32, frameHeight: 32 },
  npc: { textureKey: "actor.npc", path: "assets/actors/npc.png", frameWidth: 32, frameHeight: 32 },
  item: { textureKey: "object.item", path: "assets/objects/items.png", frameWidth: 24, frameHeight: 24 },
  dungeonTiles: { textureKey: "tile.dungeon", path: "assets/tiles/dungeon_terrain.png", frameWidth: 24, frameHeight: 24 },
  dungeonWalls: { textureKey: "tile.dungeon-wall", path: "assets/tiles/dungeon_walls.png", frameWidth: 24, frameHeight: 24 },
  craftpixDungeon: {
    tileSize: 16,
    baseTextureKey: "dungeon.craftpix.base",
    basePath: "assets/dungeons/craftpix-showcase-base.png",
    foregroundTextureKey: "dungeon.craftpix.foreground",
    foregroundPath: "assets/dungeons/craftpix-showcase-foreground.png",
    wallsFloorTextureKey: "dungeon.craftpix.walls-floor",
    wallsFloorPath: "assets/dungeons/craftpix/walls_floor.png",
    doorsTextureKey: "dungeon.craftpix.doors",
    doorsPath: "assets/dungeons/craftpix/doors_lever_chest_animation.png",
    objectsTextureKey: "dungeon.craftpix.objects",
    objectsPath: "assets/dungeons/craftpix/Objects.png",
    cracksTextureKey: "dungeon.craftpix.cracks",
    cracksPath: "assets/dungeons/craftpix/decorative_cracks_floor.png",
  },
  /**
   * 町の地面は1枚絵。Phaser が読み込み時に 24px セルへ切り出し、
   * `TOWN_TILE_INDICES` の恒等インデックスでタイルマップとして並べ直す。
   */
  townMap: { textureKey: "tile.town-map", path: "assets/tiles/town_map.png", frameWidth: 24, frameHeight: 24 },
} as const;

/** New source-pack assets are kept beside the legacy manifest until every
 * scene has migrated.  This makes the transition reversible and lets the
 * editor/game share one canonical actor and UI catalog. */
export const CRAFTPIX_RUNTIME_ASSETS = {
  actors: CRAFTPIX_ACTORS,
  player: CRAFTPIX_PLAYER_ACTOR,
  npcs: CRAFTPIX_NPC_ACTORS,
  enemies: CRAFTPIX_ENEMY_ACTORS,
  ui: CRAFTPIX_UI,
  environmentSheets: CRAFTPIX_ENVIRONMENT_SHEETS,
} as const;

/** Every NPC source uses the same 4 columns × 4 rows walking-sheet contract. */
export const NPC_ASSET_VARIANTS = [
  { textureKey: "actor.npc.innkeeper", path: "assets/actors/npc-innkeeper.png" },
  { textureKey: "actor.npc.scout", path: "assets/actors/npc-scout.png" },
  { textureKey: "actor.npc.scholar", path: "assets/actors/npc-scholar.png" },
  { textureKey: "actor.npc.mage", path: "assets/actors/npc-mage.png" },
  { textureKey: "actor.npc.trader", path: "assets/actors/npc-trader.png" },
] as const;

/** Named guards share the 4 columns × 4 rows directional walking contract. */
export const GUARD_ASSET_VARIANTS = [
  { textureKey: "actor.guard.rolf", path: "assets/actors/guard-rolf.png" },
  { textureKey: "actor.guard.mina", path: "assets/actors/guard-mina.png" },
] as const;

/** Enemy ids resolve to one of these four-direction walking sheets. */
export const ENEMY_ASSET_VARIANTS = [
  { textureKey: "actor.enemy.goblin", path: "assets/actors/enemy-goblin.png" },
  { textureKey: "actor.enemy.bat", path: "assets/actors/enemy-bat.png" },
  { textureKey: "actor.enemy.golem", path: "assets/actors/enemy-golem.png" },
  { textureKey: "actor.enemy.necromancer", path: "assets/actors/enemy-necromancer.png" },
  { textureKey: "actor.enemy.lizard", path: "assets/actors/enemy-lizard.png" },
  { textureKey: "actor.enemy.ghost", path: "assets/actors/enemy-ghost.png" },
] as const;

export const ACTOR_WALK_FRAMES = {
  idle: [0],
  idleDown: [0],
  idleLeft: [4],
  idleRight: [8],
  idleUp: [12],
  walkDown: [0, 1, 2, 3],
  walkLeft: [4, 5, 6, 7],
  walkRight: [8, 9, 10, 11],
  walkUp: [12, 13, 14, 15],
} as const;

/** dungeon_objects.png の現在使用中の先頭8フレーム。 */
export const DUNGEON_OBJECT_FRAMES = {
  chest: 0,
  stairs: 1,
  returnStairs: 2,
  torch: 3,
  rubble: 4,
  bones: 5,
  trap: 6,
  wall: 7,
} as const;
