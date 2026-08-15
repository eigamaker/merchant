import "./review.css";
import { CRAFTPIX_SHEETS, type CraftpixSheetId } from "../game/craftpixCatalog";
import { animationClip, type CraftpixAnimationCatalog } from "../game/craftpixAnimations";
import {
  MANUAL_LAYERS,
  MANUAL_MAP_HEIGHT,
  MANUAL_MAP_TILE,
  MANUAL_MAP_WIDTH,
  MANUAL_MAP_PRESETS,
  ManualMapRepository,
  cloneManualMap,
  copyManualMapFragment,
  createBlankManualMap,
  ensureManualMapPadding,
  manualCellIndex as fixedManualCellIndex,
  manualEdgeKey,
  normalizeManualMap,
  normalizeManualMapPack,
  pasteManualMapFragment,
  placeManualTile,
  removeTopPlacement,
  storeManualTrialMap,
  topPlacement,
  validateManualMap,
  type ManualDungeonMap,
  type ManualBuildingLink,
  type ManualMapFragment,
  type ManualTilePlacement,
  type ManualVisualLayer,
} from "./manualMapModel";

type Tool = "paint" | "rectangle" | "fill" | "erase" | "eyedropper" | "walkable" | "blocked" | "edge" | "entrance" | "stairs" | "select" | "paste";
type Point = { x: number; y: number; localX: number; localY: number };
type TiledPrefabPlacement = TiledSourcePlacement & { layer: ManualVisualLayer };
type TiledPrefab = { id: string; label: string; sheet: CraftpixSheetId; width: number; height: number; placements: TiledPrefabPlacement[] };
type Stamp = { sheet: CraftpixSheetId; frame: number; width: number; height: number; animationId?: string; prefab?: TiledPrefab };
type PaletteTile = { frame: number; animationId?: string };
type TiledSourcePlacement = { sheet: CraftpixSheetId; frame: number; animationId?: string; x: number; y: number; flipX?: boolean; flipY?: boolean; flipDiagonal?: boolean };
type TiledSourceMap = { id: string; pack: string; tileSize: 16; bounds: { x: number; y: number; width: number; height: number }; layers: Array<{ name: string; kind: ManualVisualLayer; placements: TiledSourcePlacement[] }> };

const root = document.querySelector<HTMLElement>("#review-app")!;
if (!root) throw new Error("review app root not found");

const MARGIN = 18;
const repository = new ManualMapRepository();
const images = new Map<CraftpixSheetId, HTMLImageElement>();
const histories = new Map<string, { undo: ManualDungeonMap[]; redo: ManualDungeonMap[] }>();
const sourceFrames = new Set<string>();
let animationCatalog: CraftpixAnimationCatalog | undefined;
let paletteTiles: PaletteTile[] = [];
let tiledSourceMaps: TiledSourceMap[] = [];
let metatileSheets = new Set<CraftpixSheetId>();
let tiledPrefabs: TiledPrefab[] = [];
let palettePrefabLayouts: Array<{ prefab: TiledPrefab; x: number; y: number }> = [];
const animationEpoch = performance.now();

function manualCellIndex(x: number, y: number): number {
  return fixedManualCellIndex(activeMap, x, y);
}

let maps: ManualDungeonMap[] = [];
let activeMap: ManualDungeonMap;
let selectedLayer: ManualVisualLayer = "ground";
let selectedTool: Tool = "paint";
let selectedStamp: Stamp = { sheet: "dungeon-base-walls-floor", frame: 138, width: 1, height: 1 };
let zoom = 1;
let paletteSheet: CraftpixSheetId = "dungeon-base-walls-floor";
let pointerStart: Point | undefined;
let transactionBefore: ManualDungeonMap | undefined;
let selection: { start: Point; end: Point } | undefined;
let mapFragment: ManualMapFragment | undefined;
let buildingDraft: Pick<ManualBuildingLink, "id" | "name" | "interiorMapId"> = { id: "", name: "", interiorMapId: "" };
let painting = false;
let lastPainted = new Set<string>();

root.innerHTML = `
  <div class="map-editor-shell">
    <header class="map-editor-header">
      <div><p class="map-editor-eyebrow">MANUAL DUNGEON BLUEPRINT</p><h1>ダンジョン設計ツール</h1><p>TMX正本の素材を手で配置し、通行・入口を同じ画面で調整して試遊できます。</p></div>
      <div class="map-editor-header-actions"><button data-action="new">空白マップ</button><button data-action="add-source-map">TMX見本を追加</button><button data-action="duplicate-sample">見本を複製</button><button data-action="undo">元に戻す</button><button data-action="redo">やり直す</button><button class="primary" data-action="try">このマップを試遊</button></div>
    </header>
    <section class="map-editor-toolbar">
      <label>マップ種類 <select data-map-kind><option value="town">街</option><option value="interior">建物内部</option><option value="dungeon" selected>ダンジョン</option></select></label>
      <label>階層 <input type="number" min="1" max="99" step="1" value="1" data-map-floor aria-label="マップ階層"></label>
      <label>レイヤー <select data-layer></select></label>
      <label>道具 <select data-tool></select></label>
      <label class="check"><input type="checkbox" data-suggestion checked> 配置時に通行推奨値を反映</label>
      <label class="check"><input type="checkbox" data-stack> 重ね置き</label>
      <label class="check"><input type="checkbox" data-collision checked> 通行表示</label>
      <label class="check"><input type="checkbox" data-grid checked> グリッド</label>
      <label>ズーム <select data-zoom><option value="0.5">50%</option><option value="0.75">75%</option><option value="1" selected>100%</option><option value="1.5">150%</option><option value="2">200%</option></select></label>
    </section>
    <main class="map-editor-layout">
      <aside class="map-editor-side map-list-panel"><div class="panel-heading"><h2>マップ</h2><span data-progress>0 / 10</span></div><div class="map-list" data-map-list></div><div class="map-actions"><button data-action="rename">名前変更</button><button data-action="duplicate">複製</button><button data-action="delete">削除</button></div><section class="building-link-panel" data-building-link-panel hidden><hr><h2>建物の内部リンク</h2><p class="small">入口にするセルをクリックしてから、建物ID・名前・内部マップを登録します。</p><p class="small" data-building-cell>入口セルを選択してください。</p><label>建物ID <input data-building-id placeholder="例: blacksmith"></label><label>表示名 <input data-building-name placeholder="例: 鍛冶屋"></label><label>内部マップ <select data-building-interior></select></label><button data-action="save-building-link">建物を登録 / 更新</button><div class="building-link-list" data-building-link-list></div></section><hr><h2>レイヤー</h2><div class="layer-list" data-layer-list></div><p class="small">前景レイヤーは試遊時にキャラクターより前へ描画されます。</p></aside>
      <section class="map-canvas-panel"><div class="map-canvas-wrap"><canvas data-map-canvas aria-label="48x36のダンジョン編集キャンバス"></canvas></div><div class="map-canvas-help">鉛筆・矩形・塗りつぶし・消しゴム・スポイトに対応。範囲選択→範囲コピー→貼り付けで、ほかのマップにも区画を使えます。境界はセルの端をクリックします。座標は0始まりです。</div><div class="map-validation" data-validation></div></section>
      <aside class="map-editor-side palette-panel"><h2>素材パレット</h2><label>分類 <select data-category><option value="source">固定マップで使用</option><option value="floor">床・壁</option><option value="water">水</option><option value="decor">装飾・光</option><option value="town">街・建物外観</option><option value="interior">建物内部</option><option value="environment">環境素材（すべて）</option><option value="all">全素材</option></select></label><label>シート <select data-sheet></select></label><p class="small" data-stamp-info></p><div class="palette-wrap"><canvas data-palette-canvas aria-label="素材シート"></canvas></div><div class="selected-info" data-selected-info></div><button data-action="copy-cell">選択情報をコピー</button><hr><h2>マップパレット</h2><p class="small">「範囲選択」でドラッグし、「範囲をコピー」を押します。別マップで「貼り付け」を選び、左上にしたいセルをクリックしてください。</p><div class="map-fragment-wrap"><canvas data-fragment-canvas aria-label="コピーしたマップ区画"></canvas></div><p class="small" data-fragment-info>コピーした区画はありません。</p><div class="map-fragment-actions"><button data-action="copy-selection">範囲をコピー</button><button data-action="clear-selection">選択解除</button></div><hr><h2>保存・共有</h2><button data-action="export-map">選択マップJSON</button><button data-action="export-pack">全マップJSON</button><label class="file-button">JSONを読み込む<input type="file" accept="application/json" data-import></label><label>試遊階層 <select data-floor>${Array.from({ length: 8 }, (_, index) => `<option value="${index + 1}">${index + 1}</option>`).join("")}</select></label><p class="save-status" data-status>読み込み中…</p></aside>
    </main>
  </div>`;

