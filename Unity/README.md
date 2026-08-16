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
| `src/game/townLayout.json` | `Assets/Resources/Merchan/Data/townLayout.json` — town prototype only; the town is being dropped from the product flow |
| `src/game/rng.ts` | Ported to `Assets/Scripts/Domain/Core/Rng.cs`, bit-for-bit, so a seed replays identically in both editions |
| `src/game/types.ts` item model | Replaced by `Assets/Scripts/Domain/Items/` — one ledger plus a location field, not per-container lists |
| `src/game/dungeonRules.ts` | Next porting target, alongside the turn resolver and the brains from `engine.ts` |
| Authored dungeon maps (`src/review/`) | Exported as JSON into `Assets/Resources/Merchan/Data/`; the shop is authored in the Unity scene instead |
| Phaser scene/UI | Replaced incrementally by Unity scenes, Tilemap, and Canvas UI |

Browser saves are not read. They assume a town that the new design removes, so Unity starts a fresh save v1.

## Assemblies

| asmdef | Contents | References UnityEngine |
| --- | --- | --- |
| `Merchan.Domain` | `Assets/Scripts/Domain/` — every durable game rule | no (`noEngineReferences`) |
| `Merchan.Unity` | `Assets/Scripts/` — MonoBehaviours, input, presentation | yes |
| `Merchan.Unity.Editor` | `Assets/Editor/` — importers and authoring tools | yes, Editor only |
| `Merchan.Domain.Tests` | `Assets/Tests/EditMode/` | Test Framework only |

`Merchan.Domain` stays engine-free on purpose: it makes EditMode tests fast, and it lets the same test sources run without Unity at all. Use `Merchan.Domain.GridPos` rather than `UnityEngine.Vector2Int` in that assembly.

`MerchanBootstrap.cs` intentionally contains only town movement, collision, camera, and an interaction seam. Keep durable game rules in `Merchan.Domain`, not in MonoBehaviours.

## Play a full day

Run **Merchan → Build Home Shop Scene** and **Merchan → Build Dungeon Scene** once each, then open `Assets/Scenes/HomeShop.unity` and press Play.

One day looks like this:

1. Take stock out of the storage chest and put it on a shelf (`E`).
2. Walk to the blue tile and press `E` to set out. An escort is hired automatically and their fee comes out of the purse.
3. Underground, fight or avoid what you meet, search remnants, and walk back out of the entrance — or use the return stone.
4. Back at the shop, shelve what you brought home, stand at the counter and open up.
5. Serve customers as they queue, then close. Shutting the door is what ends the day.

`MerchanSession` is the one object that survives the scene change: it owns the ledger, the purse, the escorts and the calendar. Both scene controllers borrow their state from it rather than building their own, which is what makes a find actually come home. It also owns the save file — `Merchan.Domain` never touches the disk or a JSON library.

Progress is written to `Application.persistentDataPath/save.json` when you set out, when you get back, and when you close for the day.

## Play the dungeon

Run **Merchan → Build Dungeon Scene** once. It creates `Assets/Scenes/Dungeon.unity`, wires the imported Craftpix prefabs onto the controller, and adds the scene to the build settings. Open it and press Play.

The floor is drawn as flat tinted cells on purpose. The vertical slice is about whether the turn loop and the direct controls feel right; dressing the floor in tile art first would only make that harder to judge.

| Input | Action |
| --- | --- |
| `WASD` / arrows | Step one cell, and aim |
| `E` | Contextual: search a remnant, take from it, pick up, leave |
| `R` | Shove whatever is in front |
| `F` | Use the held item — only a weapon does anything |
| `C` | Use the bound consumable |
| `Space` | Wait one turn |
| `1`–`5`, wheel | Change the held quick slot (never costs a turn) |

Bindings are built in code in `Assets/Scripts/Input/MerchanInput.cs` rather than in an `.inputactions` asset, so they are diffable and still rebindable at run time. The on-screen prompt reads the live binding, so a rebind changes what it says.

## Play the shop

Run **Merchan → Build Home Shop Scene**, open `Assets/Scenes/HomeShop.unity` and press Play.

Walk to the counter and press `E` to open up. Customers arrive on their own, pick something off a shelf, queue, and wait for you — stand at the counter and press `E` again to take payment. Wander off and they will eventually put the ware back and leave. Closing up stops new arrivals and ends the day once the room empties.

`E` also stocks and clears shelves (face a slot while holding a ware), uses the storage chest, and opens the door to the dungeon.

The room is authored with ordinary components, so it can be rearranged by dragging things in the Scene view. `ShopLayout.Validate` re-derives everything from where the transforms actually are and logs an error for a shelf nobody can reach or a queue that does not end at the counter.

> Each authoring component lives in a file named after its class. Unity only links a MonoBehaviour to its script by GUID when the names match; two components in one file save with a dangling reference and then silently do nothing at run time.

## Run the tests

```powershell
./scripts/domain-tests.ps1
```

Compiles and runs the domain tests on plain .NET using the Roslyn compiler and NUnit that ship inside the Unity install. No .NET SDK and no NuGet restore are needed, and it works while the editor is open.

```powershell
./scripts/unity-tests.ps1
```

Runs the full EditMode suite in a headless editor. Close Unity first — the editor holds an exclusive lock on `Library/`, so a second instance fails to launch. Pass `-CompileOnly` to check compilation after a package or asmdef change.

```powershell
./scripts/unity-tests.ps1 -TestPlatform PlayMode
```

Loads the dungeon scene and checks it comes up clean. The EditMode suite covers the rules exhaustively but never touches a MonoBehaviour, so a missing prefab reference or a null in `Awake` would sail past it and only surface when somebody pressed Play. The test framework fails on any logged error, which is most of the point.

## Re-import source assets

The imported assets are a snapshot. When the web edition's assets or layout change, run this from the repository root with Unity closed:

```powershell
Copy-Item public/assets Unity/Assets/Resources/Merchan/assets -Recurse -Force
Copy-Item src/game/townLayout.json Unity/Assets/Resources/Merchan/Data/townLayout.json -Force
```

Then reopen Unity and let it reimport. Unity-generated `Library/`, `Temp/`, and `Logs/` are intentionally ignored.
