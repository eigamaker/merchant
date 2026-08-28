import { buildMapTileAssets } from "./map-tile-pipeline.mjs";

try {
  const result = buildMapTileAssets();
  console.log(`Generated ${result.assets.length} map tile assets, ${result.palette.pages.length} palette pages, and ${result.themes.themes.length} dungeon themes.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