function required<T extends Element>(selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

const mapCanvas = required<HTMLCanvasElement>("[data-map-canvas]");
const mapContext = mapCanvas.getContext("2d")!;
const paletteCanvas = required<HTMLCanvasElement>("[data-palette-canvas]");
const paletteContext = paletteCanvas.getContext("2d")!;
const fragmentCanvas = required<HTMLCanvasElement>("[data-fragment-canvas]");
const fragmentContext = fragmentCanvas.getContext("2d")!;
if (!mapContext || !paletteContext || !fragmentContext) throw new Error("Canvas is unavailable");
const layerSelect = required<HTMLSelectElement>("[data-layer]");
const mapKindSelect = required<HTMLSelectElement>("[data-map-kind]");
const mapFloorInput = required<HTMLInputElement>("[data-map-floor]");
const toolSelect = required<HTMLSelectElement>("[data-tool]");
const suggestionToggle = required<HTMLInputElement>("[data-suggestion]");
const stackToggle = required<HTMLInputElement>("[data-stack]");
const collisionToggle = required<HTMLInputElement>("[data-collision]");
const gridToggle = required<HTMLInputElement>("[data-grid]");
const zoomSelect = required<HTMLSelectElement>("[data-zoom]");
const categorySelect = required<HTMLSelectElement>("[data-category]");
const tiledOption = document.createElement("option");
tiledOption.value = "tiled";
tiledOption.textContent = "TMX正本素材（すべて）";
categorySelect.append(tiledOption);
const prefabOption = document.createElement("option");
prefabOption.value = "prefab";
prefabOption.textContent = "個別アセット（完成形）";
categorySelect.append(prefabOption);
const wallPrefabOption = document.createElement("option");
wallPrefabOption.value = "prefab-wall";
wallPrefabOption.textContent = "壁・床アセット（完成形）";
categorySelect.append(wallPrefabOption);
const sheetSelect = required<HTMLSelectElement>("[data-sheet]");
const floorSelect = required<HTMLSelectElement>("[data-floor]");
const mapList = required<HTMLElement>("[data-map-list]");
const layerList = required<HTMLElement>("[data-layer-list]");
const selectedInfo = required<HTMLElement>("[data-selected-info]");
const validation = required<HTMLElement>("[data-validation]");
const status = required<HTMLElement>("[data-status]");
const stampInfo = required<HTMLElement>("[data-stamp-info]");
const fragmentInfo = required<HTMLElement>("[data-fragment-info]");
const progress = required<HTMLElement>("[data-progress]");
const importInput = required<HTMLInputElement>("[data-import]");
const buildingLinkPanel = required<HTMLElement>("[data-building-link-panel]");
const buildingCell = required<HTMLElement>("[data-building-cell]");
const buildingIdInput = required<HTMLInputElement>("[data-building-id]");
const buildingNameInput = required<HTMLInputElement>("[data-building-name]");
const buildingInteriorSelect = required<HTMLSelectElement>("[data-building-interior]");
const buildingLinkList = required<HTMLElement>("[data-building-link-list]");

const layerLabels: Record<ManualVisualLayer, string> = { ground: "地面", structure: "構造物", decoration: "装飾", overhead: "キャラ前面", light: "光" };
const toolLabels: Record<Tool, string> = { paint: "鉛筆", rectangle: "矩形", fill: "塗りつぶし", erase: "消しゴム", eyedropper: "スポイト", walkable: "通行可能", blocked: "通行不可", edge: "境界ブロック", entrance: "入口", stairs: "下り階段", select: "範囲選択", paste: "貼り付け" };
const visibility: Record<ManualVisualLayer, boolean> = { ground: true, structure: true, decoration: true, overhead: true, light: true };
const lockedLayers: Record<ManualVisualLayer, boolean> = { ground: false, structure: false, decoration: false, overhead: false, light: false };

layerSelect.innerHTML = MANUAL_LAYERS.map((layer) => `<option value="${layer}">${layerLabels[layer]}</option>`).join("");
toolSelect.innerHTML = (Object.keys(toolLabels) as Tool[]).map((tool) => `<option value="${tool}">${toolLabels[tool]}</option>`).join("");

function tileKey(tile: Pick<ManualTilePlacement, "sheet" | "frame" | "animationId">): string { return `${tile.sheet}:${tile.frame}:${tile.animationId ?? "static"}`; }

function cloneForHistory(map: ManualDungeonMap): ManualDungeonMap { return cloneManualMap(map); }

function historyFor(id: string): { undo: ManualDungeonMap[]; redo: ManualDungeonMap[] } {
  const existing = histories.get(id);
  if (existing) return existing;
  const created = { undo: [], redo: [] };
  histories.set(id, created);
  return created;
}

function beginTransaction(): void { if (!transactionBefore) transactionBefore = cloneForHistory(activeMap); }

function completeTransaction(): void {
  if (!transactionBefore) return;
  ensureManualMapPadding(activeMap);
  if (JSON.stringify(transactionBefore) !== JSON.stringify(activeMap)) {
    const history = historyFor(activeMap.id);
    history.undo.push(transactionBefore);
    if (history.undo.length > 100) history.undo.shift();
    history.redo = [];
    activeMap.updatedAt = new Date().toISOString();
    void saveActive();
  }
  transactionBefore = undefined;
  renderAll();
}

async function saveActive(): Promise<void> {
  maps = maps.map((map) => map.id === activeMap.id ? cloneManualMap(activeMap) : map);
  await repository.save(activeMap);
  status.textContent = "ブラウザ内へ保存しました。";
  renderMapList();
}

function mapFloorLabel(map: ManualDungeonMap): string { return `第${map.floor}階層 / ${MANUAL_MAP_PRESETS[map.kind].label}`; }

function nextMapFloor(kind: ManualDungeonMap["kind"]): number {
  return Math.max(0, ...maps.filter((map) => map.kind === kind).map((map) => map.floor)) + 1;
}

function resetBuildingDraft(): void {
  const firstInterior = maps.find((map) => map.kind === "interior");
  buildingDraft = { id: "", name: "", interiorMapId: firstInterior?.id ?? "" };
}

function selectBuildingAt(point: Point): void {
  if (activeMap.kind !== "town") return;
  const existing = activeMap.buildingLinks.find((link) => link.entrance.x === point.x && link.entrance.y === point.y);
  if (existing) buildingDraft = { id: existing.id, name: existing.name, interiorMapId: existing.interiorMapId };
  else resetBuildingDraft();
}

function missingBuildingLinks(map = activeMap): ManualBuildingLink[] {
  return map.buildingLinks.filter((link) => !maps.some((candidate) => candidate.id === link.interiorMapId && candidate.kind === "interior"));
}

function paletteCategoryForMap(map: ManualDungeonMap): string {
  // The only sheets exposed for new work are the exact TMX sheet/image pairs.
  // This makes a frame number mean the same thing in the editor and in Tiled.
  void map;
  return "tiled";
}

function setActive(next: ManualDungeonMap): void {
  activeMap = cloneManualMap(next);
  mapKindSelect.value = activeMap.kind;
  mapFloorInput.value = String(activeMap.floor);
  categorySelect.value = paletteCategoryForMap(activeMap);
  renderSheetSelect();
  selectedTool = "paint";
  toolSelect.value = selectedTool;
  selection = undefined;
  pointerStart = undefined;
  resetBuildingDraft();
  renderAll();
}

function changeMapKind(kind: ManualDungeonMap["kind"]): void {
  if (activeMap.kind === kind) return;
  const previous = cloneManualMap(activeMap);
  const next = cloneManualMap(activeMap);
  next.kind = kind;
  // Map kind changes gameplay semantics only.  Never crop an authored TMX
  // sample down to a UI preset: its own cells define the usable extent.
  activeMap = next;
  categorySelect.value = paletteCategoryForMap(activeMap);
  renderSheetSelect();
  const history = historyFor(activeMap.id);
  history.undo.push(previous);
  history.redo = [];
  void saveActive();
  renderAll();
}

function drawTile(context: CanvasRenderingContext2D, placement: ManualTilePlacement, x: number, y: number, scale = zoom): void {
  const image = images.get(placement.sheet);
  const sheet = CRAFTPIX_SHEETS[placement.sheet];
  if (!image || !sheet) return;
  const frame = animationFrame(placement.animationId, placement.frame);
  const sourceX = (frame % sheet.columns) * MANUAL_MAP_TILE;
  const sourceY = Math.floor(frame / sheet.columns) * MANUAL_MAP_TILE;
  const size = MANUAL_MAP_TILE * scale;
  const dx = (MARGIN + x * MANUAL_MAP_TILE) * scale;
  const dy = (MARGIN + y * MANUAL_MAP_TILE) * scale;
  context.save();
  context.translate(dx + size / 2, dy + size / 2);
  context.scale(placement.flipX ? -1 : 1, placement.flipY ? -1 : 1);
  context.rotate(((placement.rotation ?? 0) * Math.PI) / 180);
  context.drawImage(image, sourceX, sourceY, MANUAL_MAP_TILE, MANUAL_MAP_TILE, -size / 2, -size / 2, size, size);
  context.restore();
}

function animationFrame(id: string | undefined, fallback: number, now = performance.now()): number {
  const clip = animationClip(animationCatalog, id);
  if (!clip || clip.frames.length === 0) return fallback;
  const duration = clip.frames.reduce((total, frame) => total + frame.duration, 0);
  if (duration <= 0) return fallback;
  let cursor = (now - animationEpoch) % duration;
  for (const frame of clip.frames) {
    if (cursor < frame.duration) return frame.frame;
    cursor -= frame.duration;
  }
  return clip.frames[0]!.frame;
}

function renderMap(): void {
  const mapWidth = activeMap?.width ?? MANUAL_MAP_WIDTH;
  const mapHeight = activeMap?.height ?? MANUAL_MAP_HEIGHT;
  mapCanvas.setAttribute("aria-label", `${mapWidth}x${mapHeight} ${MANUAL_MAP_PRESETS[activeMap.kind]?.label ?? "マップ"}編集キャンバス`);
  mapCanvas.width = Math.round((MARGIN + mapWidth * MANUAL_MAP_TILE) * zoom);
  mapCanvas.height = Math.round((MARGIN + mapHeight * MANUAL_MAP_TILE) * zoom);
  mapContext.imageSmoothingEnabled = false;
  mapContext.fillStyle = "#101621";
  mapContext.fillRect(0, 0, mapCanvas.width, mapCanvas.height);
  mapContext.save();
  mapContext.scale(zoom, zoom);
  mapContext.fillStyle = "#151d2a";
  mapContext.fillRect(MARGIN, MARGIN, mapWidth * MANUAL_MAP_TILE, mapHeight * MANUAL_MAP_TILE);
  for (const layer of MANUAL_LAYERS) if (visibility[layer]) {
    for (const placement of activeMap.layers[layer]) drawTile(mapContext, placement, placement.x, placement.y, 1);
  }
  if (collisionToggle.checked) {
    for (let y = 0; y < mapHeight; y += 1) for (let x = 0; x < mapWidth; x += 1) {
      mapContext.fillStyle = activeMap.collision[manualCellIndex(x, y)] === 0 ? "rgba(60, 211, 144, .20)" : "rgba(238, 81, 93, .25)";
      mapContext.fillRect(MARGIN + x * MANUAL_MAP_TILE, MARGIN + y * MANUAL_MAP_TILE, MANUAL_MAP_TILE, MANUAL_MAP_TILE);
    }
  }
  if (gridToggle.checked) {
    mapContext.strokeStyle = "rgba(229, 237, 247, .22)";
    mapContext.lineWidth = 1;
    for (let x = 0; x <= mapWidth; x += 1) { mapContext.beginPath(); mapContext.moveTo(MARGIN + x * MANUAL_MAP_TILE + .5, MARGIN); mapContext.lineTo(MARGIN + x * MANUAL_MAP_TILE + .5, MARGIN + mapHeight * MANUAL_MAP_TILE); mapContext.stroke(); }
    for (let y = 0; y <= mapHeight; y += 1) { mapContext.beginPath(); mapContext.moveTo(MARGIN, MARGIN + y * MANUAL_MAP_TILE + .5); mapContext.lineTo(MARGIN + mapWidth * MANUAL_MAP_TILE, MARGIN + y * MANUAL_MAP_TILE + .5); mapContext.stroke(); }
  }
  mapContext.font = "7px monospace";
  mapContext.fillStyle = "#b7c3d8";
  for (let x = 0; x < mapWidth; x += 1) mapContext.fillText(String(activeMap.origin.x + x), MARGIN + x * MANUAL_MAP_TILE + 2, 10);
  for (let y = 0; y < mapHeight; y += 1) mapContext.fillText(String(activeMap.origin.y + y), 2, MARGIN + y * MANUAL_MAP_TILE + 10);
  mapContext.strokeStyle = "#ff5b67";
  mapContext.lineWidth = 2;
  for (const key of activeMap.hardEdges) {
    const [xText, yText, direction] = key.split(",");
    const x = Number(xText); const y = Number(yText);
    mapContext.beginPath();
    if (direction === "east") { mapContext.moveTo(MARGIN + (x + 1) * MANUAL_MAP_TILE, MARGIN + y * MANUAL_MAP_TILE); mapContext.lineTo(MARGIN + (x + 1) * MANUAL_MAP_TILE, MARGIN + (y + 1) * MANUAL_MAP_TILE); }
    else { mapContext.moveTo(MARGIN + x * MANUAL_MAP_TILE, MARGIN + (y + 1) * MANUAL_MAP_TILE); mapContext.lineTo(MARGIN + (x + 1) * MANUAL_MAP_TILE, MARGIN + (y + 1) * MANUAL_MAP_TILE); }
    mapContext.stroke();
  }
  const marker = (point: { x: number; y: number } | undefined, label: string, color: string): void => {
    if (!point) return;
    mapContext.fillStyle = color; mapContext.font = "bold 13px sans-serif";
    mapContext.fillText(label, MARGIN + point.x * MANUAL_MAP_TILE + 2, MARGIN + point.y * MANUAL_MAP_TILE + 13);
  };
  marker(activeMap.entrance, "↑", "#ffe367");
  marker(activeMap.stairs, "↓", "#8bdcff");
  if (activeMap.kind === "town") for (const link of activeMap.buildingLinks) {
    const x = MARGIN + link.entrance.x * MANUAL_MAP_TILE;
    const y = MARGIN + link.entrance.y * MANUAL_MAP_TILE;
    mapContext.fillStyle = "rgba(95, 211, 183, .28)";
    mapContext.fillRect(x + 1, y + 1, MANUAL_MAP_TILE - 2, MANUAL_MAP_TILE - 2);
    mapContext.strokeStyle = "#73e0cd";
    mapContext.lineWidth = 1;
    mapContext.strokeRect(x + 1.5, y + 1.5, MANUAL_MAP_TILE - 3, MANUAL_MAP_TILE - 3);
    mapContext.fillStyle = "#e7fff8";
    mapContext.font = "bold 7px sans-serif";
    mapContext.fillText(link.id.slice(0, 8), x + 2, y + 8);
  }
  if (selection) {
    const minX = Math.min(selection.start.x, selection.end.x); const maxX = Math.max(selection.start.x, selection.end.x);
    const minY = Math.min(selection.start.y, selection.end.y); const maxY = Math.max(selection.start.y, selection.end.y);
    mapContext.strokeStyle = "#ffffff"; mapContext.lineWidth = 2;
    mapContext.strokeRect(MARGIN + minX * MANUAL_MAP_TILE + 1, MARGIN + minY * MANUAL_MAP_TILE + 1, (maxX - minX + 1) * MANUAL_MAP_TILE - 2, (maxY - minY + 1) * MANUAL_MAP_TILE - 2);
  }
  mapContext.restore();
}

function allowedSheets(): CraftpixSheetId[] {
  const category = categorySelect.value;
  const tiledSheets = Object.keys(CRAFTPIX_SHEETS).filter((sheet) => (sheet.startsWith("dungeon-base-") || sheet.startsWith("main-home-") || sheet.startsWith("guild-hall-") || sheet.startsWith("glassblower-workshop-") || sheet.startsWith("dungeon-objects-")) && !metatileSheets.has(sheet)) as CraftpixSheetId[];
  if (category === "tiled") return tiledSheets;
  if (category === "floor") return tiledSheets.filter((sheet) => sheet.includes("walls-floor") || sheet.includes("walls-interior") || sheet.includes("ground") || sheet.includes("floor"));
  if (category === "water") return tiledSheets.filter((sheet) => sheet.includes("water") || sheet.includes("coasts"));
  if (category === "town") return tiledSheets.filter((sheet) => sheet.startsWith("main-home-") || sheet.startsWith("guild-hall-") || sheet.startsWith("glassblower-workshop-"));
  if (category === "interior") return tiledSheets.filter((sheet) => sheet.includes("interior"));
  if (category === "environment") return tiledSheets;
  if (category === "decor") return tiledSheets.filter((sheet) => sheet.includes("object") || sheet.includes("detail") || sheet.includes("door") || sheet.includes("window") || sheet.includes("forge") || sheet.includes("fire"));
  if (category === "source") return tiledSheets.filter((sheet) => [...sourceFrames].some((key) => key.startsWith(`${sheet}:`)));
  return tiledSheets;
}

/**
 * A Tiled animation belongs to its source tile id.  The other frames are only
 * timeline images and must never be offered as separate placeable assets.
 */
function placeablePaletteTiles(sheet: CraftpixSheetId): PaletteTile[] {
  const source = CRAFTPIX_SHEETS[sheet];
  if (!source) return [];
  const animationByTile = new Map<number, string>();
  const timelineFrames = new Set<number>();
  const prefix = `tiled:${sheet}:`;
  for (const clip of animationCatalog?.clips ?? []) {
    if (!clip.id.startsWith(prefix)) continue;
    const tileId = Number(clip.id.slice(prefix.length));
    if (!Number.isInteger(tileId) || tileId < 0 || tileId >= source.frames) continue;
    animationByTile.set(tileId, clip.id);
    for (const frame of clip.frames) timelineFrames.add(frame.frame);
  }
  const entries: PaletteTile[] = [];
  for (let frame = 0; frame < source.frames; frame += 1) {
    const animationId = animationByTile.get(frame);
    if (animationId) entries.push({ frame, animationId });
    else if (!timelineFrames.has(frame)) entries.push({ frame });
  }
  return entries;
}

function isPrefabCategory(): boolean {
  return categorySelect.value === "prefab" || categorySelect.value === "prefab-wall";
}

function prefabsForCategory(): TiledPrefab[] {
  if (categorySelect.value !== "prefab-wall") return tiledPrefabs;
  return tiledPrefabs.filter((prefab) => /wall|floor|ground/.test(prefab.sheet));
}

function renderSheetSelect(): void {
  if (isPrefabCategory()) {
    const prefabSheets = [...new Set(prefabsForCategory().map((prefab) => prefab.sheet))];
    if (!prefabSheets.includes(paletteSheet)) paletteSheet = prefabSheets[0] ?? "dungeon-base-walls-floor";
    sheetSelect.disabled = false;
    sheetSelect.innerHTML = prefabSheets.map((sheet) => `<option value="${sheet}">${CRAFTPIX_SHEETS[sheet].label}</option>`).join("");
    sheetSelect.value = paletteSheet;
    return;
  }
  sheetSelect.disabled = false;
  const allowed = allowedSheets();
  if (!allowed.includes(paletteSheet)) paletteSheet = allowed[0] ?? "dungeon-base-walls-floor";
  sheetSelect.innerHTML = allowed.map((sheet) => `<option value="${sheet}">${CRAFTPIX_SHEETS[sheet].label}</option>`).join("");
  sheetSelect.value = paletteSheet;
}

function renderPalette(): void {
  const sheet = CRAFTPIX_SHEETS[paletteSheet];
  const image = images.get(paletteSheet);
  const scale = 2;
  if (isPrefabCategory()) {
    const prefabs = prefabsForCategory().filter((prefab) => prefab.sheet === paletteSheet);
    const padding = 4;
    const labelHeight = 12;
    const maxWidth = Math.max(1, ...prefabs.map((prefab) => prefab.width));
    paletteCanvas.width = (maxWidth * MANUAL_MAP_TILE + padding * 2) * scale;
    palettePrefabLayouts = [];
    let cursorY = padding;
    for (const prefab of prefabs) {
      palettePrefabLayouts.push({ prefab, x: padding, y: cursorY + labelHeight });
      cursorY += labelHeight + prefab.height * MANUAL_MAP_TILE + padding * 2;
    }
    paletteCanvas.height = Math.max(1, cursorY * scale);
    paletteContext.imageSmoothingEnabled = false;
    paletteContext.fillStyle = "#101621";
    paletteContext.fillRect(0, 0, paletteCanvas.width, paletteCanvas.height);
    for (const layout of palettePrefabLayouts) {
      const { prefab, x, y } = layout;
      paletteContext.fillStyle = "#cbd8ec";
      paletteContext.font = "10px sans-serif";
      paletteContext.fillText(`${prefab.label} (${prefab.width}×${prefab.height})`, x * scale, (y - 3) * scale);
      for (const placement of prefab.placements) {
        const prefabSheet = CRAFTPIX_SHEETS[placement.sheet];
        const prefabImage = images.get(placement.sheet);
        if (!prefabSheet || !prefabImage) continue;
        const frame = animationFrame(placement.animationId, placement.frame);
        paletteContext.drawImage(prefabImage, (frame % prefabSheet.columns) * MANUAL_MAP_TILE, Math.floor(frame / prefabSheet.columns) * MANUAL_MAP_TILE, MANUAL_MAP_TILE, MANUAL_MAP_TILE, (x + placement.x * MANUAL_MAP_TILE) * scale, (y + placement.y * MANUAL_MAP_TILE) * scale, MANUAL_MAP_TILE * scale, MANUAL_MAP_TILE * scale);
      }
      paletteContext.strokeStyle = selectedStamp.prefab?.id === prefab.id ? "#ffdf66" : "rgba(255,255,255,.28)";
      paletteContext.lineWidth = selectedStamp.prefab?.id === prefab.id ? 3 : 1;
      paletteContext.strokeRect(x * scale + .5, y * scale + .5, prefab.width * MANUAL_MAP_TILE * scale - 1, prefab.height * MANUAL_MAP_TILE * scale - 1);
    }
    stampInfo.textContent = `個別アセット ${prefabs.length}件。完成形に必要な全セルとアニメーションをまとめて配置します。`;
    return;
  }
  paletteTiles = placeablePaletteTiles(paletteSheet).filter((tile) => categorySelect.value !== "source" || sourceFrames.has(`${paletteSheet}:${tile.frame}`));
  const columns = 8;
  paletteCanvas.width = columns * MANUAL_MAP_TILE * scale;
  paletteCanvas.height = Math.max(1, Math.ceil(paletteTiles.length / columns)) * MANUAL_MAP_TILE * scale;
  paletteContext.imageSmoothingEnabled = false;
  paletteContext.fillStyle = "#101621";
  paletteContext.fillRect(0, 0, paletteCanvas.width, paletteCanvas.height);
  for (const [index, tile] of paletteTiles.entries()) {
    const x = (index % columns) * MANUAL_MAP_TILE * scale;
    const y = Math.floor(index / columns) * MANUAL_MAP_TILE * scale;
    const frame = animationFrame(tile.animationId, tile.frame);
    if (image) paletteContext.drawImage(image, (frame % sheet.columns) * MANUAL_MAP_TILE, Math.floor(frame / sheet.columns) * MANUAL_MAP_TILE, MANUAL_MAP_TILE, MANUAL_MAP_TILE, x, y, MANUAL_MAP_TILE * scale, MANUAL_MAP_TILE * scale);
    if (tile.animationId) {
      paletteContext.fillStyle = "#55d8ff";
      paletteContext.fillRect(x + 2, y + 2, 5, 5);
    }
    paletteContext.strokeStyle = selectedStamp.sheet === paletteSheet && selectedStamp.frame === tile.frame && selectedStamp.animationId === tile.animationId ? "#ffdf66" : "rgba(255,255,255,.22)";
    paletteContext.lineWidth = selectedStamp.sheet === paletteSheet && selectedStamp.frame === tile.frame && selectedStamp.animationId === tile.animationId ? 3 : 1;
    paletteContext.strokeRect(x + .5, y + .5, MANUAL_MAP_TILE * scale - 1, MANUAL_MAP_TILE * scale - 1);
  }
  stampInfo.textContent = `${sheet.label} / ${paletteTiles.length}個の配置可能タイル。アニメーションは元タイルを置くと自動で付きます。`;
}

function renderMapFragment(): void {
  const copySelectionButton = root.querySelector<HTMLButtonElement>("[data-action=copy-selection]");
  const clearSelectionButton = root.querySelector<HTMLButtonElement>("[data-action=clear-selection]");
  if (copySelectionButton) copySelectionButton.disabled = !selection;
  if (clearSelectionButton) clearSelectionButton.disabled = !selection;
  if (!mapFragment) {
    fragmentCanvas.width = 1;
    fragmentCanvas.height = 1;
    fragmentInfo.textContent = "コピーした区画はありません。";
    return;
  }
  const fragment = mapFragment;
  const scale = Math.max(0.5, Math.min(2, 250 / (fragment.width * MANUAL_MAP_TILE), 180 / (fragment.height * MANUAL_MAP_TILE)));
  fragmentCanvas.width = Math.max(1, Math.round(fragment.width * MANUAL_MAP_TILE * scale));
  fragmentCanvas.height = Math.max(1, Math.round(fragment.height * MANUAL_MAP_TILE * scale));
  fragmentContext.imageSmoothingEnabled = false;
  fragmentContext.fillStyle = "#151d2a";
  fragmentContext.fillRect(0, 0, fragmentCanvas.width, fragmentCanvas.height);
  for (const layer of MANUAL_LAYERS) for (const placement of fragment.layers[layer]) {
    const image = images.get(placement.sheet);
    const sheet = CRAFTPIX_SHEETS[placement.sheet];
    if (!image || !sheet) continue;
    const size = MANUAL_MAP_TILE * scale;
    fragmentContext.save();
    fragmentContext.translate(placement.x * size + size / 2, placement.y * size + size / 2);
    fragmentContext.scale(placement.flipX ? -1 : 1, placement.flipY ? -1 : 1);
    fragmentContext.rotate(((placement.rotation ?? 0) * Math.PI) / 180);
    fragmentContext.drawImage(image, (placement.frame % sheet.columns) * MANUAL_MAP_TILE, Math.floor(placement.frame / sheet.columns) * MANUAL_MAP_TILE, MANUAL_MAP_TILE, MANUAL_MAP_TILE, -size / 2, -size / 2, size, size);
    fragmentContext.restore();
  }
  fragmentContext.strokeStyle = "rgba(229, 237, 247, .25)";
  fragmentContext.lineWidth = 1;
  for (let x = 0; x <= fragment.width; x += 1) { fragmentContext.beginPath(); fragmentContext.moveTo(x * MANUAL_MAP_TILE * scale + .5, 0); fragmentContext.lineTo(x * MANUAL_MAP_TILE * scale + .5, fragmentCanvas.height); fragmentContext.stroke(); }
  for (let y = 0; y <= fragment.height; y += 1) { fragmentContext.beginPath(); fragmentContext.moveTo(0, y * MANUAL_MAP_TILE * scale + .5); fragmentContext.lineTo(fragmentCanvas.width, y * MANUAL_MAP_TILE * scale + .5); fragmentContext.stroke(); }
  const placements = MANUAL_LAYERS.reduce((count, layer) => count + fragment.layers[layer].length, 0);
  fragmentInfo.textContent = `${fragment.width}×${fragment.height} セル / ${placements} 素材 / 通行・境界もコピー済み`;
}

function renderMapList(): void {
  progress.textContent = `${maps.length} / 10`;
  mapList.innerHTML = maps.map((map) => `<button class="map-list-item ${map.id === activeMap.id ? "active" : ""}" data-map-id="${map.id}">${map.name}<small>${mapFloorLabel(map)}${map.legacyReference ? " / 見本" : ""}</small></button>`).join("");
  mapList.querySelectorAll<HTMLButtonElement>("[data-map-id]").forEach((button) => button.addEventListener("click", () => {
    const next = maps.find((map) => map.id === button.dataset.mapId); if (next) setActive(next);
  }));
}

function renderBuildingLinks(): void {
  const isTown = activeMap.kind === "town";
  buildingLinkPanel.hidden = !isTown;
  if (!isTown) return;
  const interiors = maps.filter((map) => map.kind === "interior");
  if (!buildingDraft.interiorMapId || !interiors.some((map) => map.id === buildingDraft.interiorMapId)) buildingDraft.interiorMapId = interiors[0]?.id ?? "";
  buildingIdInput.value = buildingDraft.id;
  buildingNameInput.value = buildingDraft.name;
  buildingInteriorSelect.innerHTML = interiors.length
    ? interiors.map((map) => `<option value="${map.id}">${map.name}（第${map.floor}階層）</option>`).join("")
    : "<option value=\"\">内部マップがありません</option>";
  buildingInteriorSelect.value = buildingDraft.interiorMapId;
  buildingInteriorSelect.disabled = interiors.length === 0;
  const saveButton = root.querySelector<HTMLButtonElement>("[data-action=save-building-link]");
  if (saveButton) saveButton.disabled = !pointerStart || interiors.length === 0;
  const selectedPoint = pointerStart;
  const linked = selectedPoint && activeMap.buildingLinks.find((link) => link.entrance.x === selectedPoint.x && link.entrance.y === selectedPoint.y);
  buildingCell.textContent = selectedPoint
    ? `入口セル: (${selectedPoint.x}, ${selectedPoint.y})${linked ? ` / ${linked.name}` : ""}`
    : "入口セルを選択してください。";
  buildingLinkList.innerHTML = activeMap.buildingLinks.length
    ? activeMap.buildingLinks.map((link) => {
      const target = maps.find((map) => map.id === link.interiorMapId);
      return `<div class="building-link-item"><button data-building-id="${link.id}"><strong>${link.name}</strong><small>${link.id} / (${link.entrance.x}, ${link.entrance.y}) → ${target?.name ?? "リンク切れ"}</small></button><button data-open-interior="${link.interiorMapId}" ${target?.kind === "interior" ? "" : "disabled"}>内部を編集</button></div>`;
    }).join("")
    : "<p class=\"small\">登録済みの建物はありません。</p>";
  buildingLinkList.querySelectorAll<HTMLButtonElement>("[data-building-id]").forEach((button) => button.addEventListener("click", () => {
    const link = activeMap.buildingLinks.find((entry) => entry.id === button.dataset.buildingId);
    if (!link) return;
    pointerStart = { ...link.entrance, localX: 0, localY: 0 };
    buildingDraft = { id: link.id, name: link.name, interiorMapId: link.interiorMapId };
    renderAll();
  }));
  buildingLinkList.querySelectorAll<HTMLButtonElement>("[data-open-interior]").forEach((button) => button.addEventListener("click", () => {
    const interior = maps.find((map) => map.id === button.dataset.openInterior && map.kind === "interior");
    if (interior) setActive(interior);
  }));
}

function renderLayerList(): void {
  layerList.innerHTML = MANUAL_LAYERS.map((layer) => `<label class="layer-row ${layer === selectedLayer ? "active" : ""}"><input type="radio" name="layer-row" value="${layer}" ${layer === selectedLayer ? "checked" : ""}> ${layerLabels[layer]} <span><input type="checkbox" data-visible="${layer}" ${visibility[layer] ? "checked" : ""}>表示 <input type="checkbox" data-lock="${layer}" ${lockedLayers[layer] ? "checked" : ""}>ロック</span></label>`).join("");
  layerList.querySelectorAll<HTMLInputElement>("input[name=layer-row]").forEach((input) => input.addEventListener("change", () => { selectedLayer = input.value as ManualVisualLayer; layerSelect.value = selectedLayer; renderAll(); }));
  layerList.querySelectorAll<HTMLInputElement>("[data-visible]").forEach((input) => input.addEventListener("change", () => { visibility[input.dataset.visible as ManualVisualLayer] = input.checked; renderMap(); }));
  layerList.querySelectorAll<HTMLInputElement>("[data-lock]").forEach((input) => input.addEventListener("change", () => { lockedLayers[input.dataset.lock as ManualVisualLayer] = input.checked; }));
}

function renderInfo(point = pointerStart): void {
  const layers = point ? MANUAL_LAYERS.map((layer) => ({ layer, placement: topPlacement(activeMap, layer, point.x, point.y) })).filter((entry) => entry.placement) : [];
  if (!point) { selectedInfo.textContent = "キャンバスをクリックすると座標・素材・通行情報を表示します。"; return; }
  const building = activeMap.buildingLinks.find((link) => link.entrance.x === point.x && link.entrance.y === point.y);
  const interior = building ? maps.find((map) => map.id === building.interiorMapId) : undefined;
  selectedInfo.innerHTML = `<strong>(${point.x}, ${point.y})</strong><br>通行: ${activeMap.collision[manualCellIndex(point.x, point.y)] === 0 ? "可能" : "不可"}${activeMap.collisionLocked[manualCellIndex(point.x, point.y)] ? "（手動固定）" : ""}${building ? `<br>建物: ${building.name} (${building.id}) → ${interior?.name ?? "リンク切れ"}` : ""}<br>${layers.map(({ layer, placement }) => `${layerLabels[layer]}: ${placement!.sheet} / #${placement!.frame}`).join("<br>") || "配置なし"}`;
}

function renderValidation(): void {
  const issues = [...validateManualMap(activeMap), ...missingBuildingLinks().map((link) => ({ severity: "error" as const, code: "building-link-target", message: `建物「${link.name}」の内部マップが見つかりません。` }))];
  validation.innerHTML = issues.length ? issues.map((issue) => `<p class="${issue.severity}">${issue.severity === "error" ? "エラー" : "注意"}: ${issue.message}</p>`).join("") : "<p class=\"ok\">検証OK：試遊できます。</p>";
}

function renderAll(): void { mapFloorInput.value = String(activeMap.floor); renderMap(); renderPalette(); renderMapFragment(); renderMapList(); renderBuildingLinks(); renderLayerList(); renderInfo(); renderValidation(); }

function canvasPoint(event: PointerEvent): Point | undefined {
  const rect = mapCanvas.getBoundingClientRect();
  const rawX = (event.clientX - rect.left) / zoom - MARGIN;
  const rawY = (event.clientY - rect.top) / zoom - MARGIN;
  const x = Math.floor(rawX / MANUAL_MAP_TILE); const y = Math.floor(rawY / MANUAL_MAP_TILE);
  if (x < 0 || y < 0 || x >= activeMap.width || y >= activeMap.height) return undefined;
  return { x, y, localX: rawX - x * MANUAL_MAP_TILE, localY: rawY - y * MANUAL_MAP_TILE };
}

function applyStamp(point: Point): void {
  if (lockedLayers[selectedLayer]) return;
  if (selectedStamp.prefab) {
    for (const placement of selectedStamp.prefab.placements) {
      const targetX = point.x + placement.x; const targetY = point.y + placement.y;
      if (targetX < 0 || targetY < 0 || targetX >= activeMap.width || targetY >= activeMap.height) continue;
      placeManualTile(activeMap, placement.layer, {
        x: targetX,
        y: targetY,
        sheet: placement.sheet,
        frame: placement.frame,
        animationId: placement.animationId,
        flipX: placement.flipX,
        flipY: placement.flipY,
        rotation: placement.flipDiagonal ? 90 : undefined,
      }, { stack: stackToggle.checked, applySuggestion: suggestionToggle.checked });
    }
    return;
  }
  const sheet = CRAFTPIX_SHEETS[selectedStamp.sheet];
  for (let y = 0; y < selectedStamp.height; y += 1) for (let x = 0; x < selectedStamp.width; x += 1) {
    const targetX = point.x + x; const targetY = point.y + y;
    const frame = selectedStamp.frame + y * sheet.columns + x;
    if (targetX >= activeMap.width || targetY >= activeMap.height || frame >= sheet.frames) continue;
    placeManualTile(activeMap, selectedLayer, { x: targetX, y: targetY, sheet: selectedStamp.sheet, frame, animationId: selectedStamp.animationId }, { stack: stackToggle.checked, applySuggestion: suggestionToggle.checked });
  }
}

function fillAt(point: Point): void {
  if (lockedLayers[selectedLayer]) return;
  const source = topPlacement(activeMap, selectedLayer, point.x, point.y);
  const sourceKey = source ? tileKey(source) : "empty";
  const queue = [{ x: point.x, y: point.y }]; const visited = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!; const key = `${current.x},${current.y}`;
    if (visited.has(key)) continue; visited.add(key);
    const currentTile = topPlacement(activeMap, selectedLayer, current.x, current.y);
    if ((currentTile ? tileKey(currentTile) : "empty") !== sourceKey) continue;
    placeManualTile(activeMap, selectedLayer, { x: current.x, y: current.y, sheet: selectedStamp.sheet, frame: selectedStamp.frame, animationId: selectedStamp.animationId }, { stack: false, applySuggestion: suggestionToggle.checked });
    for (const direction of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
      const next = { x: current.x + direction.x, y: current.y + direction.y };
      if (next.x >= 0 && next.y >= 0 && next.x < activeMap.width && next.y < activeMap.height) queue.push(next);
    }
  }
}

