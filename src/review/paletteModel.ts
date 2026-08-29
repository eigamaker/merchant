/**
 * The authored tile palette is deliberately independent from the map format.
 * A map stores asset/frame references, never a palette coordinate, so authors
 * can reorganise pages without invalidating existing maps.
 */
export type PaletteMapKind = "home" | "dungeon";
export type PaletteTileSize = 16 | 32;
export type PaletteLayer = "ground" | "structure" | "decoration";
/**
 * What a tile is for, independent of which layer it happens to be drawn on.
 * This is the vocabulary the dungeon themes shop from, so a shelf can be
 * filtered down to "the floors" or "the props" instead of every frame at once.
 */
export type PaletteCellRole = "floor" | "wall" | "prop" | "stairs" | "liquid";
/** Whether the author has decided a tile is usable. Absent means not yet triaged. */
export type PaletteCellStatus = "ready" | "unsorted" | "rejected";
export const PALETTE_CELL_ROLES: readonly PaletteCellRole[] = ["floor", "wall", "prop", "stairs", "liquid"];
export const PALETTE_CELL_STATUSES: readonly PaletteCellStatus[] = ["ready", "unsorted", "rejected"];
/** Large authored workspaces are sparse; only populated cells are persisted. */
export const MAX_PALETTE_DIMENSION = 4096;

export interface PaletteCell {
  x: number;
  y: number;
  assetId: string;
  frame: number;
  layer: PaletteLayer;
  walkable: boolean;
  role?: PaletteCellRole;
  status?: PaletteCellStatus;
  /** Why a tile was rejected, so the same sheet is not re-judged later. */
  note?: string;
}

export interface PalettePage {
  id: string;
  label: string;
  mapKind: PaletteMapKind;
  tileSize: PaletteTileSize;
  width: number;
  height: number;
  cells: PaletteCell[];
}

export interface PaletteLayout {
  version: 1;
  pages: PalettePage[];
}

export interface PaletteAsset {
  id: string;
  label: string;
  path: string;
  mapKinds: readonly PaletteMapKind[];
  tileSize: PaletteTileSize;
  margin: number;
  spacing: number;
  columns: number;
  rows: number;
  frameCount: number;
  defaultLayer: PaletteLayer;
  defaultWalkable: boolean;
}

export interface CellPoint { x: number; y: number; }
export interface CellRect { x: number; y: number; width: number; height: number; }
export interface PaletteStamp {
  width: number;
  height: number;
  /** Row-major. Null values intentionally preserve the destination map. */
  cells: Array<PaletteCell | null>;
}

export type CollisionMode = "unchanged" | "walkable" | "blocked";
export type StampAttributeMode = "palette" | "manual";

export interface StampAttributes {
  mode: StampAttributeMode;
  layer: PaletteLayer;
  collision: CollisionMode;
}

export interface StampMapCell {
  assetId: string;
  frame: number;
}

/** Minimal mutable adapter used by the review editor and model tests. */
export interface StampMap {
  width: number;
  height: number;
  layers: Record<PaletteLayer, Array<StampMapCell | null>>;
  collision: boolean[];
}

