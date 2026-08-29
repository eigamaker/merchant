/**
 * Blob autotiling for expanded tile sheets.
 *
 * The importer turns a WOLF RPG Editor autotile into a sheet of 47 tiles per
 * animation frame (`scripts/autotile.mjs`).  The mapping from neighbours to tile
 * is a property of the scheme rather than of any one sheet, so it lives here
 * once instead of being written into every generated catalogue entry.
 *
 * `scripts/autotile.test.js` asserts that this table and the importer's agree.
 */

/** Neighbour bits, clockwise from north. */
export const N = 1, NE = 2, E = 4, SE = 8, S = 16, SW = 32, W = 64, NW = 128;

export const BLOB47_TILE_COUNT = 47;

/** A diagonal only changes the tile when both of its orthogonal neighbours are present. */
export function reduceNeighbourMask(mask: number): number {
  let result = mask;
  if ((mask & (N | E)) !== (N | E)) result &= ~NE;
  if ((mask & (E | S)) !== (E | S)) result &= ~SE;
  if ((mask & (S | W)) !== (S | W)) result &= ~SW;
  if ((mask & (W | N)) !== (W | N)) result &= ~NW;
  return result;
}

function buildTable(): { masks: number[]; frameByMask: number[] } {
  const masks = [...new Set(Array.from({ length: 256 }, (_, mask) => reduceNeighbourMask(mask)))].sort((a, b) => a - b);
  const index = new Map(masks.map((mask, position) => [mask, position]));
  return { masks, frameByMask: Array.from({ length: 256 }, (_, mask) => index.get(reduceNeighbourMask(mask))!) };
}

const table = buildTable();

/** The distinct reduced masks, in the order the expanded sheet stores them. */
export const BLOB47_MASKS: readonly number[] = table.masks;
/** Any of the 256 raw neighbour masks to its tile index within one animation frame. */
export const BLOB47_FRAME_BY_MASK: readonly number[] = table.frameByMask;

/** Eight-neighbour mask for a cell, given a predicate for "same terrain". */
export function neighbourMask(x: number, y: number, same: (x: number, y: number) => boolean): number {
  return (same(x, y - 1) ? N : 0) | (same(x + 1, y - 1) ? NE : 0)
    | (same(x + 1, y) ? E : 0) | (same(x + 1, y + 1) ? SE : 0)
    | (same(x, y + 1) ? S : 0) | (same(x - 1, y + 1) ? SW : 0)
    | (same(x - 1, y) ? W : 0) | (same(x - 1, y - 1) ? NW : 0);
}

/** Frame index inside an expanded blob sheet. Animation frames are whole rows. */
export function blobFrame(mask: number, animationFrame = 0, animationFrames = 1): number {
  const frame = animationFrames > 0 ? ((animationFrame % animationFrames) + animationFrames) % animationFrames : 0;
  return frame * BLOB47_TILE_COUNT + BLOB47_FRAME_BY_MASK[mask & 0xff]!;
}
