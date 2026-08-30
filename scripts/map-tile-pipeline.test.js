import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";
import { DUNGEON_THEME_FILE, MAP_EDITOR_PALETTE_API, MAP_EDITOR_THEME_API, MAP_TILE_PALETTE_API, authoredDungeonThemePieces, availableEnemyIds, buildMapTileAssets, detectStackedFrames, readDungeonThemes, readTileSheets, savePaletteAtomically, validateDungeonThemes, validatePalette } from "./map-tile-pipeline.mjs";

const temporaryDirectories = [];
afterEach(() => { for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

function fixtureDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "map-tile-pipeline-"));
  temporaryDirectories.push(directory);
  const source = path.resolve("assets-src/map-tiles/sheets");
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) if (entry.isFile()) fs.copyFileSync(path.join(source, entry.name), path.join(directory, entry.name));
  return directory;
}

function emptyFixtureDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "map-tile-pipeline-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeSheet(directory, base, overrides = {}, width = 16, height = 16) {
  const image = new PNG({ width, height, colorType: 6 });
  image.data.fill(255);
  fs.writeFileSync(path.join(directory, `${base}.png`), PNG.sync.write(image, { colorType: 6, inputColorType: 6, bitDepth: 8 }));
  const config = { version: 1, id: base, label: base, tileSize: 16, margin: 0, spacing: 0, mapKinds: ["home"], defaultLayer: "ground", defaultWalkable: true, ...overrides };
  fs.writeFileSync(path.join(directory, `${base}.tileset.json`), JSON.stringify(config));
}

