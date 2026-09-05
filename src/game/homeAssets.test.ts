import fs from "node:fs";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import palettes from "../../assets-src/map-tiles/palettes.json";
import { createHomeMap } from "./homeMap";
import { createManualMap, validateMap } from "./mapDocument";
import { paletteStamp, paintPaletteStamp, type PalettePage } from "../review/paletteModel";

const furniture = palettes.pages.find(page => page.id === "home-furniture")! as PalettePage;
const attributes = { mode: "palette", layer: "decoration", collision: "unchanged" } as const;

describe("modular home assets", () => {
  it("has independent transparent sheets for all furniture, without a room backdrop", () => {
    const ids = [...new Set(furniture.cells.map(cell => cell.assetId))];
    expect(ids).toHaveLength(12);
    for (const id of ids) {
      const png = PNG.sync.read(fs.readFileSync(`public/assets/map-tiles/generated/${id}.png`));
      const alpha = Array.from(png.data).filter((_, i) => i % 4 === 3);
      expect(alpha.includes(0), id).toBe(true);
      expect(alpha.includes(255), id).toBe(true);
    }
    const home = createHomeMap();
    expect(home.layers.ground.every(cell => cell?.assetId === "home.merchant-floor")).toBe(true);
    expect(Object.values(home.layers).flat().some(cell => cell?.assetId === "home.merchant-room")).toBe(false);
    for (const id of ids) expect(Object.values(home.layers).flat().some(cell => cell?.assetId === id), id).toBe(true);
  });

  it("places the same counter twice on different floors with the standard editor stamp", () => {
    const map = createManualMap("home", { width:14, height:10, tileSize:16 });
    map.layers.ground.fill({assetId:"home.merchant-floor",frame:0});
    map.collision.fill(true);
    map.markers = createHomeMap().markers.filter(marker => ["homeSpawn", "dungeonEntrance", "homePreparation", "homeVisitors"].includes(marker.kind));
    const counter = paletteStamp(furniture, {x:5,y:4,width:4,height:2});
    for (const target of [{x:1,y:2},{x:7,y:5}]) {
      expect(paintPaletteStamp(map, counter, target, attributes)).toBe(true);
      for (let y=0;y<2;y++) for (let x=0;x<4;x++) {
        const index = (target.y+y)*map.width+target.x+x;
        expect(map.layers.ground[index]?.assetId).toBe("home.merchant-floor");
        expect(map.layers.decoration[index]).toEqual({assetId:"home.merchant-counter",frame:y*4+x});
        expect(map.collision[index]).toBe(false);
      }
    }
    expect(validateMap(map)).toEqual([]);
  });

  it("keeps the carpet underneath furniture and blocks only the furniture footprint", () => {
    const map = createManualMap("home", {width:8,height:8,tileSize:16});
    map.layers.ground.fill({assetId:"home.merchant-floor",frame:0});
    const rug = paletteStamp(furniture,{x:0,y:4,width:4,height:3});
    const table = paletteStamp(furniture,{x:10,y:0,width:2,height:2});
    paintPaletteStamp(map,rug,{x:2,y:2},attributes);
    paintPaletteStamp(map,table,{x:3,y:2},attributes);
    expect(map.layers.structure[2*8+3]?.assetId).toBe("home.merchant-rug");
    expect(map.layers.decoration[2*8+3]?.assetId).toBe("home.merchant-table");
    expect(map.collision[2*8+3]).toBe(false);
    expect(map.collision[4*8+2]).toBe(true);
  });
});
