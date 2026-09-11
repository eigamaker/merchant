import fs from "node:fs";
import { propFrameGeometry } from './propGeometry';
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { ACTOR_CATALOG } from "./actorCatalog";
import { MAP_ASSET_CATALOG } from "./mapAssetCatalog.generated";
import { createHomeMap } from "./homeMap";
import { findHomeVisitorPath } from "./homeVisitors";
import { createManualMap, normalizeMap } from "./mapDocument";
import retired from "../../assets-src/unified/retired-map-ids.json";

describe("unified art integration", () => {
  it("ships visible, animated four-direction clips for every registered actor", () => {
    for (const actor of Object.values(ACTOR_CATALOG)) {
      for (const action of ["idle", "walk", "run", "attack", "hurt", "death", "interact", "cast"] as const) {
        const clip = actor.clips[action]!;
        expect(clip, `${actor.id}/${action}`).toBeDefined();
        const png = PNG.sync.read(fs.readFileSync(`public/${clip.path.replace(/^\//, "")}`));
        expect([png.width, png.height]).toEqual([128, 128]);
        expect(new Set(clip.directions).size).toBe(4);
        for (let row = 0; row < 4; row++) {
          const frames: string[] = [];
          for (let column = 0; column < 4; column++) {
            const frame = new PNG({ width: 32, height: 32 });
            PNG.bitblt(png, frame, column * 32, row * 32, 32, 32, 0, 0);
            const alpha = Array.from(frame.data).filter((_, i) => i % 4 === 3);
            expect(alpha.some(a => a === 0)).toBe(true);
            expect(alpha.some(a => a > 0), `${actor.id}/${action}/${row}/${column}`).toBe(true);
            frames.push(frame.data.toString("base64"));
          }
          expect(new Set(frames).size, `${actor.id}/${action}/${row} changes pose`).toBeGreaterThan(1);
        }
      }
    }
  });

  it("blocks every authored solid footprint and connects every doorway to the shop", () => {
    const home = createHomeMap();
    const assets = new Map<string, typeof MAP_ASSET_CATALOG[number]>(MAP_ASSET_CATALOG.map(a => [a.id, a]));
    const spawn = home.markers.find(m => m.kind === "homeSpawn")!;
    let doors = 0, solids = 0;
    for (const [layer, cells] of Object.entries(home.layers)) for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (!cell) continue;
      const asset = assets.get(cell.assetId)!;
      expect(asset, cell.assetId).toBeDefined();
      expect(cell.frame).toBeLessThan(asset.frameCount);
      if (!asset.defaultWalkable && !propFrameGeometry(cell.assetId, cell.frame)?.walkable) {
        expect(home.collision[i], `${cell.assetId} at ${i % home.width},${Math.floor(i / home.width)}`).toBe(false);
        solids++;
      }
      if (layer === "decoration" && cell.assetId.endsWith("door")) {
        expect(home.collision[i]).toBe(true);
        expect(findHomeVisitorPath(home, spawn, { x: i % home.width, y: Math.floor(i / home.width) }).length).toBeGreaterThan(0);
        doors++;
      }
    }
    expect(solids).toBeGreaterThan(100);
    expect(doors).toBe(16);
  });

  it.each([16, 32] as const)("migrates retired %ipx art while preserving manual collision and markers", tileSize => {
    const old = retired[0]; // The same source sheet can be stamped onto either map grid.
    const map = createManualMap("dungeon", { width: 4, height: 4, tileSize });
    map.layers.ground[5] = { assetId: old.id, frame: 0 };
    map.layers.structure[6] = { assetId: old.id, frame: 0 };
    map.collision[5] = true;
    map.markers = [{ id: "up", kind: "stairsUp", x: 1, y: 1, visual: { assetId: old.id, frame: 0 } }];
    const migrated = normalizeMap(map);
    expect(migrated.collision).toEqual(map.collision);
    expect(migrated.layers.ground[5]?.assetId).toBe(tileSize === 16 ? "unified.cave-floor" : "unified.compat-floor32");
    expect(migrated.layers.structure[6]?.assetId).toBe(tileSize === 16 ? "unified.cave-wall" : "unified.compat-wall32");
    expect(migrated.markers[0]).toMatchObject({ x: 1, y: 1, visual: { assetId: tileSize === 16 ? "unified.stairs" : "unified.compat-stairs32" } });
    expect(map.layers.ground[5]?.assetId).toBe(old.id);
  });
});