describe("map tile source pipeline", () => {
  it("exposes the canonical editor palette endpoint and legacy alias", () => {
    expect(MAP_EDITOR_PALETTE_API).toBe("/__map-editor/palettes");
    expect(MAP_EDITOR_THEME_API).toBe("/__map-editor/dungeon-themes");
    expect(MAP_TILE_PALETTE_API).toBe("/__map-tiles/palettes.json");
  });

  it("validates all built-in dungeon themes and fails loudly on removed references", () => {
    const assets = readTileSheets(path.resolve("assets-src/map-tiles/sheets"));
    const source = readDungeonThemes(DUNGEON_THEME_FILE, assets);
    expect(source.themes.map((theme) => theme.id)).toEqual(["cave", "ruins", "lava"]);
    const invalid = structuredClone(source);
    invalid.themes[0].floorVariants[0].assetId = "removed-theme-sheet";
    expect(() => validateDungeonThemes(invalid, assets)).toThrow(/references unknown asset removed-theme-sheet/);
  });

  it("accepts imported enemies in a theme pool, not only the built-in twelve", () => {
    const assets = readTileSheets(path.resolve("assets-src/map-tiles/sheets"));
    const themes = structuredClone(readDungeonThemes(DUNGEON_THEME_FILE, assets));
    themes.themes[0].spawns[0].actorId = "imported-ghoul";
    // The whitelist used to be the twelve craftpix ids, which locked every
    // imported enemy out of procedural generation.
    expect(() => validateDungeonThemes(themes, assets, availableEnemyIds())).toThrow(/unavailable enemy imported-ghoul/);
    expect(() => validateDungeonThemes(themes, assets, new Set([...availableEnemyIds(), "imported-ghoul"]))).not.toThrow();
  });

  it("collects enemy ids from imported actor definitions", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "enemy-ids-"));
    const actor = (id, roles) => {
      fs.mkdirSync(path.join(root, id), { recursive: true });
      fs.writeFileSync(path.join(root, id, "actor.json"), JSON.stringify({ version: 1, id, label: id, roles }), "utf8");
    };
    actor("imported-ghoul", ["enemy"]);
    actor("imported-villager", ["npc"]);
    fs.writeFileSync(path.join(root, "broken.json"), "{ not json", "utf8");
    const ids = availableEnemyIds(root);
    expect(ids.has("imported-ghoul")).toBe(true);
    expect(ids.has("imported-villager")).toBe(false);
    expect(ids.has("slime1")).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
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

  it("supports 32px sheets with nonzero margin and spacing", () => {
    const directory = emptyFixtureDirectory();
    writeSheet(directory, "large.sheet", { tileSize: 32, margin: 2, spacing: 1, mapKinds: ["dungeon"] }, 69, 69);
    expect(readTileSheets(directory)[0]).toMatchObject({ id: "large.sheet", tileSize: 32, margin: 2, spacing: 1, columns: 2, rows: 2, frameCount: 4 });
  });

  it("rejects duplicate asset ids across different source pairs", () => {
    const directory = emptyFixtureDirectory();
    writeSheet(directory, "first", { id: "duplicate.asset" });
    writeSheet(directory, "second", { id: "duplicate.asset" });
    expect(() => readTileSheets(directory)).toThrow(/duplicate asset id duplicate\.asset/);
  });

  it("rejects sheet dimensions that do not fit the configured grid", () => {
    const directory = emptyFixtureDirectory();
    writeSheet(directory, "bad-dimensions", { margin: 1, spacing: 2 }, 20, 20);
    expect(() => readTileSheets(directory)).toThrow(/dimensions 20x20 do not fit/);
  });

  it("rejects invalid PNG data", () => {
    const directory = emptyFixtureDirectory();
    writeSheet(directory, "broken-png");
    fs.writeFileSync(path.join(directory, "broken-png.png"), "not a png");
    expect(() => readTileSheets(directory)).toThrow(/PNG signature is missing/);
  });

  it("rejects invalid tileset configuration fields", () => {
    const directory = emptyFixtureDirectory();
    writeSheet(directory, "bad-config", { tileSize: 24, defaultWalkable: "yes" });
    expect(() => readTileSheets(directory)).toThrow(/tileSize must be 16 or 32/);
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

  it("allows a sheet on either map-kind palette when the tile size matches", () => {
    const assets = [{ id: "shared", tileSize: 16, frameCount: 1, mapKinds: ["dungeon"] }];
    const palette = { version: 1, pages: [{ id: "home", label: "Home", mapKind: "home", tileSize: 16, width: 1, height: 1, cells: [{ x: 0, y: 0, assetId: "shared", frame: 0, layer: "ground", walkable: true }] }] };
    expect(() => validatePalette(palette, assets)).not.toThrow();
  });

  it("removes palette cells for sheets deleted from the source folder", () => {
    const inputDir = fixtureDirectory();
    const outputDir = path.join(inputDir, "generated");
    const paletteFile = path.join(inputDir, "palettes.json");
    const generatedTs = path.join(inputDir, "catalog.generated.ts");
    fs.writeFileSync(paletteFile, JSON.stringify({ version: 1, pages: [{ id: "home", label: "Home", mapKind: "home", tileSize: 16, width: 2, height: 1, cells: [{ x: 0, y: 0, assetId: "home.floor", frame: 0, layer: "ground", walkable: true }, { x: 1, y: 0, assetId: "removed-sheet", frame: 0, layer: "ground", walkable: false }] }] }));
    const result = buildMapTileAssets({ inputDir, paletteFile, outputDir, generatedTs });
    expect(result.palette.pages[0].cells).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(paletteFile, "utf8")).pages[0].cells).toHaveLength(1);
  });

  it("restores the original palette and removes transaction files when generation fails", () => {
    const inputDir = fixtureDirectory();
    const outputDir = path.join(inputDir, "generated");
    const paletteFile = path.join(inputDir, "palettes.json");
    const generatedTs = path.join(inputDir, "catalog.generated.ts");
    const original = { version: 1, pages: [{ id: "home", label: "Original", mapKind: "home", tileSize: 16, width: 2, height: 2, cells: [{ x: 0, y: 0, assetId: "home.floor", frame: 0, layer: "ground", walkable: true }] }] };
    const replacement = { ...original, pages: [{ ...original.pages[0], label: "Replacement" }] };
    const originalText = JSON.stringify(original, null, 2) + "\n";
    fs.writeFileSync(paletteFile, originalText);
    buildMapTileAssets({ inputDir, paletteFile, outputDir, generatedTs });

    expect(() => savePaletteAtomically(replacement, {
      inputDir,
      paletteFile,
      outputDir,
      generatedTs,
      generateAssets: () => { throw new Error("injected generation failure"); },
    })).toThrow("injected generation failure");

    expect(fs.readFileSync(paletteFile, "utf8")).toBe(originalText);
    expect(fs.readdirSync(inputDir).filter((name) => name.startsWith("palettes.json.") && (name.endsWith(".tmp") || name.endsWith(".bak")))).toEqual([]);
  });
});