function edgeAt(point: Point): string | undefined {
  const distances = [
    { distance: point.localX, x: point.x - 1, y: point.y, direction: "east" as const },
    { distance: MANUAL_MAP_TILE - point.localX, x: point.x, y: point.y, direction: "east" as const },
    { distance: point.localY, x: point.x, y: point.y - 1, direction: "south" as const },
    { distance: MANUAL_MAP_TILE - point.localY, x: point.x, y: point.y, direction: "south" as const },
  ].filter((edge) => edge.x >= 0 && edge.y >= 0 && edge.x < activeMap.width && edge.y < activeMap.height);
  const nearest = distances.sort((a, b) => a.distance - b.distance)[0];
  if (!nearest || (nearest.direction === "east" && nearest.x >= activeMap.width - 1) || (nearest.direction === "south" && nearest.y >= activeMap.height - 1)) return undefined;
  return manualEdgeKey(nearest.x, nearest.y, nearest.direction);
}

function applyTool(point: Point): void {
  pointerStart = point; renderInfo(point);
  const onceKey = `${selectedTool}:${point.x}:${point.y}`;
  if (lastPainted.has(onceKey)) return;
  lastPainted.add(onceKey);
  if (selectedTool === "paint") applyStamp(point);
  else if (selectedTool === "erase") removeTopPlacement(activeMap, selectedLayer, point.x, point.y);
  else if (selectedTool === "eyedropper") {
    const picked = topPlacement(activeMap, selectedLayer, point.x, point.y);
    if (picked) { selectedStamp = { sheet: picked.sheet, frame: picked.frame, width: 1, height: 1 }; paletteSheet = picked.sheet; categorySelect.value = "all"; renderSheetSelect(); }
  } else if (selectedTool === "walkable" || selectedTool === "blocked") {
    const index = manualCellIndex(point.x, point.y); activeMap.collision[index] = selectedTool === "walkable" ? 0 : 1; activeMap.collisionLocked[index] = true;
  } else if (selectedTool === "edge") {
    const edge = edgeAt(point); if (edge) activeMap.hardEdges = activeMap.hardEdges.includes(edge) ? activeMap.hardEdges.filter((key) => key !== edge) : [...activeMap.hardEdges, edge];
  } else if (selectedTool === "entrance") {
    activeMap.entrance = { x: point.x, y: point.y }; activeMap.collision[manualCellIndex(point.x, point.y)] = 0; activeMap.collisionLocked[manualCellIndex(point.x, point.y)] = true;
  } else if (selectedTool === "stairs") {
    activeMap.stairs = { x: point.x, y: point.y }; activeMap.collision[manualCellIndex(point.x, point.y)] = 0; activeMap.collisionLocked[manualCellIndex(point.x, point.y)] = true;
  } else if (selectedTool === "paste") {
    if (!mapFragment) { status.textContent = "貼り付ける区画がありません。まず範囲をコピーしてください。"; return; }
    if (pasteManualMapFragment(activeMap, mapFragment, point)) status.textContent = `${mapFragment.width}×${mapFragment.height} セルの区画を貼り付けました。`;
  }
}

