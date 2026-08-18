import { analyzeImportFile } from "./asset-import-pipeline.mjs";

const file = process.argv[2];
if (!file) {
  console.error("usage: npm run assets:inspect -- <zip|tmx|tsx|png>");
  process.exitCode = 2;
} else {
  try {
    const report = analyzeImportFile(file);
    console.log(JSON.stringify(report, (key, value) => key.startsWith("_") ? undefined : value, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

