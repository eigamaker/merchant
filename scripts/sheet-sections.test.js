import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { catalogSections, detectSectionBands, sectionBandImage, sectionSheet } from "./sheet-sections.mjs";
import { parseWolfTileGroup, readWolfTileGroups, resolveGroupImages } from "./wolf-tile-groups.mjs";

/**
 * A catalogue sheet: rows of tiles separated by flat caption bands. `layout` is
 * one character per cell row — "b" for a band, "." for content.
 */
function catalogue(layout, columns = 8, tileSize = 16) {
  const png = new PNG({ width: columns * tileSize, height: layout.length * tileSize });
  layout.split("").forEach((kind, row) => {
    for (let y = 0; y < tileSize; y += 1) for (let x = 0; x < png.width; x += 1) {
      const index = ((row * tileSize + y) * png.width + x) * 4;
      // Bands are one flat colour plus a little caption; content rows vary.
      const band = kind === "b";
      const caption = band && x % 17 === 0;
      png.data[index] = band ? (caption ? 220 : 89) : (x * 7 + row * 31) % 256;
      png.data[index + 1] = band ? (caption ? 140 : 89) : (y * 13 + row * 17) % 256;
      png.data[index + 2] = band ? (caption ? 40 : 89) : (x * 3 + y * 5) % 256;
      png.data[index + 3] = 255;
    }
  });
  return png;
}

/** Encodes strings the way a `.tile` file does: uint32 LE length including the NUL. */
function tileFile(label, images) {
  const encode = (text, encoding) => {
    const body = Buffer.concat([Buffer.from(text, encoding), Buffer.from([0])]);
    const length = Buffer.alloc(4);
    length.writeUInt32LE(body.length);
    return Buffer.concat([length, body]);
  };
  return Buffer.concat([Buffer.alloc(15), encode(label, "latin1"), ...images.map((image) => encode(image, "latin1"))]);
}

describe("section catalogue sheets", () => {
  it("finds the caption bands and splits the sheet between them", () => {
    const sections = catalogSections(catalogue("b..b...b....."));
    expect(sections).toHaveLength(3);
    expect(sections.map((section) => [section.fromRow, section.toRow])).toEqual([[1, 2], [4, 6], [8, 12]]);
    expect(sections[2]).toMatchObject({ columns: 8, rows: 5, frameCount: 40 });
  });

  it("ignores a sheet with too few bands to be a catalogue", () => {
    expect(detectSectionBands(catalogue("b....b......."))).toEqual([]);
    expect(catalogSections(catalogue(".............") )).toEqual([]);
  });

  it("crops a section without its band, and the band on its own", () => {
    const sheet = catalogue("b..b...b.....");
    const [, second] = catalogSections(sheet);
    const cropped = PNG.sync.read(sectionSheet(sheet, second));
    expect(cropped).toMatchObject({ width: 128, height: 3 * 16 });
    // The first cropped row must be content, not the band's flat grey.
    expect([cropped.data[0], cropped.data[1], cropped.data[2]]).not.toEqual([89, 89, 89]);
    const band = PNG.sync.read(sectionBandImage(sheet, second));
    expect(band).toMatchObject({ width: 128, height: 16 });
    expect([band.data[4], band.data[5], band.data[6]]).toEqual([89, 89, 89]);
  });
});

describe("wolf tileset groups", () => {
  it("reads the label and the ordered image list", () => {
    const group = parseWolfTileGroup(tileFile("cave", ["MapChip/base.png", "MapChip/wall.png"]), "001.tile");
    expect(group).toMatchObject({ label: "cave", images: ["MapChip/base.png", "MapChip/wall.png"] });
  });

  it("decodes a Shift-JIS label", () => {
    const label = Buffer.from([0x83, 0x5f, 0x83, 0x93, 0x83, 0x57, 0x83, 0x87, 0x83, 0x93]).toString("latin1");
    const group = parseWolfTileGroup(tileFile(label, ["MapChip/base.png"]), "001.tile");
    expect(group.label).toBe("ダンジョン");
  });

  it("skips settings files that name no images", () => {
    const files = new Map([["a.tile", tileFile("empty", [])], ["b.tile", tileFile("cave", ["MapChip/base.png"])]]);
    expect(readWolfTileGroups(files).map((group) => group.label)).toEqual(["cave"]);
  });

  it("matches recorded paths onto the archive's actual entries", () => {
    const files = new Map([["pack/MapChip/base.png", Buffer.alloc(1)], ["pack/MapChip/wall.png", Buffer.alloc(1)]]);
    const resolved = resolveGroupImages({ label: "cave", images: ["MapChip/base.png", "MapChip/missing.png", "MapChip/wall.png"] }, files);
    expect(resolved.images).toEqual(["pack/MapChip/base.png", "pack/MapChip/wall.png"]);
  });
});
