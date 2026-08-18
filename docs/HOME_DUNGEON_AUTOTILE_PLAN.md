# Home / Dungeon manual map plan

## Scope

- The only authored map kinds are `home` and `dungeon`.
- `home` is the single house/shop/visitor map. The player travels between it and dungeons.
- `dungeon` maps are independent floors. Each floor is a `MapDocument` with `kind: "dungeon"` and a unique `floor` number; the editor lists and edits them separately.
- The former town illustration and town collision are not used by the web game.

## Manual placement contract

The editor intentionally does not calculate neighbouring tiles. A click stores exactly the selected tile and frame at that coordinate. A wall remains the selected wall frame whether it is alone, adjacent, at a corner, or in a line. Curves, joins, and other variants are chosen by the author.

`MapDocument` v6 keeps the compatibility `terrain` array and always contains:

```ts
collision: boolean[]; // true = walkable, false = blocked
layers: {
  ground: (TilePlacement | null)[];
  structure: (TilePlacement | null)[];
  decoration: (TilePlacement | null)[];
};
```

`TilePlacement` is `{ assetId, frame }`. The three arrays are cell-sized and are drawn from bottom to top. `collision` is the movement source of truth; it is not inferred from the image. Old v3/v4/v5 documents remain readable and are migrated to v6 in memory. Legacy `dungeonReturn` and `stairs` markers become `stairsUp` and `stairsDown` respectively. Dungeon v6 documents also carry an `enemyRoster` of actor IDs; home maps must keep it empty.

The initial palette is deliberately small:

- `home.floor` / `home.wall`
- `dungeon.floor` / `dungeon.wall`
- `dungeon.stairs-up` / `dungeon.stairs-down`

Sprite sheets and matching `.tileset.json` definitions under `assets-src/map-tiles/sheets/` can be expanded without changing the map format. New assets declare their allowed map kind, tile size, default layer, and default walkability; the final frame is selected in the editor and saved with the placement.

## Editor workflow

1. Select `家` or `ダンジョン`. There is one home; use `新規` or `複製` to create additional dungeon floors.
2. Select `ground`, `structure`, or `decoration`, choose a palette tile and its frame number, then paint a cell. Rectangle and drag painting repeat the same placement; no auto-connection runs.
3. Use `通行可` / `通行不可` to edit the explicit collision layer. The green/red overlay visualises that array.
4. Place the required markers. A home needs `homeSpawn`, `dungeonEntrance`, `homeStorage`, `homePreparation`, and `homeVisitors`. Every dungeon floor needs `stairsUp`; a floor with a following floor also needs `stairsDown`. First-floor `stairsUp` targets the home's `dungeonEntrance`, while return stones and rescue target `homeSpawn`.
5. Export JSON or use 試遊. `compileMap` converts the collision layer to runtime 0/1 cells and passes authored layers through unchanged for rendering.

## Runtime rules

- Home and dungeon movement uses the explicit collision grid whenever present.
- Authored layers are rendered in saved frame order. Procedural/generated dungeon maps still use their numeric collision grid and a frame-0 floor/wall fallback.
- Marker validation checks bounds, walkability, and reachability using the explicit collision grid.
- Save migration still maps old `town`/`interior` locations to `home`; it does not restore the old town image.

## Asset hand-off

For each new sprite sheet, add a PNG and matching `.tileset.json` under `assets-src/map-tiles/sheets/`. The asset build validates it and regenerates the runtime catalog and palette. No 16-way auto-tile sheet is required. If a sheet contains multiple visual variants, the editor's saved frame number is the only choice needed.
