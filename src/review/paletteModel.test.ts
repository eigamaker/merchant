import { describe, expect, it } from "vitest";
import { MAX_PALETTE_DIMENSION, PaletteHistory, addPalettePage, clonePaletteLayout, createPalettePage, deletePalettePage, emptyPaletteLayout, fillPaletteStamp, paintPaletteStamp, paletteStamp, placeSourceFrames, rectanglePaletteStamp, resizePalettePage, selectCompatiblePalettePageId, transferPaletteRegion, validatePaletteLayout, type PaletteAsset, type PaletteLayer, type StampMap, paletteTagSummary, tagPaletteRegion } from "./paletteModel";

const asset: PaletteAsset = { id: "dungeon-sheet", label: "Dungeon", path: "/dungeon.png", mapKinds: ["dungeon"], tileSize: 16, margin: 0, spacing: 0, columns: 4, rows: 4, frameCount: 16, defaultLayer: "ground", defaultWalkable: true };
const page = () => createPalettePage({ id: "p", label: "床", mapKind: "dungeon", tileSize: 16, width: 4, height: 4 });
const map = (): StampMap => ({ width: 4, height: 4, layers: { ground: Array(16).fill(null), structure: Array(16).fill(null), decoration: Array(16).fill(null) }, collision: Array(16).fill(false) });
const manual = { mode: "manual" as const, layer: "structure" as PaletteLayer, collision: "unchanged" as const };

describe("free-form palette model", () => {
  it("shares palette pages between home and dungeon maps when tile size matches", () => {
    const home = createPalettePage({ id: "home", label: "Home", mapKind: "home", tileSize: 16, width: 4, height: 4 });
    expect(selectCompatiblePalettePageId([home], "home", 16)).toBe("home");

    const dungeon = createPalettePage({ id: "dungeon", label: "Dungeon", mapKind: "dungeon", tileSize: 16, width: 4, height: 4 });
    expect(selectCompatiblePalettePageId([home, dungeon], "home", 16)).toBe("home");
    expect(selectCompatiblePalettePageId([home, dungeon], "dungeon", 16)).toBe("dungeon");
    expect(selectCompatiblePalettePageId([home, dungeon], "home", 32)).toBe("");
  });

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

  it("supports sparse oversized category workspaces", () => {
    const target = createPalettePage({ id: "large", label: "インテリア", mapKind: "home", tileSize: 16, width: 2048, height: 2048 });
    expect(resizePalettePage(target, 2056, 2056)).toEqual({ ok: true });
    expect(resizePalettePage(target, MAX_PALETTE_DIMENSION + 1, 2056).ok).toBe(false);
    expect(validatePaletteLayout({ version: 1, pages: [target] }, [asset])).toEqual([]);
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

  it("shares assets between home and dungeon palettes when tile size matches", () => {
    const home = createPalettePage({ id: "home", label: "Home", mapKind: "home", tileSize: 16, width: 2, height: 2 });
    expect(placeSourceFrames(home, { x: 0, y: 0 }, asset, { x: 0, y: 0, width: 1, height: 1 })).toBe(true);
    expect(validatePaletteLayout({ version: 1, pages: [home] }, [asset])).toEqual([]);
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

describe("palette triage tags", () => {
  const page = () => createPalettePage({
    id: "shelf", label: "shelf", mapKind: "dungeon", tileSize: 16, width: 4, height: 4,
    cells: [
      { x: 0, y: 0, assetId: "a", frame: 0, layer: "ground", walkable: true },
      { x: 1, y: 0, assetId: "a", frame: 1, layer: "ground", walkable: true },
      { x: 3, y: 3, assetId: "a", frame: 2, layer: "decoration", walkable: false },
    ],
  });

  it("tags every populated cell inside the rectangle and leaves the rest alone", () => {
    const shelf = page();
    expect(tagPaletteRegion(shelf, { x: 0, y: 0, width: 2, height: 1 }, { role: "floor", status: "ready" })).toBe(2);
    expect(shelf.cells.map((cell) => cell.role)).toEqual(["floor", "floor", undefined]);
    expect(shelf.cells[2]!.status).toBeUndefined();
  });

  it("reports nothing changed when the tag already matches", () => {
    const shelf = page();
    tagPaletteRegion(shelf, { x: 0, y: 0, width: 4, height: 4 }, { role: "prop" });
    expect(tagPaletteRegion(shelf, { x: 0, y: 0, width: 4, height: 4 }, { role: "prop" })).toBe(0);
  });

  it("clears a field with null and drops a blank note", () => {
    const shelf = page();
    tagPaletteRegion(shelf, { x: 0, y: 0, width: 4, height: 4 }, { role: "wall", status: "rejected", note: "  grid is off  " });
    expect(shelf.cells[0]).toMatchObject({ role: "wall", status: "rejected", note: "grid is off" });
    tagPaletteRegion(shelf, { x: 0, y: 0, width: 4, height: 4 }, { role: null, note: "   " });
    expect(shelf.cells[0]!.role).toBeUndefined();
    expect(shelf.cells[0]!.note).toBeUndefined();
    expect(shelf.cells[0]!.status).toBe("rejected");
  });

  it("counts the backlog, treating an untagged cell as unsorted", () => {
    const shelf = page();
    tagPaletteRegion(shelf, { x: 0, y: 0, width: 2, height: 1 }, { role: "floor", status: "ready" });
    const summary = paletteTagSummary([shelf]);
    expect(summary).toMatchObject({ cells: 3, untagged: 1 });
    expect(summary.byRole.floor).toBe(2);
    expect(summary.byStatus).toMatchObject({ ready: 2, unsorted: 1, rejected: 0 });
  });

  it("keeps tagged cells valid and rejects an unknown role", () => {
    const shelf = page();
    tagPaletteRegion(shelf, { x: 0, y: 0, width: 4, height: 4 }, { role: "stairs", status: "ready" });
    expect(validatePaletteLayout({ version: 1, pages: [shelf] })).toEqual([]);
    const broken = { ...shelf, cells: [{ ...shelf.cells[0], role: "doorway" }] };
    expect(validatePaletteLayout({ version: 1, pages: [broken] })).toContain("cell role");
  });
});