function applyRectangle(start: Point, end: Point): void {
  const minX = Math.min(start.x, end.x); const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y); const maxY = Math.max(start.y, end.y);
  for (let y = minY; y <= maxY; y += selectedStamp.height) for (let x = minX; x <= maxX; x += selectedStamp.width) applyStamp({ x, y, localX: 0, localY: 0 });
}

function download(value: unknown, name: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = name; link.click(); URL.revokeObjectURL(link.href);
}

function mapKindForSource(source: TiledSourceMap): ManualDungeonMap["kind"] {
  if (source.id.includes("exterior")) return "town";
  if (source.id.includes("interior")) return "interior";
  return "dungeon";
}

/** Creates an editable, pixel-faithful copy of a vendor TMX sample. */
function mapFromTiledSource(source: TiledSourceMap): ManualDungeonMap {
  const map = createBlankManualMap(`${source.pack} / ${source.id}`, mapKindForSource(source));
  map.width = source.bounds.width;
  map.height = source.bounds.height;
  map.origin = { x: source.bounds.x, y: source.bounds.y };
  map.collision = Array(map.width * map.height).fill(1);
  map.collisionLocked = Array(map.width * map.height).fill(false);
  const blocked = new Set<number>();
  const walkable = new Set<number>();
  for (const sourceLayer of source.layers) {
    const layer = sourceLayer.kind;
    const waterLayer = /water|pool/i.test(sourceLayer.name);
    for (const tile of sourceLayer.placements) {
      const x = tile.x - source.bounds.x;
      const y = tile.y - source.bounds.y;
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      map.layers[layer].push({
        x,
        y,
        sheet: tile.sheet,
        frame: tile.frame,
        animationId: tile.animationId,
        flipX: tile.flipX,
        flipY: tile.flipY,
        // Phaser/canvas can reproduce a diagonal flip only approximately;
        // preserving it as a quarter turn is preferable to selecting another
        // frame, and the original flag remains in the source catalog.
        rotation: tile.flipDiagonal ? 90 : undefined,
      });
      const index = fixedManualCellIndex(map, x, y);
      if (layer === "ground" && !waterLayer) walkable.add(index);
      if (layer === "structure") blocked.add(index);
    }
  }
  for (const index of walkable) map.collision[index] = 0;
  for (const index of blocked) map.collision[index] = 1;
  return map;
}

