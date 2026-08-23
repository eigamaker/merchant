# Home / dungeon map editing

This document is kept as the asset hand-off note for the web map editor. The former town/interior editor and its one-picture collision are retired.

`review.html` exposes two map kinds:

- `home`: one house that also serves as shop and visitor area.
- `dungeon`: one map per floor; use 新規 or 複製 to add the next floor.

Choose a layer, a palette tile, and a frame, then paint a cell. Placement is literal: neighbouring cells never rewrite a saved frame. Use the 通行可 / 通行不可 tools for the explicit collision layer. A valid home has `homeSpawn`, `dungeonEntrance`, `homePreparation`, and `homeVisitors`; `shopkeeperCounter` and `customerCounter` define the shop flow. Storage and display are managed from the menu and need no map marker. Every dungeon floor has `stairsUp`; every floor with a following floor also has `stairsDown`. The deepest floor may omit `stairsDown`. The first-floor `stairsUp` returns to the home's `dungeonEntrance`; return stones and rescue still use `homeSpawn`.

Put map sprite sheets and matching `.tileset.json` definitions in `assets-src/map-tiles/sheets/`. The generated catalog and palette include the four starter terrain assets plus `dungeon.stairs-up` and `dungeon.stairs-down`. No 16-way auto-tile sheet is required.
