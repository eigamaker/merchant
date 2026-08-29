/**
 * Section-catalogue sheets.
 *
 * Some packs ship one very large sheet whose categories are separated by a
 * header band drawn into the image itself — a full-width row of one flat colour
 * carrying a caption.  mapchip2's `base.png` is 2,336 frames split into 31 such
 * sections ("地面", "ダン 床・壁・階段", "破壊 壁用" …).
 *
 * The captions are pixel art, so nothing here reads them.  Detection finds the
 * band rows; the author names the sections once in the import review, helped by
 * a cropped image of each band.
 */
import { PNG } from "pngjs";

/** A band is background plus a caption, so it stays well under this. */
const MAX_BAND_COLOURS = 24;
/** The caption must leave most of the band showing its background colour. */
const MIN_BACKGROUND_SHARE = 0.3;
/** One or two flat rows are a coincidence; a catalogue repeats its band. */
const MIN_BANDS = 3;

function rowProfile(png, row, tileSize) {
  const counts = new Map();
  let opaque = 0;
  for (let y = 0; y < tileSize; y += 1) for (let x = 0; x < png.width; x += 1) {
    const index = ((row * tileSize + y) * png.width + x) * 4;
    if (png.data[index + 3] !== 255) continue;
    opaque += 1;
    const key = (png.data[index] << 16) | (png.data[index + 1] << 8) | png.data[index + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (opaque !== png.width * tileSize) return undefined;
  let dominant = 0, best = 0;
  for (const [key, count] of counts) if (count > best) { best = count; dominant = key; }
  return { colours: counts.size, dominant, share: best / opaque };
}

/**
 * Finds the header band rows. A band colour has to repeat down the sheet, which
 * is what separates a caption band from an ordinary row of flat-coloured tiles.
 */
export function detectSectionBands(png, tileSize = 16) {
  if (png.height % tileSize !== 0 || png.width % tileSize !== 0) return [];
  const rows = png.height / tileSize;
  const candidates = [];
  for (let row = 0; row < rows; row += 1) {
    const profile = rowProfile(png, row, tileSize);
    if (profile && profile.colours <= MAX_BAND_COLOURS && profile.share >= MIN_BACKGROUND_SHARE) candidates.push({ row, ...profile });
  }
  const byColour = new Map();
  for (const candidate of candidates) {
    if (!byColour.has(candidate.dominant)) byColour.set(candidate.dominant, []);
    byColour.get(candidate.dominant).push(candidate.row);
  }
  let bands = [];
  for (const rowsForColour of byColour.values()) if (rowsForColour.length > bands.length) bands = rowsForColour;
  return bands.length >= MIN_BANDS ? bands : [];
}

/** Splits a sheet at its band rows. Bands themselves are never part of a section. */
export function catalogSections(png, tileSize = 16) {
  const bands = detectSectionBands(png, tileSize);
  if (!bands.length) return [];
  const rows = png.height / tileSize;
  const columns = png.width / tileSize;
  return bands.map((band, position) => {
    const fromRow = band + 1;
    const toRow = (bands[position + 1] ?? rows) - 1;
    return { index: position, bandRow: band, fromRow, toRow, rows: toRow - fromRow + 1, columns, frameCount: Math.max(0, toRow - fromRow + 1) * columns };
  }).filter((section) => section.rows > 0);
}

function cropRows(png, fromRow, toRow, tileSize) {
  const height = (toRow - fromRow + 1) * tileSize;
  const output = new PNG({ width: png.width, height });
  for (let y = 0; y < height; y += 1) {
    const from = ((fromRow * tileSize + y) * png.width) * 4;
    png.data.copy(output.data, y * png.width * 4, from, from + png.width * 4);
  }
  return PNG.sync.write(output);
}

/** The section's own tiles, as a standalone sheet. */
export function sectionSheet(png, section, tileSize = 16) {
  return cropRows(png, section.fromRow, section.toRow, tileSize);
}

/** The caption band, so the import review can show what the section is called. */
export function sectionBandImage(png, section, tileSize = 16) {
  return cropRows(png, section.bandRow, section.bandRow, tileSize);
}