async function initialize(): Promise<void> {
  try {
    const [legacy, tiled] = await Promise.all([
      fetch("/assets/dungeons/craftpix-animation-catalog.json").then((response) => response.json() as Promise<CraftpixAnimationCatalog>),
      fetch("/assets/craftpix/tiled-map-catalog.json").then((response) => response.json() as Promise<{ animations?: CraftpixAnimationCatalog["clips"]; sourceMaps?: TiledSourceMap[]; prefabs?: TiledPrefab[]; sheets?: Array<{ id: CraftpixSheetId; animationMode?: "none" | "tile" | "composite"; usageMode?: "tile" | "metatile" }> }>),
    ]);
    animationCatalog = { version: 2, tile: 16, clips: [...legacy.clips, ...(tiled.animations ?? [])] };
    tiledSourceMaps = tiled.sourceMaps ?? [];
    metatileSheets = new Set((tiled.sheets ?? []).filter((sheet) => sheet.usageMode === "metatile").map((sheet) => sheet.id));
    tiledPrefabs = tiled.prefabs ?? [];
  } catch { animationCatalog = undefined; }
  for (const [sheetId, sheet] of Object.entries(CRAFTPIX_SHEETS) as [CraftpixSheetId, (typeof CRAFTPIX_SHEETS)[CraftpixSheetId]][]) {
    const image = new Image(); image.src = `/${sheet.path}`; images.set(sheetId, image);
  }
  await Promise.all([...images.values()].map((image) => image.decode().catch(() => undefined)));
  maps = await repository.list();
  if (!maps.length && tiledSourceMaps.length) {
    const sample = mapFromTiledSource(tiledSourceMaps.find((source) => source.id === "Dungeon1") ?? tiledSourceMaps[0]!);
    maps = [sample]; await repository.save(sample);
  }
  if (!maps.length) { const blank = createBlankManualMap(); maps = [blank]; await repository.save(blank); }
  for (const map of maps) for (const layer of MANUAL_LAYERS) for (const placement of map.layers[layer]) sourceFrames.add(tileKey(placement));
  activeMap = cloneManualMap(maps[0]!);
  mapKindSelect.value = activeMap.kind;
  categorySelect.value = paletteCategoryForMap(activeMap);
  renderSheetSelect();
  status.textContent = "準備完了。空白マップまたは見本複製から作成できます。";
  renderAll();
  const redrawAnimations = (): void => {
    if (animationCatalog && (activeMap.layers.ground.some((tile) => tile.animationId) || activeMap.layers.structure.some((tile) => tile.animationId) || activeMap.layers.decoration.some((tile) => tile.animationId) || activeMap.layers.overhead.some((tile) => tile.animationId) || activeMap.layers.light.some((tile) => tile.animationId))) renderMap();
    requestAnimationFrame(redrawAnimations);
  };
  requestAnimationFrame(redrawAnimations);
}

