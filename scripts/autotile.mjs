/**
 * WOLF RPG Editor (ウディタ) autotile support.
 *
 * A WOLF autotile is not a grid of tiles.  It is `(16 * animationFrames) x 80`
 * pixels: five stacked 16px rows, each supplying four 8x8 quadrants of the
 * finished tile.  Extra 16px columns are animation frames of the whole set.
 *
 *   row 0  outer corner (the isolated island)
 *   row 1  vertical edge   — the horizontal neighbour is a different terrain
 *   row 2  horizontal edge — the vertical neighbour is a different terrain
 *   row 3  inner corner    — only the diagonal differs
 *   row 4  fill            — every neighbour is the same terrain
 *
 * Composing the four quadrants from the right rows yields the canonical 47-tile
 * blob set, which covers all 256 eight-neighbour combinations.
 */
import { PNG } from "pngjs";

export const WOLF_AUTOTILE_ROWS = 5;
export const WOLF_AUTOTILE_HEIGHT = 80;
export const WOLF_AUTOTILE_TILE_SIZE = 16;
export const BLOB_TILE_COUNT = 47;

/** Neighbour bits, clockwise from north. */
export const N = 1, NE = 2, E = 4, SE = 8, S = 16, SW = 32, W = 64, NW = 128;

/** A diagonal only changes the tile when both of its orthogonal neighbours are present. */
export function reduceNeighbourMask(mask) {
  let result = mask;
  if ((mask & (N | E)) !== (N | E)) result &= ~NE;
  if ((mask & (E | S)) !== (E | S)) result &= ~SE;
  if ((mask & (S | W)) !== (S | W)) result &= ~SW;
  if ((mask & (W | N)) !== (W | N)) result &= ~NW;
  return result;
}

/**
 * The canonical blob set: the distinct reduced masks in ascending order, and the
 * 256-entry lookup that maps any raw neighbour mask onto its tile index.
 */
export function blobTileTable() {
  const masks = [...new Set(Array.from({ length: 256 }, (_, mask) => reduceNeighbourMask(mask)))].sort((a, b) => a - b);
  const index = new Map(masks.map((mask, position) => [mask, position]));
  const frameByMask = Array.from({ length: 256 }, (_, mask) => index.get(reduceNeighbourMask(mask)));
  return { masks, frameByMask };
}

/** Which of the five source rows supplies a quadrant. */
function sourceRow(vertical, horizontal, diagonal) {
  if (!vertical && !horizontal) return 0;
  if (vertical && !horizontal) return 1;
  if (!vertical && horizontal) return 2;
  return diagonal ? 4 : 3;
}

const QUADRANTS = [
  { dx: 0, dy: 0, vertical: N, horizontal: W, diagonal: NW },
  { dx: 8, dy: 0, vertical: N, horizontal: E, diagonal: NE },
  { dx: 0, dy: 8, vertical: S, horizontal: W, diagonal: SW },
  { dx: 8, dy: 8, vertical: S, horizontal: E, diagonal: SE },
];

/** Returns the animation frame count when the dimensions are a WOLF autotile. */
export function wolfAutotileGeometry(width, height) {
  if (height !== WOLF_AUTOTILE_HEIGHT || width < WOLF_AUTOTILE_TILE_SIZE || width % WOLF_AUTOTILE_TILE_SIZE !== 0) return undefined;
  return { tileSize: WOLF_AUTOTILE_TILE_SIZE, animationFrames: width / WOLF_AUTOTILE_TILE_SIZE, tileCount: BLOB_TILE_COUNT };
}

/**
 * How strongly the pixels agree with the format, as 0..1 where 0 is a perfect
 * match.  The island (row 0) and the fill (row 4) are the same terrain in the
 * middle of the tile and differ only at the edges, which a grid of five
 * unrelated tiles does not reproduce.  Geometry decides the format; this only
 * grades the confidence shown to the author.
 */
export function wolfAutotileDivergence(png) {
  const at = (x, y) => ((y * png.width) + x) * 4;
  let total = 0;
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) {
    const island = at(4 + x, 4 + y);
    const fill = at(4 + x, 4 * 16 + 4 + y);
    total += Math.abs(png.data[island] - png.data[fill])
      + Math.abs(png.data[island + 1] - png.data[fill + 1])
      + Math.abs(png.data[island + 2] - png.data[fill + 2])
      + Math.abs(png.data[island + 3] - png.data[fill + 3]);
  }
  return total / 64 / 1020;
}

/** Above this the pixels look nothing like an autotile and the author should confirm. */
export const WOLF_AUTOTILE_DIVERGENCE_LIMIT = 0.25;

function copyQuadrant(source, animationFrame, row, quadrant, target, targetWidth, originX, originY) {
  const sourceX = animationFrame * 16 + quadrant.dx;
  const sourceY = row * 16 + quadrant.dy;
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) {
    const from = ((sourceY + y) * source.width + sourceX + x) * 4;
    const to = ((originY + quadrant.dy + y) * targetWidth + originX + quadrant.dx + x) * 4;
    target[to] = source.data[from];
    target[to + 1] = source.data[from + 1];
    target[to + 2] = source.data[from + 2];
    target[to + 3] = source.data[from + 3];
  }
}

/**
 * Expands a WOLF autotile into the 47-tile blob set.
 *
 * The sheet is one row of 47 tiles per animation frame, so a frame index is
 * `animationFrame * 47 + frameByMask[neighbourMask]`.
 */
export function expandWolfAutotile(bytes) {
  const source = PNG.sync.read(bytes);
  const geometry = wolfAutotileGeometry(source.width, source.height);
  if (!geometry) throw new Error(`${source.width}x${source.height} is not a WOLF autotile`);
  const { masks, frameByMask } = blobTileTable();
  const width = masks.length * 16;
  const height = geometry.animationFrames * 16;
  const output = new PNG({ width, height });
  output.data.fill(0);
  for (let animationFrame = 0; animationFrame < geometry.animationFrames; animationFrame += 1) {
    masks.forEach((mask, tile) => {
      for (const quadrant of QUADRANTS) {
        const row = sourceRow(Boolean(mask & quadrant.vertical), Boolean(mask & quadrant.horizontal), Boolean(mask & quadrant.diagonal));
        copyQuadrant(source, animationFrame, row, quadrant, output.data, width, tile * 16, animationFrame * 16);
      }
    });
  }
  return {
    png: PNG.sync.write(output),
    tileSize: WOLF_AUTOTILE_TILE_SIZE,
    columns: masks.length,
    rows: geometry.animationFrames,
    frameCount: masks.length * geometry.animationFrames,
    animationFrames: geometry.animationFrames,
    divergence: wolfAutotileDivergence(source),
    autotile: { scheme: "blob47", animationFrames: geometry.animationFrames, frameByMask },
  };
}