const layers: PaletteLayer[] = ["ground", "structure", "decoration"];
const cloneCell = (cell: PaletteCell): PaletteCell => ({ ...cell });
const keyOf = (x: number, y: number) => `${x},${y}`;
const inside = (width: number, height: number, x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;

export function clonePaletteLayout(layout: PaletteLayout): PaletteLayout {
  return { version: 1, pages: layout.pages.map((page) => ({ ...page, cells: page.cells.map(cloneCell) })) };
}

export function emptyPaletteLayout(): PaletteLayout { return { version: 1, pages: [] }; }

/** Palette pages are shared by home and dungeon maps; only cell size must match. */
export function selectCompatiblePalettePageId(
  pages: readonly PalettePage[],
  selectedPageId: string,
  tileSize: PaletteTileSize,
): string {
  const compatible = pages.filter((page) => page.tileSize === tileSize);
  return compatible.some((page) => page.id === selectedPageId) ? selectedPageId : (compatible[0]?.id ?? "");
}

export function pageCell(page: PalettePage, x: number, y: number): PaletteCell | undefined {
  return page.cells.find((cell) => cell.x === x && cell.y === y);
}

export function validatePaletteLayout(value: unknown, assets?: readonly PaletteAsset[]): string[] {
  if (!value || typeof value !== "object") return ["palette object"];
  const layout = value as Partial<PaletteLayout>;
  const errors: string[] = [];
  if (layout.version !== 1) errors.push("version");
  if (!Array.isArray(layout.pages)) return [...errors, "pages"];
  if (layout.pages.length === 0) errors.push("pages");
  const pageIds = new Set<string>();
  const assetIndex = assets ? new Map(assets.map((asset) => [asset.id, asset])) : undefined;
  for (const page of layout.pages) {
    if (!page || typeof page !== "object") { errors.push("page"); continue; }
    if (typeof page.id !== "string" || !page.id.trim() || pageIds.has(page.id)) errors.push("page id");
    pageIds.add(page.id);
    if (typeof page.label !== "string" || !page.label.trim()) errors.push("page label");
    if (page.mapKind !== "home" && page.mapKind !== "dungeon") errors.push("page mapKind");
    if (page.tileSize !== 16 && page.tileSize !== 32) errors.push("page tileSize");
    if (!Number.isInteger(page.width) || !Number.isInteger(page.height) || page.width < 1 || page.height < 1 || page.width > MAX_PALETTE_DIMENSION || page.height > MAX_PALETTE_DIMENSION) errors.push("page dimensions");
    if (!Array.isArray(page.cells)) { errors.push("page cells"); continue; }
    const positions = new Set<string>();
    for (const cell of page.cells) {
      if (!cell || typeof cell !== "object") { errors.push("cell"); continue; }
      if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y) || !inside(page.width, page.height, cell.x, cell.y)) errors.push("cell bounds");
      const position = keyOf(cell.x, cell.y);
      if (positions.has(position)) errors.push("duplicate cell");
      positions.add(position);
      if (typeof cell.assetId !== "string" || !cell.assetId) errors.push("cell asset");
      if (!Number.isInteger(cell.frame) || cell.frame < 0) errors.push("cell frame");
      if (!layers.includes(cell.layer)) errors.push("cell layer");
      if (typeof cell.walkable !== "boolean") errors.push("cell walkable");
      if (cell.role !== undefined && !PALETTE_CELL_ROLES.includes(cell.role)) errors.push("cell role");
      if (cell.status !== undefined && !PALETTE_CELL_STATUSES.includes(cell.status)) errors.push("cell status");
      if (cell.note !== undefined && typeof cell.note !== "string") errors.push("cell note");
      const asset = assetIndex?.get(cell.assetId);
      if (asset && (asset.tileSize !== page.tileSize || cell.frame >= asset.frameCount)) errors.push("cell asset incompatible");
      if (assetIndex && !asset) errors.push("unknown asset");
    }
  }
  return [...new Set(errors)];
}

export function createPalettePage(input: Omit<PalettePage, "cells"> & { cells?: PaletteCell[] }): PalettePage {
  const page: PalettePage = { ...input, cells: input.cells?.map(cloneCell) ?? [] };
  const errors = validatePaletteLayout({ version: 1, pages: [page] });
  if (errors.length) throw new Error(`invalid palette page: ${errors.join(", ")}`);
  return page;
}

export function addPalettePage(layout: PaletteLayout, page: PalettePage): void {
  if (layout.pages.some((item) => item.id === page.id)) throw new Error("duplicate palette page id");
  layout.pages.push(createPalettePage(page));
}

export function renamePalettePage(page: PalettePage, label: string): boolean {
  if (!label.trim()) return false;
  page.label = label.trim();
  return true;
}

/** Refuses a shrink that would discard an authored palette cell. */
export function resizePalettePage(page: PalettePage, width: number, height: number): { ok: true } | { ok: false; reason: string } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_PALETTE_DIMENSION || height > MAX_PALETTE_DIMENSION) return { ok: false, reason: `サイズは1〜${MAX_PALETTE_DIMENSION}セルで指定してください。` };
  if (page.cells.some((cell) => cell.x >= width || cell.y >= height)) return { ok: false, reason: "縮小範囲にパレット素材があります。先に移動または削除してください。" };
  page.width = width;
  page.height = height;
  return { ok: true };
}

export function deletePalettePage(layout: PaletteLayout, pageId: string): boolean {
  if (layout.pages.length <= 1) return false;
  const index = layout.pages.findIndex((page) => page.id === pageId);
  if (index < 0) return false;
  layout.pages.splice(index, 1);
  return true;
}

export function putPaletteCell(page: PalettePage, cell: PaletteCell | null, x: number, y: number): boolean {
  if (!inside(page.width, page.height, x, y)) return false;
  const index = page.cells.findIndex((item) => item.x === x && item.y === y);
  if (cell === null) { if (index >= 0) page.cells.splice(index, 1); return true; }
  const next = { ...cell, x, y };
  if (index >= 0) page.cells[index] = next; else page.cells.push(next);
  return true;
}

/** `null` clears a field; omitted fields are left as they are. */
export interface PaletteTagPatch {
  role?: PaletteCellRole | null;
  status?: PaletteCellStatus | null;
  note?: string | null;
}

/**
 * Applies a tag to every populated cell in a rectangle.
 *
 * Triage is the bottleneck when a pack arrives with thousands of frames, so the
 * unit of work is a selection rather than a cell. Returns how many cells changed
 * so the caller can report it and skip a no-op undo entry.
 */