mapCanvas.addEventListener("pointerdown", (event) => {
  const point = canvasPoint(event); if (!point) return;
  mapCanvas.setPointerCapture(event.pointerId); painting = true; lastPainted = new Set(); pointerStart = point; selectBuildingAt(point); renderInfo(point);
  if (selectedTool === "select") { selection = { start: point, end: point }; renderAll(); return; }
  if (selectedTool === "paste") { beginTransaction(); applyTool(point); completeTransaction(); painting = false; return; }
  beginTransaction();
  if (selectedTool === "rectangle") { selection = { start: point, end: point }; renderMap(); return; }
  if (selectedTool === "fill") { applyTool(point); fillAt(point); completeTransaction(); painting = false; return; }
  applyTool(point); renderAll();
});
mapCanvas.addEventListener("pointermove", (event) => {
  const point = canvasPoint(event); if (!point) return;
  if (painting && (selectedTool === "rectangle" || selectedTool === "select") && selection) { selection.end = point; renderMap(); return; }
  if (painting && ["paint", "erase", "walkable", "blocked", "edge"].includes(selectedTool)) { applyTool(point); renderAll(); }
  else { pointerStart = point; renderInfo(point); }
});
mapCanvas.addEventListener("pointerup", (event) => {
  if (!painting) return;
  const point = canvasPoint(event);
  if (selectedTool === "select") {
    if (selection && point) selection.end = point;
    painting = false;
    renderAll();
    return;
  }
  if (selectedTool === "rectangle" && selection && point) { selection.end = point; applyRectangle(selection.start, selection.end); }
  selection = undefined; painting = false; completeTransaction();
});
mapCanvas.addEventListener("pointercancel", () => { painting = false; if (selectedTool !== "select") selection = undefined; completeTransaction(); });

