import { describe, expect, it } from "vitest";
import { PaletteHistory, addPalettePage, clonePaletteLayout, createPalettePage, deletePalettePage, emptyPaletteLayout, fillPaletteStamp, paintPaletteStamp, paletteStamp, placeSourceFrames, rectanglePaletteStamp, resizePalettePage, transferPaletteRegion, validatePaletteLayout, type PaletteAsset, type PaletteLayer, type StampMap } from "./paletteModel";

const asset: PaletteAsset = { id: "dungeon-sheet", label: "Dungeon", path: "/dungeon.png", mapKinds: ["dungeon"], tileSize: 16, margin: 0, spacing: 0, columns: 4, rows: 4, frameCount: 16, defaultLayer: "ground", defaultWalkable: true };
const page = () => createPalettePage({ id: "p", label: "床", mapKind: "dungeon", tileSize: 16, width: 4, height: 4 });
const map = (): StampMap => ({ width: 4, height: 4, layers: { ground: Array(16).fill(null), structure: Array(16).fill(null), decoration: Array(16).fill(null) }, collision: Array(16).fill(false) });
const manual = { mode: "manual" as const, layer: "structure" as PaletteLayer, collision: "unchanged" as const };

describe("free-form palette model", () => {
  it("accepts duplicate assets but rejects a duplicate cell coordinate", () => {
    const value = { version: 1, pages: [{ ...page(), cells: [
      { x: 0, y: 0, assetId: asset.id, frame: 0, layer: "ground" as const, walkable: true },
      { x: 1, y: 0, assetId: asset.id, frame: 0, layer: "ground" as const, walkable: true },
    ] }] } as const;
    expect(validatePaletteLayout(value, [asset])).toEqual([]);
    expect(validatePaletteLayout({ ...value, pages: [{ ...value.pages[0], cells: [...value.pages[0].cells, { ...value.pages[0].cells[0] }] }] }, [asset])).toContain("duplicate cell");
  });

  it("creates, renames and safely resizes independent pages", () => {
    const layout = emptyPaletteLayout(); const first = page(); addPalettePage(layout, first);
    expect(resizePalettePage(first, 1, 1)).toEqual({ ok: true });
    placeSourceFrames(first, { x: 0, y: 0 }, asset, { x: 0, y: 0, width: 1, height: 1 });
    expect(resizePalettePage(first, 0, 1).ok).toBe(false);
    expect(resizePalettePage(first, 1, 1).ok).toBe(true);
    expect(resizePalettePage(first, 1, 0).ok).toBe(false);
  });

  it("keeps at least one page so every editor state remains saveable", () => {
    const layout = { version: 1 as const, pages: [page()] };
    expect(deletePalettePage(layout, "p")).toBe(false);
    expect(layout.pages).toHaveLength(1);
    expect(validatePaletteLayout({ version: 1, pages: [] }, [asset])).toContain("pages");
  });

  it("places source-sheet rectangles using their actual column count", () => {
    const target = page();
    expect(placeSourceFrames(target, { x: 1, y: 1 }, asset, { x: 2, y: 1, width: 2, height: 2 })).toBe(true);
    expect(target.cells.map((cell) => cell.frame).sort((a, b) => a - b)).toEqual([6, 7, 10, 11]);
  });

  it("moves sparse selections without destroying overlapping source data", () => {
    const target = page();
    placeSourceFrames(target, { x: 0, y: 0 }, asset, { x: 0, y: 0, width: 1, height: 1 });
    placeSourceFrames(target, { x: 2, y: 0 }, asset, { x: 1, y: 0, width: 1, height: 1 });
    expect(transferPaletteRegion(target, { x: 0, y: 0, width: 3, height: 1 }, { x: 1, y: 1 }, "copy")).toBe(true);
    expect(target.cells.filter((cell) => cell.y === 1).map((cell) => cell.x).sort()).toEqual([1, 3]);
    expect(transferPaletteRegion(target, { x: 0, y: 0, width: 3, height: 1 }, { x: 0, y: 2 }, "move")).toBe(true);
    expect(target.cells.some((cell) => cell.x === 0 && cell.y === 0)).toBe(false);
  });

  it("atomically rejects a stamp with an authored cell outside a map", () => {
    const target = page();
    placeSourceFrames(target, { x: 0, y: 0 }, asset, { x: 0, y: 0, width: 2, height: 1 });
    const stamp = paletteStamp(target, { x: 0, y: 0, width: 2, height: 1 }); const targetMap = map();
    expect(paintPaletteStamp(targetMap, stamp, { x: 3, y: 0 }, manual)).toBe(false);
    expect(targetMap.layers.structure.every((cell) => cell === null)).toBe(true);
  });

  it("preserves blanks, repeats stamps, and restricts fill to one cell", () => {
    const target = page();
    placeSourceFrames(target, { x: 0, y: 0 }, asset, { x: 0, y: 0, width: 1, height: 1 });
    const sparse = paletteStamp(target, { x: 0, y: 0, width: 2, height: 1 }); const targetMap = map();
    targetMap.layers.ground[1] = { assetId: "keep", frame: 1 };
    expect(paintPaletteStamp(targetMap, sparse, { x: 0, y: 0 }, { mode: "palette", layer: "structure", collision: "unchanged" })).toBe(true);
    expect(targetMap.layers.ground[1]).toEqual({ assetId: "keep", frame: 1 });
    expect(rectanglePaletteStamp(targetMap, sparse, { x: 0, y: 2 }, { x: 3, y: 3 }, manual)).toBe(true);
    expect(targetMap.layers.structure.filter(Boolean)).toHaveLength(4);
    expect(fillPaletteStamp(targetMap, sparse, { x: 0, y: 0 }, manual)).toBe(false);
  });

  it("applies palette attributes or manual collision settings", () => {
    const target = page(); placeSourceFrames(target, { x: 0, y: 0 }, asset, { x: 0, y: 0, width: 1, height: 1 });
    const stamp = paletteStamp(target, { x: 0, y: 0, width: 1, height: 1 }); const targetMap = map();
    expect(paintPaletteStamp(targetMap, stamp, { x: 1, y: 1 }, { mode: "palette", layer: "structure", collision: "unchanged" })).toBe(true);
    expect(targetMap.collision[5]).toBe(true);
    expect(paintPaletteStamp(targetMap, stamp, { x: 2, y: 1 }, { mode: "manual", layer: "decoration", collision: "blocked" })).toBe(true);
    expect(targetMap.layers.decoration[6]).toEqual({ assetId: asset.id, frame: 0 }); expect(targetMap.collision[6]).toBe(false);
  });

  it("tracks dirty state, undo/redo and clean reloads", () => {
    const source = { version: 1 as const, pages: [page()] }; const history = new PaletteHistory(source);
    expect(history.dirty).toBe(false);
    history.mutate((layout) => { layout.pages[0].label = "編集"; }); expect(history.dirty).toBe(true);
    expect(history.undo()).toBe(true); expect(history.layout.pages[0].label).toBe("床");
    expect(history.redo()).toBe(true); expect(history.layout.pages[0].label).toBe("編集");
    history.reload(clonePaletteLayout(source)); expect(history.dirty).toBe(false); expect(history.undo()).toBe(false);
  });
});