export function tagPaletteRegion(page: PalettePage, rect: CellRect, patch: PaletteTagPatch): number {
  let changed = 0;
  for (const cell of page.cells) {
    if (cell.x < rect.x || cell.y < rect.y || cell.x >= rect.x + rect.width || cell.y >= rect.y + rect.height) continue;
    const before = `${cell.role ?? ""}|${cell.status ?? ""}|${cell.note ?? ""}`;
    if (patch.role !== undefined) { if (patch.role === null) delete cell.role; else cell.role = patch.role; }
    if (patch.status !== undefined) { if (patch.status === null) delete cell.status; else cell.status = patch.status; }
    if (patch.note !== undefined) { const note = patch.note?.trim(); if (!note) delete cell.note; else cell.note = note; }
    if (`${cell.role ?? ""}|${cell.status ?? ""}|${cell.note ?? ""}` !== before) changed += 1;
  }
  return changed;
}

export interface PaletteTagSummary {
  cells: number;
  /** Cells with no role yet — the work still to do. */
  untagged: number;
  byRole: Record<PaletteCellRole, number>;
  byStatus: Record<PaletteCellStatus, number>;
}

/** Counts the triage state of a whole layout, or of one page. */
export function paletteTagSummary(pages: readonly PalettePage[]): PaletteTagSummary {
  const summary: PaletteTagSummary = {
    cells: 0,
    untagged: 0,
    byRole: { floor: 0, wall: 0, prop: 0, stairs: 0, liquid: 0 },
    byStatus: { ready: 0, unsorted: 0, rejected: 0 },
  };
  for (const page of pages) for (const cell of page.cells) {
    summary.cells += 1;
    if (cell.role) summary.byRole[cell.role] += 1; else summary.untagged += 1;
    summary.byStatus[cell.status ?? "unsorted"] += 1;
  }
  return summary;
}

export function paletteRectFromPoints(a: CellPoint, b: CellPoint): CellRect {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x) + 1, height: Math.abs(a.y - b.y) + 1 };
}

export function paletteStamp(page: PalettePage, rect: CellRect): PaletteStamp {
  const cells: Array<PaletteCell | null> = [];
  for (let y = 0; y < rect.height; y += 1) for (let x = 0; x < rect.width; x += 1) {
    const cell = pageCell(page, rect.x + x, rect.y + y);
    cells.push(cell ? { ...cell, x, y } : null);
  }
  return { width: rect.width, height: rect.height, cells };
}

/**
 * Move/copy a rectangular region within a page.  Empty source cells are
 * meaningful for move (they clear the source); for copy they are ignored so
 * authors can paste a sparse arrangement over an existing palette.
 */
export function transferPaletteRegion(page: PalettePage, source: CellRect, target: CellPoint, mode: "move" | "copy"): boolean {
  if (source.width < 1 || source.height < 1 || !inside(page.width, page.height, source.x, source.y) || !inside(page.width, page.height, source.x + source.width - 1, source.y + source.height - 1) || !inside(page.width, page.height, target.x, target.y) || !inside(page.width, page.height, target.x + source.width - 1, target.y + source.height - 1)) return false;
  const stamp = paletteStamp(page, source);
  if (mode === "move") for (let y = 0; y < source.height; y += 1) for (let x = 0; x < source.width; x += 1) putPaletteCell(page, null, source.x + x, source.y + y);
  for (let y = 0; y < stamp.height; y += 1) for (let x = 0; x < stamp.width; x += 1) {
    const cell = stamp.cells[y * stamp.width + x];
    if (cell) putPaletteCell(page, cell, target.x + x, target.y + y);
  }
  return true;
}

/** Place a selected source-sheet rectangle. Source frames are row-major. */
export function placeSourceFrames(page: PalettePage, target: CellPoint, asset: PaletteAsset, source: CellRect): boolean {
  if (asset.tileSize !== page.tileSize || source.width < 1 || source.height < 1 || !inside(page.width, page.height, target.x, target.y) || !inside(page.width, page.height, target.x + source.width - 1, target.y + source.height - 1)) return false;
  const columns = Math.max(1, asset.columns);
  for (let y = 0; y < source.height; y += 1) for (let x = 0; x < source.width; x += 1) {
    const frame = (source.y + y) * columns + source.x + x;
    if (frame >= 0 && frame < asset.frameCount) putPaletteCell(page, { x: target.x + x, y: target.y + y, assetId: asset.id, frame, layer: asset.defaultLayer, walkable: asset.defaultWalkable }, target.x + x, target.y + y);
  }
  return true;
}

