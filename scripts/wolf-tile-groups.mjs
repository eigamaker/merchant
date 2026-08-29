/**
 * WOLF RPG Editor `.tile` tileset settings.
 *
 * A pack that ships `.tile` files has already been grouped by its author:
 * mapchip2 carries 街 / ダンジョン / 森 / ワールドマップ, each naming one
 * catalogue sheet plus the autotiles that belong with it.  That grouping is the
 * first draft of a dungeon theme, so it is worth reading even though the rest of
 * the format (collision flags, tile counts) is not used here.
 *
 * Strings are stored as `<uint32 LE byteLength><bytes>`, the length including a
 * trailing NUL, and the text is Shift-JIS.
 */

const MAX_STRING_BYTES = 512;
/** The fixed preamble is short and undocumented; the label sits just past it. */
const HEADER_SEARCH_LIMIT = 32;

function readString(bytes, offset) {
  if (offset + 4 > bytes.length) return undefined;
  const length = bytes.readUInt32LE(offset);
  if (length < 1 || length > MAX_STRING_BYTES || offset + 4 + length > bytes.length) return undefined;
  const raw = bytes.subarray(offset + 4, offset + 4 + length);
  if (raw[raw.length - 1] !== 0) return undefined;
  return { text: raw.subarray(0, raw.length - 1), next: offset + 4 + length };
}

function decodeShiftJis(raw) {
  const collapse = (value) => value.replace(/[\s　]+/g, " ").trim();
  try {
    return collapse(new TextDecoder("shift_jis").decode(raw));
  } catch {
    return collapse(raw.toString("latin1"));
  }
}

const isImagePath = (text) => /^[\x20-\x7e]+\.png$/i.test(text);

/**
 * Locates the label. The preamble length is not documented, so anchor on the
 * label being followed immediately by the first image path.
 */
function findLabel(bytes) {
  for (let offset = 0; offset < HEADER_SEARCH_LIMIT; offset += 1) {
    const label = readString(bytes, offset);
    if (!label) continue;
    const following = readString(bytes, label.next);
    if (following && isImagePath(following.text.toString("latin1"))) return label;
  }
  return undefined;
}

/**
 * Reads one `.tile` file into `{ label, images }`.  Images keep their recorded
 * order because the first entry is the catalogue sheet and the rest are the
 * autotiles the author paired with it.
 */
export function parseWolfTileGroup(input, fileName = "") {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const label = findLabel(bytes);
  const images = [];
  let offset = label ? label.next : 0;
  while (offset < bytes.length) {
    const value = readString(bytes, offset);
    if (!value) { offset += 1; continue; }
    const text = value.text.toString("latin1");
    if (isImagePath(text) && !images.includes(text)) images.push(text);
    offset = value.next;
  }
  const decoded = label ? decodeShiftJis(label.text) : "";
  return { file: fileName, label: decoded || fileName.replace(/\.tile$/i, ""), images };
}

/** Reads every `.tile` entry in an archive. Groups without images are ignored. */
export function readWolfTileGroups(files) {
  const groups = [];
  for (const [name, bytes] of files) {
    if (!/\.tile$/i.test(name)) continue;
    try {
      const group = parseWolfTileGroup(bytes, name);
      if (group.images.length) groups.push(group);
    } catch {
      // A settings file we cannot read is not a reason to fail the import.
    }
  }
  return groups;
}

/**
 * Rewrites the recorded image paths onto the archive entries that actually
 * exist, so a group can be matched against the import candidates.
 */
export function resolveGroupImages(group, files) {
  const lookup = new Map([...files.keys()].map((name) => [name.toLowerCase(), name]));
  const resolved = [];
  for (const image of group.images) {
    const direct = lookup.get(image.toLowerCase());
    if (direct) { resolved.push(direct); continue; }
    const suffix = `/${image.toLowerCase()}`;
    const match = [...lookup.entries()].find(([name]) => name.endsWith(suffix));
    if (match) resolved.push(match[1]);
  }
  return { ...group, images: resolved };
}
