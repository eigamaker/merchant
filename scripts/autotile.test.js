import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { BLOB_TILE_COUNT, E, N, NE, NW, S, SE, SW, W, blobTileTable, expandWolfAutotile, reduceNeighbourMask, wolfAutotileDivergence, wolfAutotileGeometry } from "./autotile.mjs";
import { BLOB47_FRAME_BY_MASK, BLOB47_MASKS, BLOB47_TILE_COUNT, blobFrame, neighbourMask, reduceNeighbourMask as reduceInGame } from "../src/game/autotile";

/**
 * Builds a WOLF autotile whose five rows are flat colours, so an expanded tile
 * can be read back quadrant by quadrant as "which row supplied this corner".
 */
function autotileFixture(animationFrames = 1) {
  const png = new PNG({ width: 16 * animationFrames, height: 80 });
  for (let frame = 0; frame < animationFrames; frame += 1) {
    for (let row = 0; row < 5; row += 1) {
      for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) {
        const index = ((row * 16 + y) * png.width + frame * 16 + x) * 4;
        png.data[index] = row * 40;
        png.data[index + 1] = frame * 30;
        png.data[index + 2] = 0;
        png.data[index + 3] = 255;
      }
    }
  }
  return PNG.sync.write(png);
}

const quadrantRow = (sheet, tile, animationFrame, dx, dy) =>
  sheet.data[((animationFrame * 16 + dy) * sheet.width + tile * 16 + dx) * 4] / 40;

describe("wolf autotile", () => {
  it("recognizes the format by geometry only", () => {
    expect(wolfAutotileGeometry(16, 80)).toMatchObject({ tileSize: 16, animationFrames: 1 });
    expect(wolfAutotileGeometry(96, 80)).toMatchObject({ animationFrames: 6 });
    expect(wolfAutotileGeometry(128, 4672)).toBeUndefined();
    expect(wolfAutotileGeometry(24, 80)).toBeUndefined();
    expect(wolfAutotileGeometry(16, 96)).toBeUndefined();
  });

  it("reduces a diagonal only when both of its orthogonal neighbours are present", () => {
    expect(reduceNeighbourMask(NE)).toBe(0);
    expect(reduceNeighbourMask(N | NE)).toBe(N);
    expect(reduceNeighbourMask(N | E | NE)).toBe(N | E | NE);
    expect(reduceNeighbourMask(0xff)).toBe(0xff);
  });

  it("collapses the 256 neighbour combinations onto 47 tiles", () => {
    const { masks, frameByMask } = blobTileTable();
    expect(masks).toHaveLength(BLOB_TILE_COUNT);
    expect(frameByMask).toHaveLength(256);
    expect(new Set(frameByMask).size).toBe(BLOB_TILE_COUNT);
    expect(frameByMask[0]).toBe(0);
    expect(frameByMask[0xff]).toBe(BLOB_TILE_COUNT - 1);
  });

  it("keeps the importer's table and the runtime's table identical", () => {
    const { masks, frameByMask } = blobTileTable();
    expect(BLOB47_TILE_COUNT).toBe(BLOB_TILE_COUNT);
    expect([...BLOB47_MASKS]).toEqual(masks);
    expect([...BLOB47_FRAME_BY_MASK]).toEqual(frameByMask);
    for (let mask = 0; mask < 256; mask += 1) expect(reduceInGame(mask)).toBe(reduceNeighbourMask(mask));
  });

  it("takes each quadrant from the row its three neighbours call for", () => {
    const expanded = expandWolfAutotile(autotileFixture());
    const sheet = PNG.sync.read(expanded.png);
    const { frameByMask } = blobTileTable();
    const northWestRow = (mask) => quadrantRow(sheet, frameByMask[mask], 0, 0, 0);
    expect(northWestRow(0)).toBe(0);                    // nothing adjoins: outer corner
    expect(northWestRow(N)).toBe(1);                    // north only: vertical edge
    expect(northWestRow(W)).toBe(2);                    // west only: horizontal edge
    expect(northWestRow(N | W)).toBe(3);                // both, diagonal open: inner corner
    expect(northWestRow(N | W | NW)).toBe(4);           // fully enclosed: fill
  });

  it("lays animation frames out as whole rows of the blob set", () => {
    const expanded = expandWolfAutotile(autotileFixture(3));
    expect(expanded).toMatchObject({ columns: 47, rows: 3, frameCount: 141, animationFrames: 3 });
    const sheet = PNG.sync.read(expanded.png);
    expect(sheet.width).toBe(47 * 16);
    expect(sheet.height).toBe(3 * 16);
    // Green encodes the animation frame, so row 2 must carry frame 2's colour.
    expect(sheet.data[((2 * 16) * sheet.width) * 4 + 1]).toBe(60);
    expect(blobFrame(0xff, 2, 3)).toBe(2 * 47 + 46);
    expect(blobFrame(0xff, 0, 3)).toBe(46);
  });

  it("rejects an image that is not the right shape", () => {
    const png = PNG.sync.write(new PNG({ width: 16, height: 64 }));
    expect(() => expandWolfAutotile(png)).toThrow(/not a WOLF autotile/);
  });

  it("scores a flat fixture as far from the format and reports it", () => {
    // Every row is a different flat colour, so the island and the fill share no
    // centre — exactly what a grid of five unrelated tiles looks like.
    expect(wolfAutotileDivergence(PNG.sync.read(autotileFixture()))).toBeGreaterThan(0.1);
  });

  it("builds an eight-neighbour mask in the documented bit order", () => {
    const solid = new Set(["0,-1", "1,0"]);
    const mask = neighbourMask(0, 0, (x, y) => solid.has(`${x},${y}`));
    expect(mask).toBe(N | E);
    expect(neighbourMask(0, 0, () => true)).toBe(N | NE | E | SE | S | SW | W | NW);
    expect(neighbourMask(0, 0, () => false)).toBe(0);
  });
});
