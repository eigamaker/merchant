/** Browser canvases become unreliable before their logical tile grids do.
 * Keep every internal dimension under a conservative, portable edge limit. */
export const MAX_EDITOR_CANVAS_EDGE = 4096;

export interface CanvasFit {
  cellPixels: number;
  width: number;
  height: number;
  reduced: boolean;
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