paletteCanvas.addEventListener("pointerdown", (event) => {
  if (isPrefabCategory()) return;
  const rect = paletteCanvas.getBoundingClientRect(); const scale = paletteCanvas.width / rect.width;
  const x = Math.floor(((event.clientX - rect.left) * scale) / (MANUAL_MAP_TILE * 2)); const y = Math.floor(((event.clientY - rect.top) * scale) / (MANUAL_MAP_TILE * 2));
  const tile = paletteTiles[y * 8 + x];
  if (tile) selectedStamp = { sheet: paletteSheet, frame: tile.frame, width: 1, height: 1, animationId: tile.animationId };
  renderPalette();
});
paletteCanvas.addEventListener("pointerup", (event) => {
  const rect = paletteCanvas.getBoundingClientRect(); const scale = paletteCanvas.width / rect.width;
  const x = Math.floor(((event.clientX - rect.left) * scale) / (MANUAL_MAP_TILE * 2)); const y = Math.floor(((event.clientY - rect.top) * scale) / (MANUAL_MAP_TILE * 2));
  if (isPrefabCategory()) {
    const localX = (event.clientX - rect.left) * scale / 2;
    const localY = (event.clientY - rect.top) * scale / 2;
    const layout = palettePrefabLayouts.find((entry) => localX >= entry.x && localY >= entry.y && localX < entry.x + entry.prefab.width * MANUAL_MAP_TILE && localY < entry.y + entry.prefab.height * MANUAL_MAP_TILE);
    if (layout) {
      const first = layout.prefab.placements[0]!;
      selectedStamp = { sheet: first.sheet, frame: first.frame, width: layout.prefab.width, height: layout.prefab.height, animationId: first.animationId, prefab: layout.prefab };
    }
    renderPalette();
    return;
  }
  const tile = paletteTiles[y * 8 + x];
  if (tile) selectedStamp = { sheet: paletteSheet, frame: tile.frame, width: 1, height: 1, animationId: tile.animationId };
  renderPalette();
});

layerSelect.addEventListener("change", () => { selectedLayer = layerSelect.value as ManualVisualLayer; renderAll(); });
mapKindSelect.addEventListener("change", () => changeMapKind(mapKindSelect.value as ManualDungeonMap["kind"]));
mapFloorInput.addEventListener("change", () => {
  const floor = Number(mapFloorInput.value);
  if (!Number.isInteger(floor) || floor < 1 || floor > 99) { mapFloorInput.value = String(activeMap.floor); return; }
  if (floor === activeMap.floor) return;
  beginTransaction();
  activeMap.floor = floor;
  completeTransaction();
});
toolSelect.addEventListener("change", () => { selectedTool = toolSelect.value as Tool; });
collisionToggle.addEventListener("change", renderMap);
gridToggle.addEventListener("change", renderMap);
zoomSelect.addEventListener("change", () => { zoom = Number(zoomSelect.value); renderMap(); });
categorySelect.addEventListener("change", () => { renderSheetSelect(); renderPalette(); });
sheetSelect.addEventListener("change", () => { paletteSheet = sheetSelect.value as CraftpixSheetId; renderPalette(); });
buildingIdInput.addEventListener("input", () => { buildingDraft.id = buildingIdInput.value; });
buildingNameInput.addEventListener("input", () => { buildingDraft.name = buildingNameInput.value; });
buildingInteriorSelect.addEventListener("change", () => { buildingDraft.interiorMapId = buildingInteriorSelect.value; });

