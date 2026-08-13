import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { createHash } from "node:crypto";

type RequiredPng = readonly [path: string, width: number, height: number];

const requiredPngs: RequiredPng[] = [
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
      expect(header.colorType, path).toBe(6);
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
});
