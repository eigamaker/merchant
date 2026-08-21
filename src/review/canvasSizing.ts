/** Browser canvases become unreliable before their logical tile grids do.
 * Keep every internal dimension under a conservative, portable edge limit. */
export const MAX_EDITOR_CANVAS_EDGE = 4096;

export interface CanvasFit {
  cellPixels: number;
  width: number;
  height: number;
  reduced: boolean;
}

export interface SparseGridExtent {
  columns: number;
  rows: number;
}

/**
 * Keeps a sparse logical workspace crisp by rendering only its populated
 * upper-left working area. The logical page can still be thousands of cells;
 * the visible area grows as authors place or select cells near its edge.
 */
export function sparseGridExtent(
  maxColumns: number,
  maxRows: number,
  occupied: readonly { x: number; y: number }[],
  focus?: { x: number; y: number; width: number; height: number },
  minimum = 64,
  padding = 8,
): SparseGridExtent {
  if (!Number.isInteger(maxColumns) || !Number.isInteger(maxRows) || maxColumns < 1 || maxRows < 1) throw new Error("sparse grid dimensions must be positive integers");
  if (!Number.isInteger(minimum) || minimum < 1 || !Number.isInteger(padding) || padding < 0) throw new Error("sparse grid minimum and padding must be non-negative integers");
  let usedColumns = 0, usedRows = 0;
  for (const point of occupied) {
    if (!Number.isInteger(point.x) || !Number.isInteger(point.y) || point.x < 0 || point.y < 0) continue;
    usedColumns = Math.max(usedColumns, point.x + 1);
    usedRows = Math.max(usedRows, point.y + 1);
  }
  if (focus && focus.width > 0 && focus.height > 0) {
    usedColumns = Math.max(usedColumns, focus.x + focus.width);
    usedRows = Math.max(usedRows, focus.y + focus.height);
  }
  return {
    columns: Math.min(maxColumns, Math.max(Math.min(minimum, maxColumns), usedColumns + padding)),
    rows: Math.min(maxRows, Math.max(Math.min(minimum, maxRows), usedRows + padding)),
  };
}

/**
 * Uses one shared effective cell scale for drawing and pointer coordinates.
 * Sheets can contain more columns than physical canvas pixels, so this may be
 * fractional; Canvas 2D accepts that and still maps every logical cell.
 */
export function fitEditorCanvas(columns: number, rows: number, requestedCellPixels: number, maxEdge = MAX_EDITOR_CANVAS_EDGE): CanvasFit {
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1) throw new Error("canvas grid dimensions must be positive integers");
  if (!Number.isFinite(requestedCellPixels) || requestedCellPixels <= 0) throw new Error("requested cell size must be positive");
  if (!Number.isInteger(maxEdge) || maxEdge < 1) throw new Error("canvas edge limit must be a positive integer");
  const requested = requestedCellPixels;
  const permitted = maxEdge / Math.max(columns, rows);
  const cellPixels = Math.min(requested, permitted);
  return { cellPixels, width: Math.max(1, Math.floor(columns * cellPixels)), height: Math.max(1, Math.floor(rows * cellPixels)), reduced: cellPixels < requested };
}
