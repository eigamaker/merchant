# Craftpix import

Import the supplied archives from the download directory and build the web-runtime copies:

```powershell
python scripts/import_craftpix_packs.py --source-root C:\Users\takao\Downloads
python scripts/build_craftpix_runtime.py
```

The original source files and license notices stay under `assets-src/vendor/craftpix`. The browser uses deduplicated art under `public/assets/craftpix`, actor sheets under `public/assets/actors/craftpix`, and UI sheets under `public/assets/ui/craftpix`.

The map editor's `Environment` palette exposes the imported home, guild hall, glassblower, and dungeon-object sheets. These are visual stamps; walkability is still stored separately in the manual collision and boundary tools.
