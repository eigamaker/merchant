import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAP_EDITOR_PALETTE_API, MAP_TILE_PALETTE_API, buildMapTileAssets, readTileSheets, validatePalette } from "./map-tile-pipeline.mjs";

const temporaryDirectories = [];
afterEach(() => { for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

function fixtureDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "map-tile-pipeline-"));
  temporaryDirectories.push(directory);
  const source = path.resolve("assets-src/map-tiles/sheets");
  for (const name of fs.readdirSync(source)) fs.copyFileSync(path.join(source, name), path.join(directory, name));
  return directory;
}

describe("map tile source pipeline", () => {
  it("exposes the canonical editor palette endpoint and legacy alias", () => {
    expect(MAP_EDITOR_PALETTE_API).toBe("/__map-editor/palettes");
    expect(MAP_TILE_PALETTE_API).toBe("/__map-tiles/palettes.json");
  });

  it("reads paired sheets and derives frame geometry", () => {
    const assets = readTileSheets(fixtureDirectory());
    expect(assets.map((asset) => asset.id)).toEqual(["dungeon.floor", "dungeon.stairs-down", "dungeon.stairs-up", "dungeon.wall", "home.floor", "home.wall"]);
    expect(assets.find((asset) => asset.id === "home.wall")?.frameCount).toBe(16);
    expect(assets.find((asset) => asset.id === "dungeon.stairs-up")).toMatchObject({ tileSize: 16, frameCount: 1, mapKinds: ["dungeon"], defaultLayer: "decoration", defaultWalkable: true });
    expect(assets.find((asset) => asset.id === "dungeon.stairs-down")).toMatchObject({ tileSize: 16, frameCount: 1, mapKinds: ["dungeon"], defaultLayer: "decoration", defaultWalkable: true });
  });

  it("registers both stair directions in the default dungeon palette", () => {
    const assets = readTileSheets(path.resolve("assets-src/map-tiles/sheets"));
    const palette = JSON.parse(fs.readFileSync(path.resolve("assets-src/map-tiles/palettes.json"), "utf8"));
    validatePalette(palette, assets);
    const dungeon = palette.pages.find((page) => page.id === "dungeon-default");
    expect(dungeon.cells.map((cell) => cell.assetId)).toEqual(expect.arrayContaining(["dungeon.stairs-up", "dungeon.stairs-down"]));
  });

  it("rejects an unpaired PNG", () => {
    const directory = fixtureDirectory();
    fs.unlinkSync(path.join(directory, "home-floor.tileset.json"));
    expect(() => readTileSheets(directory)).toThrow(/Missing \.tileset\.json/);
  });

  it("validates palette references and writes generated catalog files", () => {
    const inputDir = fixtureDirectory();
    const outputDir = path.join(inputDir, "generated");
    const paletteFile = path.join(inputDir, "palettes.json");
    const generatedTs = path.join(inputDir, "catalog.generated.ts");
    const palette = { version: 1, pages: [{ id: "home", label: "Home", mapKind: "home", tileSize: 16, width: 2, height: 2, cells: [{ x: 0, y: 0, assetId: "home.floor", frame: 0, layer: "ground", walkable: true }] }] };
    fs.writeFileSync(paletteFile, JSON.stringify(palette));
    const result = buildMapTileAssets({ inputDir, paletteFile, outputDir, generatedTs });
    expect(result.assets).toHaveLength(6);
    expect(fs.existsSync(path.join(outputDir, "catalog.json"))).toBe(true);
    expect(fs.existsSync(generatedTs)).toBe(true);
    expect(() => validatePalette({ version: 1, pages: [{ ...palette.pages[0], cells: [{ ...palette.pages[0].cells[0], assetId: "missing" }] }] }, result.assets)).toThrow(/unknown asset/);
  });
});
