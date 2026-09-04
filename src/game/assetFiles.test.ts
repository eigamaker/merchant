import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { ITEM_VISUALS } from "./merchantContent";

const requiredPngs: readonly [string, number, number][] = [
  ["public/assets/map-tiles/home-floor.png", 16, 16],
  ["public/assets/map-tiles/home-wall.png", 64, 64],
  ["public/assets/map-tiles/dungeon-floor.png", 16, 16],
  ["public/assets/map-tiles/dungeon-wall.png", 64, 64],
  ["public/assets/actors/player.png", 128, 128],
  ["public/assets/actors/npc-innkeeper.png", 128, 128],
  ["public/assets/actors/guard-rolf.png", 128, 128],
  ["public/assets/actors/guard-mina.png", 128, 128],
  ["public/assets/objects/items.png", 192, 96],
  ["public/assets/objects/dungeon_objects.png", 192, 96],
  ["public/assets/ui/craftpix/Buttons.png", 400, 528],
];

describe("runtime pixel-art assets", () => {
  it("ships the four map tiles and retained actor/object contracts", () => {
    for (const [path, width, height] of requiredPngs) {
      expect(existsSync(resolve(process.cwd(), path)), path).toBe(true);
      const bytes = readFileSync(resolve(process.cwd(), path));
      const image = PNG.sync.read(bytes);
      expect(image.width, path).toBe(width);
      expect(image.height, path).toBe(height);
      expect(bytes[25], path).toBe(6); // RGBA
    }
  });

  it("ships one transparent 32px sprite for every merchant item visual", () => {
    // 品目は増える。守るのは枚数ではなく、**定義した品には必ず絵がある**という契約。
    expect(Object.keys(ITEM_VISUALS).length).toBeGreaterThanOrEqual(19);
    for (const [visualId, assetPath] of Object.entries(ITEM_VISUALS)) {
      const path = resolve(process.cwd(), "public", assetPath);
      expect(existsSync(path), visualId).toBe(true);
      const image = PNG.sync.read(readFileSync(path));
      expect([image.width, image.height], visualId).toEqual([32, 32]);
      const alphas = Array.from({ length: image.width * image.height }, (_, index) => image.data[index * 4 + 3]);
      expect(alphas.some((alpha) => alpha === 0), `${visualId} transparent padding`).toBe(true);
      expect(alphas.some((alpha) => alpha > 0), `${visualId} visible pixels`).toBe(true);
    }
  });
});