function applyStampCell(map: StampMap, x: number, y: number, cell: PaletteCell, attributes: StampAttributes): void {
  const index = y * map.width + x;
  const targetLayer = attributes.mode === "palette" ? cell.layer : attributes.layer;
  map.layers[targetLayer][index] = { assetId: cell.assetId, frame: cell.frame };
  const collision = attributes.mode === "palette" ? (cell.walkable ? "walkable" : "blocked") : attributes.collision;
  if (collision !== "unchanged") map.collision[index] = collision === "walkable";
}

/** Atomically paints a sparse stamp at its top-left origin. */
export function paintPaletteStamp(map: StampMap, stamp: PaletteStamp, target: CellPoint, attributes: StampAttributes): boolean {
  for (let y = 0; y < stamp.height; y += 1) for (let x = 0; x < stamp.width; x += 1) {
    if (stamp.cells[y * stamp.width + x] && !inside(map.width, map.height, target.x + x, target.y + y)) return false;
  }
  for (let y = 0; y < stamp.height; y += 1) for (let x = 0; x < stamp.width; x += 1) {
    const cell = stamp.cells[y * stamp.width + x];
    if (cell && inside(map.width, map.height, target.x + x, target.y + y)) applyStampCell(map, target.x + x, target.y + y, cell, attributes);
  }
  return true;
}

/** Repeats a sparse stamp over an inclusive rectangle, with all-or-nothing bounds checks. */
export function rectanglePaletteStamp(map: StampMap, stamp: PaletteStamp, first: CellPoint, second: CellPoint, attributes: StampAttributes): boolean {
  const rect = paletteRectFromPoints(first, second);
  const operations: Array<{ x: number; y: number; cell: PaletteCell }> = [];
  for (let y = rect.y; y < rect.y + rect.height; y += 1) for (let x = rect.x; x < rect.x + rect.width; x += 1) {
    const cell = stamp.cells[((y - rect.y) % stamp.height) * stamp.width + ((x - rect.x) % stamp.width)];
    if (cell) operations.push({ x, y, cell });
  }
  if (operations.some((operation) => !inside(map.width, map.height, operation.x, operation.y))) return false;
  for (const operation of operations) applyStampCell(map, operation.x, operation.y, operation.cell, attributes);
  return true;
}

/** Fill only has an unambiguous meaning for a single palette cell. */
export function fillPaletteStamp(map: StampMap, stamp: PaletteStamp, start: CellPoint, attributes: StampAttributes): boolean {
  if (stamp.width !== 1 || stamp.height !== 1 || !stamp.cells[0] || !inside(map.width, map.height, start.x, start.y)) return false;
  const layer = attributes.mode === "palette" ? stamp.cells[0].layer : attributes.layer;
  const source = map.layers[layer][start.y * map.width + start.x];
  const sourceKey = source ? `${source.assetId}:${source.frame}` : "";
  const queue: CellPoint[] = [start], seen = new Set<string>();
  const changes: CellPoint[] = [];
  while (queue.length) {
    const point = queue.shift()!;
    if (!inside(map.width, map.height, point.x, point.y) || seen.has(keyOf(point.x, point.y))) continue;
    seen.add(keyOf(point.x, point.y));
    const value = map.layers[layer][point.y * map.width + point.x];
    if ((value ? `${value.assetId}:${value.frame}` : "") !== sourceKey) continue;
    changes.push(point);
    queue.push({ x: point.x + 1, y: point.y }, { x: point.x - 1, y: point.y }, { x: point.x, y: point.y + 1 }, { x: point.x, y: point.y - 1 });
  }
  for (const point of changes) applyStampCell(map, point.x, point.y, stamp.cells[0], attributes);
  return true;
}

/** Undo/redo state intentionally marks reloads as clean and local edits dirty. */
export class PaletteHistory {
  private undoStack: PaletteLayout[] = [];
  private redoStack: PaletteLayout[] = [];
  private saved: string;
  layout: PaletteLayout;

  constructor(layout: PaletteLayout) { this.layout = clonePaletteLayout(layout); this.saved = JSON.stringify(this.layout); }
  get dirty(): boolean { return JSON.stringify(this.layout) !== this.saved; }
  mutate(action: (layout: PaletteLayout) => void): boolean {
    const before = clonePaletteLayout(this.layout);
    action(this.layout);
    if (JSON.stringify(before) === JSON.stringify(this.layout)) return false;
    this.undoStack.push(before); this.redoStack = [];
    return true;
  }
  undo(): boolean { const previous = this.undoStack.pop(); if (!previous) return false; this.redoStack.push(clonePaletteLayout(this.layout)); this.layout = previous; return true; }
  redo(): boolean { const next = this.redoStack.pop(); if (!next) return false; this.undoStack.push(clonePaletteLayout(this.layout)); this.layout = next; return true; }
  markSaved(): void { this.saved = JSON.stringify(this.layout); }
  reload(layout: PaletteLayout): void { this.layout = clonePaletteLayout(layout); this.undoStack = []; this.redoStack = []; this.markSaved(); }
}