/** A one-column sheet whose tiles are described row by row. */
function stripSheet(rows, tileSize = 16) {
  const image = new PNG({ width: tileSize, height: rows.length * tileSize, colorType: 6 });
  image.data.fill(0);
  rows.forEach((row, index) => {
    for (let y = 0; y < tileSize; y += 1) for (let x = 0; x < tileSize; x += 1) {
      if (!row(x, y, tileSize)) continue;
      const offset = ((index * tileSize + y) * tileSize + x) * 4;
      image.data[offset] = 200;
      image.data[offset + 1] = 160;
      image.data[offset + 2] = 90;
      image.data[offset + 3] = 255;
    }
  });
  return PNG.sync.read(PNG.sync.write(image, { colorType: 6, inputColorType: 6, bitDepth: 8 }));
}

describe("stacked frame detection", () => {
  const geometry = { tileSize: 16, margin: 0, spacing: 0, columns: 1 };

  it("pairs a partly transparent tile with the one continuing below it", () => {
    // Row 0 is a narrow column reaching its bottom edge, row 1 is solid, and
    // rows 2-3 are a solid tile above an empty one.
    const png = stripSheet([
      (x) => x >= 4 && x < 8,
      () => true,
      () => true,
      () => false,
    ]);
    // Only row 1 is a lower half. Row 2 is not, even though row 1 is partly
    // transparent in exactly the way an upper half would be: consuming both
    // halves of a pair is what keeps one picture from chaining into the next.
    expect(detectStackedFrames(png, { ...geometry, rows: 4 })).toEqual([1]);
  });

  it("rejects an upper half that is solid, empty, or ends off the seam", () => {
    const solidAbove = stripSheet([() => true, () => true]);
    expect(detectStackedFrames(solidAbove, { ...geometry, rows: 2 })).toEqual([]);
    const emptyAbove = stripSheet([() => false, () => true]);
    expect(detectStackedFrames(emptyAbove, { ...geometry, rows: 2 })).toEqual([]);
    // The upper half ends on columns 0-3 but the lower half starts on 8-11,
    // so the two are separate pictures that happen to share a row boundary.
    const offset = stripSheet([(x) => x < 4, (x) => x >= 8 && x < 12]);
    expect(detectStackedFrames(offset, { ...geometry, rows: 2 })).toEqual([]);
  });

  it("reads the built-in stair sheet the way the art is drawn", () => {
    const asset = readTileSheets(path.resolve("assets-src/map-tiles/sheets")).find((entry) => entry.id === "mapchip2-mapchip-base-s08");
    const detected = new Set(detectStackedFrames(PNG.sync.read(fs.readFileSync(asset.sourceFile)), asset));
    // Frames 6+14 and 7+15 are ladders two cells tall.
    expect(detected.has(14)).toBe(true);
    expect(detected.has(15)).toBe(true);
    // Frames 22 and 23 are holes leading down, drawn inside one cell.
    expect(detected.has(22)).toBe(false);
    expect(detected.has(23)).toBe(false);
  });

  it("fills in stair heights for the catalogue and keeps them out of the source", () => {
    const assets = readTileSheets(path.resolve("assets-src/map-tiles/sheets"));
    const resolved = readDungeonThemes(DUNGEON_THEME_FILE, assets);
    for (const theme of resolved.themes) {
      expect(theme.stairsUp.height).toBe(2);
      expect(theme.stairsDown.height).toBeUndefined();
    }
    // A derived height is dropped again on the way back to disk, so the
    // authored file records only what a person chose.
    const authored = authoredDungeonThemePieces(resolved, assets);
    expect(authored.themes.every((theme) => theme.stairsUp.height === undefined)).toBe(true);
    // An explicit height that disagrees with the sheet survives the round trip.
    const overridden = { ...resolved, themes: resolved.themes.map((theme) => ({ ...theme, stairsUp: { ...theme.stairsUp, height: 1 } })) };
    expect(authoredDungeonThemePieces(overridden, assets).themes[0].stairsUp.height).toBe(1);
  });

  it("accepts a decoration rule switched off, and rejects a non-boolean switch", () => {
    const assets = readTileSheets(path.resolve("assets-src/map-tiles/sheets"));
    const themes = structuredClone(readDungeonThemes(DUNGEON_THEME_FILE, assets));
    themes.themes[0].decorations[0].enabled = false;
    expect(() => validateDungeonThemes(themes, assets)).not.toThrow();
    themes.themes[0].decorations[0].enabled = "no";
    expect(() => validateDungeonThemes(themes, assets)).toThrow(/enabled must be boolean/);
    // Switching rules off never trips the six-rule contract.
    const allOff = structuredClone(readDungeonThemes(DUNGEON_THEME_FILE, assets));
    for (const theme of allOff.themes) for (const rule of theme.decorations) rule.enabled = false;
    expect(() => validateDungeonThemes(allOff, assets)).not.toThrow();
  });

  it("checks the tiles a theme names for the game's own objects", () => {
    const assets = readTileSheets(path.resolve("assets-src/map-tiles/sheets"));
    const themes = structuredClone(readDungeonThemes(DUNGEON_THEME_FILE, assets));
    expect(() => validateDungeonThemes(themes, assets)).not.toThrow();
    // The chest and body sheets are ordinary decoration tiles, one cell each.
    for (const theme of themes.themes) {
      expect(theme.objects.chest.height).toBeUndefined();
      expect(theme.objects.corpse.height).toBeUndefined();
    }
    const unknownKind = structuredClone(themes);
    unknownKind.themes[0].objects.lantern = { assetId: "mapchip2-mapchip-base-s18", frame: 0 };
    expect(() => validateDungeonThemes(unknownKind, assets)).toThrow(/objects has unknown kind lantern/);
    const unknownAsset = structuredClone(themes);
    unknownAsset.themes[0].objects.chest.assetId = "removed-sheet";
    expect(() => validateDungeonThemes(unknownAsset, assets)).toThrow(/objects.chest references unknown asset removed-sheet/);
    // Leaving them out is valid: the game keeps its placeholder sheet.
    const bare = structuredClone(themes);
    for (const theme of bare.themes) delete theme.objects;
    expect(() => validateDungeonThemes(bare, assets)).not.toThrow();
  });

  it("rejects a two-cell stair with no room above it on the sheet", () => {
    const assets = readTileSheets(path.resolve("assets-src/map-tiles/sheets"));
    const themes = structuredClone(readDungeonThemes(DUNGEON_THEME_FILE, assets));
    themes.themes[0].stairsUp = { assetId: "mapchip2-mapchip-base-s08", frame: 3, height: 2 };
    expect(() => validateDungeonThemes(themes, assets)).toThrow(/height 2 has no upper half/);
    themes.themes[0].stairsUp = { assetId: "mapchip2-mapchip-base-s08", frame: 14, height: 3 };
    expect(() => validateDungeonThemes(themes, assets)).toThrow(/height must be 1 or 2/);
  });
});
