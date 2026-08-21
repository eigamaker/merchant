import { describe, expect, it } from "vitest";
import { MAX_EDITOR_CANVAS_EDGE, fitEditorCanvas, sparseGridExtent } from "./canvasSizing";

describe("fitEditorCanvas", () => {
  it("keeps ordinary editor canvases at their requested pixel scale", () => {
    expect(fitEditorCanvas(32, 20, 32)).toEqual({ cellPixels: 32, width: 1024, height: 640, reduced: false });
  });

  it("fits 256-cell maps under the maximum edge with square cells", () => {
    const fit = fitEditorCanvas(256, 256, 64);
    expect(fit).toEqual({ cellPixels: 16, width: 4096, height: 4096, reduced: true });
    expect(fit.width).toBeLessThanOrEqual(MAX_EDITOR_CANVAS_EDGE);
    expect(fit.height).toBeLessThanOrEqual(MAX_EDITOR_CANVAS_EDGE);
  });

  it("also bounds exceptionally wide source sheets with a fractional cell scale", () => {
    const fit = fitEditorCanvas(5000, 8, 64);
    expect(fit.width).toBe(MAX_EDITOR_CANVAS_EDGE);
    expect(fit.height).toBeLessThanOrEqual(MAX_EDITOR_CANVAS_EDGE);
    expect(fit.cellPixels).toBeCloseTo(MAX_EDITOR_CANVAS_EDGE / 5000);
  });

  it("validates invalid dimensions and limits", () => {
    expect(() => fitEditorCanvas(0, 1, 16)).toThrow(/dimensions/);
    expect(() => fitEditorCanvas(1, 1, 0)).toThrow(/cell size/);
    expect(() => fitEditorCanvas(1, 1, 16, 0)).toThrow(/edge limit/);
  });
});

describe("sparseGridExtent", () => {
  it("renders a crisp working area instead of the full sparse palette", () => {
    const extent = sparseGridExtent(2048, 2048, [{ x: 2, y: 3 }]);
    expect(extent).toEqual({ columns: 64, rows: 64 });
    expect(fitEditorCanvas(extent.columns, extent.rows, 32).reduced).toBe(false);
  });

  it("grows around populated cells and the current selection", () => {
    expect(sparseGridExtent(2048, 2048, [{ x: 80, y: 70 }], { x: 90, y: 100, width: 2, height: 3 })).toEqual({ columns: 100, rows: 111 });
  });

  it("never exceeds the logical page", () => {
    expect(sparseGridExtent(20, 12, [])).toEqual({ columns: 20, rows: 12 });
  });
});
