/**
 * 本番アート差し替え用の唯一の参照先。
 * 実装中は同じ textureKey をコード生成テクスチャに割り当て、納品時は path の PNG
 * スプライトシートを Phaser の load.spritesheet で読み込む。
 */
export const ASSET_MANIFEST = {
  player: {
    textureKey: "actor.player",
    path: "assets/actors/player.png",
    frameWidth: 24,
    frameHeight: 24,
    animations: { idle: [0], walkDown: [0, 1, 2, 3], walkLeft: [4, 5, 6, 7], walkRight: [8, 9, 10, 11], walkUp: [12, 13, 14, 15] },
  },
  enemy: { textureKey: "actor.enemy", path: "assets/actors/enemy.png", frameWidth: 24, frameHeight: 24 },
  npc: { textureKey: "actor.npc", path: "assets/actors/npc.png", frameWidth: 24, frameHeight: 24 },
  item: { textureKey: "object.item", path: "assets/objects/items.png", frameWidth: 24, frameHeight: 24 },
  dungeonTiles: { textureKey: "tile.dungeon", path: "assets/tiles/dungeon_terrain.png", frameWidth: 24, frameHeight: 24 },
  dungeonWalls: { textureKey: "tile.dungeon-wall", path: "assets/tiles/dungeon_walls.png", frameWidth: 24, frameHeight: 24 },
  townTiles: { textureKey: "tile.town", path: "assets/tiles/town_terrain.png", frameWidth: 24, frameHeight: 24 },
  townBuildings: { textureKey: "tile.town-building", path: "assets/tiles/town_buildings.png", frameWidth: 24, frameHeight: 24 },
  townBuildingExtensions: { textureKey: "tile.town-building-wide", path: "assets/tiles/town_building_extensions.png", frameWidth: 24, frameHeight: 24 },
  townObjects: { textureKey: "tile.town-object", path: "assets/tiles/town_objects.png", frameWidth: 24, frameHeight: 24 },
} as const;
