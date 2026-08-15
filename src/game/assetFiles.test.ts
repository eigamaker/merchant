import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { createHash } from "node:crypto";

type RequiredPng = readonly [path: string, width: number, height: number];

/**
 * 町マップは1枚絵を256色パレットへ量子化して出力するため colorType は 3。
 * 他のシートはRGBA（colorType 6）契約のまま。
 */
const TOWN_MAP_PNG = "public/assets/tiles/town_map.png";

const requiredPngs: RequiredPng[] = [
  [TOWN_MAP_PNG, 1440, 1080],
  ["public/assets/actors/player.png", 128, 128],
  ["public/assets/actors/npc-innkeeper.png", 128, 128],
  ["public/assets/actors/npc-scout.png", 128, 128],
  ["public/assets/actors/npc-scholar.png", 128, 128],
  ["public/assets/actors/npc-mage.png", 128, 128],
  ["public/assets/actors/npc-trader.png", 128, 128],
  ["public/assets/actors/guard-rolf.png", 128, 128],
  ["public/assets/actors/guard-mina.png", 128, 128],
  ["public/assets/actors/enemy-goblin.png", 128, 128],
  ["public/assets/actors/enemy-bat.png", 128, 128],
  ["public/assets/actors/enemy-lizard.png", 128, 128],
  ["public/assets/actors/enemy-golem.png", 128, 128],
  ["public/assets/actors/enemy-necromancer.png", 128, 128],
  ["public/assets/actors/enemy-ghost.png", 128, 128],
  ["public/assets/tiles/town_terrain.png", 384, 192],
  ["public/assets/tiles/dungeon_terrain.png", 384, 192],
  ["public/assets/tiles/dungeon_walls.png", 288, 192],
  ["public/assets/tiles/town_objects.png", 384, 192],
  ["public/assets/tiles/town_buildings.png", 384, 288],
  ["public/assets/tiles/town_building_extensions.png", 384, 288],
  ["public/assets/objects/items.png", 192, 96],
  ["public/assets/objects/dungeon_objects.png", 192, 96],
  ["public/assets/buildings/tavern.png", 192, 72],
  ["public/assets/buildings/guild.png", 192, 72],
  ["public/assets/buildings/curio-shop.png", 96, 72],
  ["public/assets/buildings/scholar-house.png", 96, 72],
  ["public/assets/buildings/arcane-shop.png", 96, 72],
  ["public/assets/buildings/noble-house.png", 192, 72],
  ["public/assets/buildings/dungeon-gate.png", 192, 72],
  ["public/assets/dungeons/craftpix-showcase-base.png", 608, 448],
  ["public/assets/dungeons/craftpix-showcase-foreground.png", 608, 448],
  ["public/assets/dungeons/craftpix/walls_floor.png", 272, 464],
  ["public/assets/dungeons/craftpix/Objects.png", 384, 144],
];

function pngHeader(path: string): { width: number; height: number; colorType: number } {
  const bytes = readFileSync(resolve(process.cwd(), path));
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25]! };
}

