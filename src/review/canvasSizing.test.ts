import { describe, expect, it } from "vitest";
import { MAX_EDITOR_CANVAS_EDGE, fitEditorCanvas } from "./canvasSizing";

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
