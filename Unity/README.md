# Dungeon Curio Merchant — Unity edition

This folder is a Unity 6.3 LTS 2D project added alongside the existing Phaser/Vite version. It deliberately shares source art and the town layout JSON, while Unity gameplay code lives in `Assets/Scripts/`.

## Open it

1. In Unity Hub, select **Add** → **Add project from disk**.
2. Choose this `Unity` folder.
3. Open with Unity `6000.3.9f1` (installed locally).
4. Create or open any empty 2D scene, then press Play. `MerchanBootstrap` starts automatically, so a starter scene is not required.

The fallback town appears immediately. Move with WASD or arrow keys. Stand near an entrance and press E or Space to exercise the Unity interaction hook.

## Rebuild the town as editable Tilemaps

Use the Unity menu **Merchan → Build Town Tilemap Scene** once. It creates and opens `Assets/Scenes/TownAuthoring.unity` with:

- `Ground`, `Buildings`, and `Props` Tilemaps for authoring;
- a hidden `Collision` Tilemap with a `TilemapCollider2D`;
- `LegacyReference`, the old map at low opacity for alignment while rebuilding.

The starter scene initially paints the ground and the current collision mask. Edit the tiles in the Scene view, then use the Collision Tilemap as the authoritative walkability layer. The player movement automatically uses the Tilemap collider when the `TownGrid` exists; the JSON mask remains only as a fallback for the old runtime view.

The generated starter map paints `Ground` with grass and adds a simple paved-road cross on `Roads`. The `LegacyReference` object is disabled by default; enable it temporarily if you want to compare against the old map.

The first menu run also generates 24px Tile assets for the terrain, buildings, objects, and building-extension sheets under `Assets/Tiles/TownGenerated`.

If the assets do not appear in the Project window:

1. Select `Assets/Tiles/TownGenerated` and clear any Project search/filter. Searching `t:Tile` shows only paintable Tile assets.
2. Open **Window → 2D → Tile Palette**, create a palette such as `Town`, and drag the generated Tile assets from that folder into the palette.
3. Select `TownGrid/Ground`, `TownGrid/Roads`, `TownGrid/Buildings`, or `TownGrid/Props` in the Hierarchy before painting. `Collision` is hidden and is reserved for walkability.

The original PNG sheets remain under `Assets/Resources/Merchan/assets/tiles`. Select a sheet there and press **Apply** in the Inspector if Unity shows it as not imported; the project importer keeps them as crisp 24px pixel art.

## Unity MCP

This project references the official community **MCP for Unity** package (`com.coplaydev.unity-mcp`, pinned to `v10.0.0`). After Unity finishes importing packages:

1. Open **Window → MCP for Unity → Server Window** and confirm the editor bridge is running.
2. Use **Window → MCP for Unity → Configure All Detected Clients** to add the local server to Codex and other detected MCP clients.
3. Start the local server from the repository root when needed:

```powershell
./scripts/start-unity-mcp.ps1
```

The MCP client endpoint is `http://localhost:8080/mcp`. Keep the server local; it provides editor control over the connected Unity instance.

## Data and migration boundary

| Existing web source | Unity location / status |
| --- | --- |
| `public/assets/**` | `Assets/Resources/Merchan/assets/**` — imported pixel-art assets |
| `src/game/townLayout.json` | `Assets/Resources/Merchan/Data/townLayout.json` — shared map, spawn, entrances, and collision |
| `src/game/engine.ts` | Next porting target: translate into C# domain services and cover it with Unity EditMode tests |
| Phaser scene/UI | Replaced incrementally by Unity scenes, Tilemap, and Canvas UI |

`MerchanBootstrap.cs` intentionally contains only town movement, collision, camera, and an interaction seam. Keep durable game rules out of MonoBehaviours as the engine port starts.

## Re-import source assets

The imported assets are a snapshot. When the web edition's assets or layout change, run this from the repository root with Unity closed:

```powershell
Copy-Item public/assets Unity/Assets/Resources/Merchan/assets -Recurse -Force
Copy-Item src/game/townLayout.json Unity/Assets/Resources/Merchan/Data/townLayout.json -Force
```

Then reopen Unity and let it reimport. Unity-generated `Library/`, `Temp/`, and `Logs/` are intentionally ignored.