function frameAlphaBounds(image: PNG, row: number): { width: number; height: number } {
  let minX = 32;
  let minY = 32;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const alpha = image.data[((row * 32 + y) * image.width + x) * 4 + 3]!;
      if (alpha === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { width: maxX - minX + 1, height: maxY - minY + 1 };
}

function alphaBounds(image: PNG, left: number, top: number, width: number, height: number): { width: number; height: number } {
  let minX = left + width;
  let minY = top + height;
  let maxX = -1;
  let maxY = -1;
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { width: maxX - minX + 1, height: maxY - minY + 1 };
}

describe("runtime pixel-art assets", () => {
  it("ships every required raster sheet with its frame-aligned dimensions", () => {
    for (const [path, width, height] of requiredPngs) {
      expect(existsSync(resolve(process.cwd(), path)), path).toBe(true);
      const header = pngHeader(path);
      expect(header.width, path).toBe(width);
      expect(header.height, path).toBe(height);
      expect(header.colorType, path).toBe(path === TOWN_MAP_PNG ? 3 : 6);
    }
  });

  it("uses genuinely different down, left, right and back art for every actor", () => {
    const actorPaths = requiredPngs.filter(([path]) => path.includes("/actors/"));
    for (const [path] of actorPaths) {
      const image = PNG.sync.read(readFileSync(resolve(process.cwd(), path)));
      const hashes = Array.from({ length: 4 }, (_, row) => {
        const pixels = Buffer.alloc(32 * 32 * 4);
        for (let y = 0; y < 32; y += 1) {
          const sourceStart = ((row * 32 + y) * image.width) * 4;
          image.data.copy(pixels, y * 32 * 4, sourceStart, sourceStart + 32 * 4);
        }
        return createHash("sha256").update(pixels).digest("hex");
      });
      expect(new Set(hashes).size, path).toBe(4);
    }
  });

  it("keeps the player at one visual height in every facing direction", () => {
    const image = PNG.sync.read(readFileSync(resolve(process.cwd(), "public/assets/actors/player.png")));
    const heights = Array.from({ length: 4 }, (_, row) => frameAlphaBounds(image, row).height);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(30);
  });

  it("fills every named 4x3 building kit region instead of leaving an 8-cell canvas gutter", () => {
    const image = PNG.sync.read(readFileSync(resolve(process.cwd(), "public/assets/tiles/town_buildings.png")));
    const origins: Array<[number, number]> = [[0, 0], [4, 0], [8, 0], [12, 0], [0, 3], [4, 3], [8, 3], [12, 3]];
    for (const [x, y] of origins) {
      const bounds = alphaBounds(image, x * 24, y * 24, 4 * 24, 3 * 24);
      expect(bounds.width, `${x},${y}`).toBeGreaterThanOrEqual(72);
      expect(bounds.height, `${x},${y}`).toBeGreaterThanOrEqual(48);
    }
  });

  it("keeps every 8-cell building visible across its full logical footprint", () => {
    for (const path of [
      "public/assets/buildings/tavern.png",
      "public/assets/buildings/guild.png",
      "public/assets/buildings/noble-house.png",
      "public/assets/buildings/dungeon-gate.png",
    ]) {
      const image = PNG.sync.read(readFileSync(resolve(process.cwd(), path)));
      expect(alphaBounds(image, 0, 0, image.width, image.height).width, path).toBeGreaterThanOrEqual(184);
    }
  });

  it("ships the Craftpix collision manifest beside the rendered layers", () => {
    const path = resolve(process.cwd(), "public/assets/dungeons/craftpix-showcase.json");
    expect(existsSync(path)).toBe(true);
    const manifest = JSON.parse(readFileSync(path, "utf8")) as {
      tile: number;
      width: number;
      height: number;
      entry: { x: number; y: number };
      stairs: { x: number; y: number };
      collision: string[];
    };
    expect(manifest.tile).toBe(16);
    expect(manifest.width).toBe(38);
    expect(manifest.height).toBe(28);
    expect(manifest.entry).toEqual({ x: 14, y: 24 });
    expect(manifest.stairs).toEqual({ x: 20, y: 4 });
    expect(manifest.collision).toHaveLength(manifest.height);
    expect(manifest.collision.every((row) => row.length === manifest.width)).toBe(true);
    expect(manifest.collision[manifest.entry.y]![manifest.entry.x]).toBe(".");
    expect(manifest.collision[manifest.stairs.y]![manifest.stairs.x]).toBe(".");
  });

  it("ships the full manual-editor sheet catalog and its 48x36 editable sample", () => {
    const catalogPath = resolve(process.cwd(), "public/assets/dungeons/craftpix-tile-catalog.json");
    const samplePath = resolve(process.cwd(), "public/assets/dungeons/manual-showcase-v1.json");
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as { sheets: Record<string, { path: string; frames: number }> };
    const sample = JSON.parse(readFileSync(samplePath, "utf8")) as { width: number; height: number; collision: number[]; layers: Record<string, unknown[]> };
    expect(Object.keys(catalog.sheets)).toHaveLength(11);
    for (const sheet of Object.values(catalog.sheets)) {
      expect(existsSync(resolve(process.cwd(), "public", sheet.path)), sheet.path).toBe(true);
      expect(sheet.frames).toBeGreaterThan(0);
    }
    expect(sample.width).toBe(48);
    expect(sample.height).toBe(36);
    expect(sample.collision).toHaveLength(48 * 36);
    expect(Object.keys(sample.layers)).toEqual(["ground", "structure", "decoration", "overhead", "light"]);
  });

  it("ships Tiled animation clips with per-frame durations", () => {
    const catalogPath = resolve(process.cwd(), "public/assets/dungeons/craftpix-animation-catalog.json");
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as { clips: Array<{ id: string; frames: Array<{ frame: number; duration: number }> }> };
    expect(catalog.clips.length).toBeGreaterThan(200);
    expect(catalog.clips.some((clip) => clip.id.startsWith("water-details:"))).toBe(true);
    expect(catalog.clips.every((clip) => clip.frames.every((frame) => frame.duration > 0))).toBe(true);
  });

  it("ships source-faithful Tiled sheets, animations, and editable map samples", () => {
    const catalogPath = resolve(process.cwd(), "public/assets/craftpix/tiled-map-catalog.json");
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as {
      version: number;
      tileSize: number;
      sheets: Array<{ id: string; path: string; columns: number; frames: number; animationMode: "none" | "tile" | "composite"; usageMode: "tile" | "metatile" }>;
      animations: Array<{ frames: Array<{ frame: number; duration: number }> }>;
      prefabs: Array<{ sheet: string; width: number; height: number; placements: unknown[] }>;
      audit: Array<{ sheet: string; animationMode: "none" | "tile" | "composite"; usageMode: "tile" | "metatile"; tileAnimationCount: number; integratedPrefabCount: number; sourcePlacementCount: number; prefabPlacementCount: number; coverageBasis: "tile" | "source-map" | "png-alpha"; definitionPlacementCount: number; definitionCoverage: boolean; rule: string }>;
      sourceMaps: Array<{ id: string; bounds: { width: number; height: number }; layers: unknown[] }>;
    };
    expect(catalog.version).toBe(2);
    expect(catalog.tileSize).toBe(16);
    expect(catalog.sheets).toHaveLength(62);
    for (const sheet of catalog.sheets) {
      expect(existsSync(resolve(process.cwd(), "public", sheet.path)), sheet.path).toBe(true);
      expect(sheet.columns).toBeGreaterThan(0);
      expect(sheet.frames).toBeGreaterThan(0);
    }
    expect(catalog.animations.length).toBeGreaterThan(1200);
    expect(catalog.animations.every((clip) => clip.frames.every((frame) => frame.duration > 0))).toBe(true);
    expect(catalog.sheets.find((sheet) => sheet.id === "guild-hall-mage3")?.animationMode).toBe("composite");
    expect(catalog.sheets.find((sheet) => sheet.id === "guild-hall-flags-animation")?.animationMode).toBe("composite");
    expect(catalog.prefabs.find((prefab) => prefab.sheet === "guild-hall-mage3")).toMatchObject({ width: 4, height: 3, placements: expect.any(Array) });
    expect(catalog.prefabs.find((prefab) => prefab.sheet === "guild-hall-flags-animation")).toMatchObject({ width: 6, height: 3, placements: expect.any(Array) });
    expect(catalog.sheets.find((sheet) => sheet.id === "dungeon-base-walls-floor")?.usageMode).toBe("metatile");
    const wallPrefabs = catalog.prefabs.filter((prefab) => prefab.sheet === "dungeon-base-walls-floor");
    expect(wallPrefabs).toHaveLength(30);
    expect(wallPrefabs.reduce((total, prefab) => total + prefab.placements.length, 0)).toBe(280);
    expect(catalog.audit.find((entry) => entry.sheet === "dungeon-base-walls-floor")).toMatchObject({
      coverageBasis: "png-alpha",
      definitionCoverage: true,
    });
    const doorPrefabs = catalog.prefabs.filter((prefab) => prefab.sheet === "dungeon-base-doors-lever-chest-animation");
    expect(doorPrefabs).toHaveLength(14);
    expect(doorPrefabs.reduce((total, prefab) => total + prefab.placements.length, 0)).toBe(48);
    expect(doorPrefabs).toEqual(expect.arrayContaining([
      expect.objectContaining({ width: 2, height: 2 }),
      expect.objectContaining({ width: 2, height: 3 }),
    ]));
    for (const sheet of ["dungeon-objects-other-objects", "dungeon-objects-pedestals", "dungeon-objects-supplies-objects"]) {
      expect(catalog.audit.find((entry) => entry.sheet === sheet)).toMatchObject({
        usageMode: "metatile",
        coverageBasis: "png-alpha",
        definitionCoverage: true,
      });
    }
    expect(catalog.audit).toHaveLength(catalog.sheets.length);
    expect(catalog.audit.every((entry) => entry.usageMode !== "metatile" || entry.integratedPrefabCount > 0 && entry.rule === "metatile-only")).toBe(true);
    expect(catalog.audit.every((entry) => entry.usageMode !== "metatile" || entry.definitionCoverage && entry.prefabPlacementCount === entry.definitionPlacementCount)).toBe(true);
    expect(catalog.audit.every((entry) => entry.tileAnimationCount === 0 || entry.animationMode === "tile" || entry.animationMode === "composite")).toBe(true);
    expect(catalog.sourceMaps.map((map) => map.id)).toEqual(expect.arrayContaining(["Dungeon1", "home-exterior", "home-interior"]));
    expect(catalog.sourceMaps.every((map) => map.bounds.width > 0 && map.bounds.height > 0 && map.layers.length > 0)).toBe(true);
  });

  it("ships the imported Craftpix runtime manifest, actors, UI, and environment sheets", () => {
    const manifestPath = resolve(process.cwd(), "public/assets/craftpix/runtime-manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      assets: Array<{ path: string }>;
      actors: Array<{ path: string }>;
      ui: Array<{ path: string }>;
    };
    expect(manifest.assets.length).toBeGreaterThan(700);
    expect(manifest.actors.length).toBeGreaterThanOrEqual(78);
    expect(manifest.ui.length).toBeGreaterThanOrEqual(15);
    for (const entry of [...manifest.assets, ...manifest.actors, ...manifest.ui]) expect(existsSync(resolve(process.cwd(), "public", entry.path)), entry.path).toBe(true);
  });
});