root.querySelector<HTMLButtonElement>("[data-action=new]")?.addEventListener("click", async () => {
  const next = createBlankManualMap(`新しいマップ ${maps.length + 1}`, mapKindSelect.value as ManualDungeonMap["kind"]); next.floor = nextMapFloor(next.kind); maps.push(next); await repository.save(next); setActive(next);
});
root.querySelector<HTMLButtonElement>("[data-action=add-source-map]")?.addEventListener("click", async () => {
  if (!tiledSourceMaps.length) { status.textContent = "TMX見本カタログを読み込めませんでした。"; return; }
  const choices = tiledSourceMaps.map((source) => source.id).join(", ");
  const selected = window.prompt(`追加するTMX見本IDを入力してください。\n${choices}`, tiledSourceMaps[0]!.id);
  const source = tiledSourceMaps.find((candidate) => candidate.id === selected);
  if (!source) { status.textContent = "見本IDが見つかりません。"; return; }
  const next = mapFromTiledSource(source);
  next.floor = nextMapFloor(next.kind);
  maps.push(next); await repository.save(next); setActive(next);
});
root.querySelector<HTMLButtonElement>("[data-action=duplicate-sample]")?.addEventListener("click", async () => {
  const sample = maps.find((map) => map.legacyReference) ?? maps[0]; if (!sample) return;
  const next = cloneManualMap(sample); const identity = createBlankManualMap(`${sample.name} 複製`); next.id = identity.id; next.name = identity.name; next.createdAt = identity.createdAt; next.updatedAt = identity.updatedAt; next.legacyReference = false;
  next.floor = nextMapFloor(next.kind);
  maps.push(next); await repository.save(next); setActive(next);
});
root.querySelector<HTMLButtonElement>("[data-action=duplicate]")?.addEventListener("click", async () => {
  const next = cloneManualMap(activeMap); const identity = createBlankManualMap(`${activeMap.name} 複製`); next.id = identity.id; next.name = identity.name; next.createdAt = identity.createdAt; next.updatedAt = identity.updatedAt; next.legacyReference = false;
  next.floor = nextMapFloor(next.kind);
  maps.push(next); await repository.save(next); setActive(next);
});
root.querySelector<HTMLButtonElement>("[data-action=rename]")?.addEventListener("click", () => {
  const name = window.prompt("マップ名", activeMap.name); if (!name?.trim()) return; beginTransaction(); activeMap.name = name.trim(); completeTransaction();
});
root.querySelector<HTMLButtonElement>("[data-action=delete]")?.addEventListener("click", async () => {
  const dependents = maps.filter((map) => map.kind === "town" && map.buildingLinks.some((link) => link.interiorMapId === activeMap.id));
  if (dependents.length) { status.textContent = `「${activeMap.name}」は${dependents.map((map) => `街「${map.name}」`).join("、")}からリンクされています。先に建物リンクを変更してください。`; return; }
  if (!window.confirm(`「${activeMap.name}」を削除しますか？`)) return;
  await repository.delete(activeMap.id); maps = maps.filter((map) => map.id !== activeMap.id);
  if (!maps.length) { const blank = createBlankManualMap(); maps = [blank]; await repository.save(blank); }
  setActive(maps[0]!);
});
root.querySelector<HTMLButtonElement>("[data-action=undo]")?.addEventListener("click", () => {
  const history = historyFor(activeMap.id); const previous = history.undo.pop(); if (!previous) return; history.redo.push(cloneManualMap(activeMap)); activeMap = previous; void saveActive(); renderAll();
});
root.querySelector<HTMLButtonElement>("[data-action=redo]")?.addEventListener("click", () => {
  const history = historyFor(activeMap.id); const next = history.redo.pop(); if (!next) return; history.undo.push(cloneManualMap(activeMap)); activeMap = next; void saveActive(); renderAll();
});
root.querySelector<HTMLButtonElement>("[data-action=save-building-link]")?.addEventListener("click", () => {
  if (activeMap.kind !== "town" || !pointerStart) { status.textContent = "街マップ上の入口セルを選択してください。"; return; }
  const id = buildingDraft.id.trim();
  const name = buildingDraft.name.trim();
  const interior = maps.find((map) => map.id === buildingDraft.interiorMapId && map.kind === "interior");
  if (!id || !name || !interior) { status.textContent = "建物ID・表示名・内部マップを入力してください。"; return; }
  beginTransaction();
  const link: ManualBuildingLink = { id, name, entrance: { x: pointerStart.x, y: pointerStart.y }, interiorMapId: interior.id };
  activeMap.buildingLinks = activeMap.buildingLinks.filter((entry) => entry.id !== id && (entry.entrance.x !== link.entrance.x || entry.entrance.y !== link.entrance.y));
  activeMap.buildingLinks.push(link);
  completeTransaction();
  buildingDraft = { id, name, interiorMapId: interior.id };
  status.textContent = `建物「${name}」を${interior.name}（第${interior.floor}階層）にリンクしました。`;
  renderAll();
});
root.querySelector<HTMLButtonElement>("[data-action=copy-selection]")?.addEventListener("click", () => {
  if (!selection) { status.textContent = "コピーする範囲を選択してください。"; return; }
  mapFragment = copyManualMapFragment(activeMap, selection.start, selection.end);
  const minX = Math.min(selection.start.x, selection.end.x);
  const minY = Math.min(selection.start.y, selection.end.y);
  status.textContent = `(${minX}, ${minY}) から ${mapFragment.width}×${mapFragment.height} セルをコピーしました。別マップで「貼り付け」を選べます。`;
  renderAll();
});
root.querySelector<HTMLButtonElement>("[data-action=clear-selection]")?.addEventListener("click", () => {
  selection = undefined;
  renderAll();
});
root.querySelector<HTMLButtonElement>("[data-action=export-map]")?.addEventListener("click", () => download(activeMap, `${activeMap.name}.json`));
root.querySelector<HTMLButtonElement>("[data-action=export-pack]")?.addEventListener("click", () => download({ version: 1, maps }, "manual-dungeon-map-pack-v1.json"));
root.querySelector<HTMLButtonElement>("[data-action=copy-cell]")?.addEventListener("click", async () => {
  if (!pointerStart) return;
  const point = pointerStart;
  const report = { mapId: activeMap.id, mapName: activeMap.name, x: point.x, y: point.y, layer: selectedLayer, collision: activeMap.collision[manualCellIndex(point.x, point.y)] === 0 ? "walkable" : "blocked", tiles: Object.fromEntries(MANUAL_LAYERS.map((layer) => [layer, topPlacement(activeMap, layer, point.x, point.y)])) };
  await navigator.clipboard.writeText(JSON.stringify(report)); status.textContent = "選択情報をコピーしました。";
});
root.querySelector<HTMLButtonElement>("[data-action=try]")?.addEventListener("click", () => {
  const errors = [...validateManualMap(activeMap), ...missingBuildingLinks().map((link) => ({ severity: "error" as const, message: `建物「${link.name}」の内部マップが見つかりません。` }))].filter((issue) => issue.severity === "error");
  if (errors.length) { status.textContent = `試遊できません：${errors[0]?.message}`; renderValidation(); return; }
  storeManualTrialMap(activeMap);
  window.location.assign(`/?dungeon=manual&autostart=world&dungeonFloor=${floorSelect.value}`);
});
importInput.addEventListener("change", () => {
  const file = importInput.files?.[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const value = JSON.parse(String(reader.result));
      const pack = normalizeManualMapPack(value);
      const single = normalizeManualMap(value);
      const imports = pack?.maps ?? (single ? [single] : []);
      if (!imports.length) throw new Error("invalid");
      for (const imported of imports) {
        const exists = maps.some((map) => map.id === imported.id);
        const next = cloneManualMap(imported);
        if (exists) { const identity = createBlankManualMap(`${next.name} 読み込み`); next.id = identity.id; next.name = identity.name; next.createdAt = identity.createdAt; }
        maps.push(next); await repository.save(next);
      }
      setActive(maps.at(-1)!); status.textContent = `${imports.length}枚を読み込みました。`;
    } catch { status.textContent = "JSON形式を確認してください。"; }
    finally { importInput.value = ""; }
  };
  reader.readAsText(file);
});

void initialize();
