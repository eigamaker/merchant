import { buildMapTileAssets } from "./map-tile-pipeline.mjs";

try {
  const result = buildMapTileAssets();
  console.log(`Generated ${result.assets.length} map tile assets and ${result.palette.pages.length} palette pages.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
