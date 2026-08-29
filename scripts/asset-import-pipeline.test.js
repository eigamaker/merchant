import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { analyzeImport, analyzeImportFile, commitImport } from "./asset-import-pipeline.mjs";

function png(width, height, color = [40, 80, 120, 255]) {
  const image = new PNG({ width, height });
  for (let index = 0; index < image.data.length; index += 4) image.data.set(color, index);
  return PNG.sync.write(image);
}

describe("asset import pipeline", () => {
  it("suggests a 32px grid for the supplied Hyptosis atlas", () => {
    const file = "C:/Users/takao/Downloads/hyptosis_tile-art-batch-1.png";
    if (!fs.existsSync(file)) return;
    const report = analyzeImportFile(file);
    expect(report.mapTiles[0]).toMatchObject({ tileSize: 32, columns: 30, rows: 30 });
  });

  it("expands mapchip2's WOLF autotiles instead of slicing them into fragments", () => {
    const file = "C:/Users/takao/Downloads/mapchip2_0724.zip";
    if (!fs.existsSync(file)) return;
    const report = analyzeImportFile(file);
    const autotiles = report.mapTiles.filter((entry) => entry.format?.kind === "wolf-autotile");
    // 85 of the pack's 87 sheets are autotiles; the old detector read each as a
    // valid "1 column x 5 rows" grid and registered five meaningless fragments.
    expect(autotiles).toHaveLength(85);
    expect(autotiles.every((entry) => entry.tileSize === 16 && entry.columns === 47)).toBe(true);
    expect(report.mapTiles.find((entry) => entry.label === "yougan")).toMatchObject({
      columns: 47, rows: 6, frameCount: 282, autotile: { scheme: "blob47", animationFrames: 6 },
    });
  });

  it("splits mapchip2's catalogue sheets at their caption bands", () => {
    const file = "C:/Users/takao/Downloads/mapchip2_0724.zip";
    if (!fs.existsSync(file)) return;
    const report = analyzeImportFile(file);
    const sections = report.mapTiles.filter((entry) => entry.format?.kind === "section-catalog");
    // base.png carries 31 captioned sections and world.png 4.
    expect(sections).toHaveLength(35);
    expect(sections.filter((entry) => entry.sourcePath.endsWith("base.png"))).toHaveLength(31);
    // "ダン 床・壁・階段" — the dungeon floor/wall/stair shelf.
    expect(sections.find((entry) => entry.id.endsWith("base-s17"))).toMatchObject({ columns: 8, rows: 24, section: { fromRow: 162, toRow: 185 } });
    expect(sections.every((entry) => String(entry.preview).startsWith("data:image/png;base64,"))).toBe(true);
  });

  it("reads the pack author's own tileset grouping out of the .tile settings", () => {
    const file = "C:/Users/takao/Downloads/mapchip2_0724.zip";
    if (!fs.existsSync(file)) return;
    const report = analyzeImportFile(file);
    expect(report.tileGroups.map((group) => group.label)).toEqual(["街", "ダンジョン", "森", "ワールドマップ"]);
    const dungeon = report.tileGroups.find((group) => group.label === "ダンジョン");
    expect(dungeon.images).toHaveLength(16);
    expect(dungeon.images.some((image) => image.endsWith("kabe-ue_doukutu1.png"))).toBe(true);
    expect(report.warnings.join(" ")).toMatch(/\.tile/);
  });

  it("stores an expanded blob sheet and records how it was produced", () => {
    const file = "C:/Users/takao/Downloads/mapchip2_0724.zip";
    if (!fs.existsSync(file)) return;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "asset-import-wolf-"));
    const report = analyzeImportFile(file);
    const selected = report.mapTiles.filter((entry) => /yougan|base-s17$/.test(entry.id));
    commitImport(report, { mapTiles: selected, actors: [], licenseAcknowledged: true, mapSheetImportDir: path.join(root, "sheets"), actorImportDir: path.join(root, "actors"), mapImportManifest: path.join(root, "map-imports.json"), actorImportManifest: path.join(root, "actor-imports.json") });
    const dir = path.join(root, "sheets", "mapchip2-0724");
    const sidecar = (id) => JSON.parse(fs.readFileSync(path.join(dir, `${id}.tileset.json`), "utf8"));
    const image = (id) => PNG.sync.read(fs.readFileSync(path.join(dir, `${id}.png`)));
    expect(image("mapchip2-mapchip-yougan")).toMatchObject({ width: 47 * 16, height: 6 * 16 });
    expect(sidecar("mapchip2-mapchip-yougan")).toMatchObject({ sourceFormat: "wolf-autotile", autotile: { scheme: "blob47", animationFrames: 6 } });
    expect(image("mapchip2-mapchip-base-s17")).toMatchObject({ width: 8 * 16, height: 24 * 16 });
    expect(sidecar("mapchip2-mapchip-base-s17")).toMatchObject({ sourceFormat: "section-catalog", section: { fromRow: 162, toRow: 185 } });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("refuses to guess a grid for a sheet whose shape it does not recognize", () => {
    // 40x24 divides by neither 16 nor 32, so there is nothing honest to suggest.
    const report = analyzeImport(Buffer.from(zipSync({ "odd.png": new Uint8Array(png(40, 24)) })), { fileName: "odd.zip" });
    expect(report.mapTiles[0]).toMatchObject({ format: { kind: "unknown" }, selected: false });
    expect(report.mapTiles[0].warnings.join(" ")).toMatch(/40x24/);
  });

  it("classifies the male TMX pack as actors and does not preselect map sheets", () => {
    const file = "C:/Users/takao/Downloads/craftpix-net-555940-free-base-4-direction-male-character-pixel-art.zip";
    if (!fs.existsSync(file)) return;
    const report = analyzeImportFile(file);
    expect(report.actors.map((actor) => actor.id)).toEqual(["base-boy-sword", "base-boy-unarmed"]);
    expect(report.actors[0].clips).toHaveProperty("attack");
    expect(report.actors[1].clips).not.toHaveProperty("attack");
    expect(report.mapTiles.filter((entry) => entry.selected)).toHaveLength(0);
  });

  it("parses a static TMX tileset and its image geometry", () => {
    const files = {
      "map.tmx": Buffer.from(`<?xml version="1.0"?><map width="2" height="2" tilewidth="16" tileheight="16"><tileset firstgid="1" name="ground" tilewidth="16" tileheight="16" tilecount="4" columns="2"><image source="ground.png" width="32" height="32"/></tileset></map>`),
      "ground.png": png(32, 32),
    };
    const archive = Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, new Uint8Array(value)]))));
    const report = analyzeImport(archive, { fileName: "static.zip" });
    expect(report.tmx[0].classification.target).toBe("mapTiles");
    expect(report.mapTiles.some((entry) => entry.sourceTmx === "map.tmx" && entry.tileSize === 16)).toBe(true);
  });

  it("rejects XML external entities and keeps input files out of the repository", () => {
    expect(() => analyzeImport(Buffer.from(`<!DOCTYPE map [<!ENTITY x SYSTEM "file:///secret">]><map/>`), { fileName: "bad.tmx" })).toThrow(/DOCTYPE/);
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "asset-import-test-"));
    expect(fs.existsSync(temp)).toBe(true);
    fs.rmSync(temp, { recursive: true, force: true });
  });

  it("commits only approved map candidates into normalized PNG/sidecar pairs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "asset-import-commit-"));
    const archive = Buffer.from(zipSync({ "ground.png": new Uint8Array(png(32, 32)) }));
    const report = analyzeImport(archive, { fileName: "ground.zip" });
    report.mapTiles[0].selected = true;
    commitImport(report, { mapTiles: report.mapTiles, actors: [], licenseAcknowledged: true, mapSheetImportDir: path.join(root, "sheets"), actorImportDir: path.join(root, "actors"), mapImportManifest: path.join(root, "map-imports.json"), actorImportManifest: path.join(root, "actor-imports.json") });
    const output = path.join(root, "sheets", "ground", "ground.png");
    expect(fs.existsSync(output)).toBe(true);
    expect(PNG.sync.read(fs.readFileSync(output)).width).toBe(32);
    expect(fs.existsSync(output.replace(/\.png$/, ".tileset.json"))).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("can create split initial palette pages while committing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "asset-import-palette-"));
    const archive = Buffer.from(zipSync({ "ground.png": new Uint8Array(png(32, 32)) }));
    const report = analyzeImport(archive, { fileName: "palette.zip" });
    const paletteFile = path.join(root, "palettes.json");
    fs.writeFileSync(paletteFile, JSON.stringify({ version: 1, pages: [{ id: "seed", label: "Seed", mapKind: "home", tileSize: 32, width: 1, height: 1, cells: [] }] }));
    commitImport(report, { mapTiles: report.mapTiles, actors: [], createPalettePages: true, licenseAcknowledged: true, paletteFile, mapSheetImportDir: path.join(root, "sheets"), actorImportDir: path.join(root, "actors"), mapImportManifest: path.join(root, "mi"), actorImportManifest: path.join(root, "ai"), paletteInputDir: path.join(root, "sheets"), paletteOutputDir: path.join(root, "generated"), paletteGeneratedTs: path.join(root, "catalog.ts") });
    const saved = JSON.parse(fs.readFileSync(paletteFile, "utf8"));
    expect(saved.pages.some((page) => page.id !== "seed" && page.cells[0]?.assetId === "ground")).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
