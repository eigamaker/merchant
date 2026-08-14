import "./review.css";
import { CRAFTPIX_SHEETS, type CraftpixSheetId } from "../game/craftpixCatalog";
import { animationClipsForSheet, type CraftpixAnimationCatalog, type CraftpixAnimationClip } from "../game/craftpixAnimations";
import {
  MANUAL_LAYERS,
  MANUAL_MAP_HEIGHT,
  MANUAL_MAP_TILE,
  MANUAL_MAP_WIDTH,
  MANUAL_MAP_PRESETS,
  ManualMapRepository,
  cloneManualMap,
  createBlankManualMap,
  manualCellIndex as fixedManualCellIndex,
  manualEdgeKey,
  normalizeManualMap,
  normalizeManualMapPack,
  placeManualTile,
  removeTopPlacement,
  storeManualTrialMap,
  topPlacement,
  validateManualMap,
  type ManualDungeonMap,
  type ManualTilePlacement,
  type ManualVisualLayer,
} from "./manualMapModel";

type Tool = "paint" | "rectangle" | "fill" | "erase" | "eyedropper" | "walkable" | "blocked" | "edge" | "entrance" | "stairs";
type Point = { x: number; y: number; localX: number; localY: number };
type Stamp = { sheet: CraftpixSheetId; frame: number; width: number; height: number; animationId?: string };

const root = document.querySelector<HTMLElement>("#review-app")!;
if (!root) throw new Error("review app root not found");

const MARGIN = 18;
const repository = new ManualMapRepository();
const images = new Map<CraftpixSheetId, HTMLImageElement>();
const histories = new Map<string, { undo: ManualDungeonMap[]; redo: ManualDungeonMap[] }>();
const sourceFrames = new Set<string>();
let animationCatalog: CraftpixAnimationCatalog | undefined;
let paletteAnimationClips: CraftpixAnimationClip[] = [];

function manualCellIndex(x: number, y: number): number {
  return fixedManualCellIndex(activeMap, x, y);
}

let maps: ManualDungeonMap[] = [];
let activeMap: ManualDungeonMap;
let selectedLayer: ManualVisualLayer = "ground";
let selectedTool: Tool = "paint";
let selectedStamp: Stamp = { sheet: "walls-floor", frame: 138, width: 1, height: 1 };
let zoom = 1;
let paletteSheet: CraftpixSheetId = "walls-floor";
let paletteStart: { column: number; row: number } | undefined;
let pointerStart: Point | undefined;
let transactionBefore: ManualDungeonMap | undefined;
let selection: { start: Point; end: Point } | undefined;
let painting = false;
let lastPainted = new Set<string>();

root.innerHTML = `
  <div class="map-editor-shell">
    <header class="map-editor-header">
      <div><p class="map-editor-eyebrow">MANUAL DUNGEON BLUEPRINT</p><h1>ダンジョン設計ツール</h1><p>素材を手で配置し、通行・境界・入口を同じ画面で調整して試遊できます。</p></div>
      <div class="map-editor-header-actions"><button data-action="new">空白マップ</button><button data-action="duplicate-sample">見本を複製</button><button data-action="undo">元に戻す</button><button data-action="redo">やり直す</button><button class="primary" data-action="try">このマップを試遊</button></div>
    </header>
    <section class="map-editor-toolbar">
      <label>マップ種類 <select data-map-kind><option value="town">街</option><option value="interior">建物内部</option><option value="dungeon" selected>ダンジョン</option></select></label>
      <label>レイヤー <select data-layer></select></label>
      <label>道具 <select data-tool></select></label>
      <label class="check"><input type="checkbox" data-suggestion checked> 配置時に通行推奨値を反映</label>
      <label class="check"><input type="checkbox" data-stack> 重ね置き</label>
      <label class="check"><input type="checkbox" data-collision checked> 通行表示</label>
      <label class="check"><input type="checkbox" data-grid checked> グリッド</label>
      <label>ズーム <select data-zoom><option value="0.5">50%</option><option value="0.75">75%</option><option value="1" selected>100%</option><option value="1.5">150%</option><option value="2">200%</option></select></label>
    </section>
    <main class="map-editor-layout">
      <aside class="map-editor-side map-list-panel"><div class="panel-heading"><h2>マップ</h2><span data-progress>0 / 10</span></div><div class="map-list" data-map-list></div><div class="map-actions"><button data-action="rename">名前変更</button><button data-action="duplicate">複製</button><button data-action="delete">削除</button></div><hr><h2>レイヤー</h2><div class="layer-list" data-layer-list></div><p class="small">前景レイヤーは試遊時にキャラクターより前へ描画されます。</p></aside>
      <section class="map-canvas-panel"><div class="map-canvas-wrap"><canvas data-map-canvas aria-label="48x36のダンジョン編集キャンバス"></canvas></div><div class="map-canvas-help">鉛筆・矩形・塗りつぶし・消しゴム・スポイトに対応。境界はセルの端をクリックします。座標は0始まりです。</div><div class="map-validation" data-validation></div></section>
      <aside class="map-editor-side palette-panel"><h2>素材パレット</h2><label>分類 <select data-category><option value="source">固定マップで使用</option><option value="floor">床・壁</option><option value="water">水</option><option value="decor">装飾・光</option><option value="all">全素材</option></select></label><label>シート <select data-sheet></select></label><p class="small" data-stamp-info></p><div class="palette-wrap"><canvas data-palette-canvas aria-label="素材シート"></canvas></div><div class="selected-info" data-selected-info></div><button data-action="copy-cell">選択情報をコピー</button><hr><h2>保存・共有</h2><button data-action="export-map">選択マップJSON</button><button data-action="export-pack">全マップJSON</button><label class="file-button">JSONを読み込む<input type="file" accept="application/json" data-import></label><label>試遊階層 <select data-floor>${Array.from({ length: 8 }, (_, index) => `<option value="${index + 1}">${index + 1}</option>`).join("")}</select></label><p class="save-status" data-status>読み込み中…</p></aside>
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
if (!mapContext || !paletteContext) throw new Error("Canvas is unavailable");
const layerSelect = required<HTMLSelectElement>("[data-layer]");
const mapKindSelect = required<HTMLSelectElement>("[data-map-kind]");
const toolSelect = required<HTMLSelectElement>("[data-tool]");
const suggestionToggle = required<HTMLInputElement>("[data-suggestion]");
const stackToggle = required<HTMLInputElement>("[data-stack]");
const collisionToggle = required<HTMLInputElement>("[data-collision]");
const gridToggle = required<HTMLInputElement>("[data-grid]");
const zoomSelect = required<HTMLSelectElement>("[data-zoom]");
const categorySelect = required<HTMLSelectElement>("[data-category]");
const animationOption = document.createElement("option");
animationOption.value = "animation";
animationOption.textContent = "アニメーション";
categorySelect.append(animationOption);
const environmentOption = document.createElement("option");
environmentOption.value = "environment";
environmentOption.textContent = "Environment";
categorySelect.append(environmentOption);
const sheetSelect = required<HTMLSelectElement>("[data-sheet]");
const floorSelect = required<HTMLSelectElement>("[data-floor]");
const mapList = required<HTMLElement>("[data-map-list]");
const layerList = required<HTMLElement>("[data-layer-list]");
const selectedInfo = required<HTMLElement>("[data-selected-info]");
const validation = required<HTMLElement>("[data-validation]");
const status = required<HTMLElement>("[data-status]");
const stampInfo = required<HTMLElement>("[data-stamp-info]");
const progress = required<HTMLElement>("[data-progress]");
const importInput = required<HTMLInputElement>("[data-import]");

const layerLabels: Record<ManualVisualLayer, string> = { ground: "地面", structure: "構造物", decoration: "装飾", overhead: "キャラ前面", light: "光" };
const toolLabels: Record<Tool, string> = { paint: "鉛筆", rectangle: "矩形", fill: "塗りつぶし", erase: "消しゴム", eyedropper: "スポイト", walkable: "通行可能", blocked: "通行不可", edge: "境界ブロック", entrance: "入口", stairs: "下り階段" };
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

function setActive(next: ManualDungeonMap): void {
  activeMap = cloneManualMap(next);
  mapKindSelect.value = activeMap.kind;
  selectedTool = "paint";
  toolSelect.value = selectedTool;
  renderAll();
}

function changeMapKind(kind: ManualDungeonMap["kind"]): void {
  if (activeMap.kind === kind) return;
  const preset = MANUAL_MAP_PRESETS[kind];
  const previous = cloneManualMap(activeMap);
  const next = cloneManualMap(activeMap);
  next.kind = kind;
  next.width = preset.width;
  next.height = preset.height;
  next.collision = Array(preset.width * preset.height).fill(1);
  next.collisionLocked = Array(preset.width * preset.height).fill(false);
  for (let y = 0; y < Math.min(previous.height, next.height); y += 1) for (let x = 0; x < Math.min(previous.width, next.width); x += 1) {
    const oldIndex = fixedManualCellIndex(previous, x, y);
    const newIndex = fixedManualCellIndex(next, x, y);
    next.collision[newIndex] = previous.collision[oldIndex] ?? 1;
    next.collisionLocked[newIndex] = previous.collisionLocked[oldIndex] ?? false;
  }
  for (const layer of MANUAL_LAYERS) next.layers[layer] = next.layers[layer].filter((placement) => placement.x < next.width && placement.y < next.height);
  if (next.entrance && (next.entrance.x >= next.width || next.entrance.y >= next.height)) next.entrance = undefined;
  if (next.stairs && (next.stairs.x >= next.width || next.stairs.y >= next.height)) next.stairs = undefined;
  activeMap = next;
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
  const sourceX = (placement.frame % sheet.columns) * MANUAL_MAP_TILE;
  const sourceY = Math.floor(placement.frame / sheet.columns) * MANUAL_MAP_TILE;
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
  for (let x = 0; x < mapWidth; x += 1) mapContext.fillText(String(x), MARGIN + x * MANUAL_MAP_TILE + 2, 10);
  for (let y = 0; y < mapHeight; y += 1) mapContext.fillText(String(y), 2, MARGIN + y * MANUAL_MAP_TILE + 10);
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
  const all = Object.keys(CRAFTPIX_SHEETS).filter((sheet) => sheet !== "doors") as CraftpixSheetId[];
  if (category === "floor") return all.filter((sheet) => sheet === "walls-floor" || sheet === "cracks-wall" || sheet === "cracks-floor");
  if (category === "water") return all.filter((sheet) => sheet.includes("water") || sheet === "cracks-coasts");
  if (category === "animation") return all.filter((sheet) => animationClipsForSheet(animationCatalog, sheet).length > 0);
  if (category === "environment") return all.filter((sheet) => sheet.startsWith("home-") || sheet.startsWith("guild-") || sheet.startsWith("glassblower-") || sheet.startsWith("dungeon-"));
  if (category === "decor") return all.filter((sheet) => ["objects", "traps", "fire", "fire-alt", "cracks-floor", "cracks-wall"].includes(sheet));
  if (category === "source") return all.filter((sheet) => [...sourceFrames].some((key) => key.startsWith(`${sheet}:`)));
  return all;
}

function renderSheetSelect(): void {
  const allowed = allowedSheets();
  if (!allowed.includes(paletteSheet)) paletteSheet = allowed[0] ?? "walls-floor";
  sheetSelect.innerHTML = allowed.map((sheet) => `<option value="${sheet}">${CRAFTPIX_SHEETS[sheet].label}</option>`).join("");
  sheetSelect.value = paletteSheet;
}

function renderPalette(): void {
  const sheet = CRAFTPIX_SHEETS[paletteSheet];
  const image = images.get(paletteSheet);
  const scale = 2;
  if (categorySelect.value === "animation") {
    paletteAnimationClips = animationClipsForSheet(animationCatalog, paletteSheet);
    const columns = 6;
    paletteCanvas.width = columns * MANUAL_MAP_TILE * scale;
    paletteCanvas.height = Math.max(1, Math.ceil(paletteAnimationClips.length / columns)) * MANUAL_MAP_TILE * scale;
    paletteContext.imageSmoothingEnabled = false;
    paletteContext.fillStyle = "#101621";
    paletteContext.fillRect(0, 0, paletteCanvas.width, paletteCanvas.height);
    for (const [index, clip] of paletteAnimationClips.entries()) {
      const x = (index % columns) * MANUAL_MAP_TILE * scale;
      const y = Math.floor(index / columns) * MANUAL_MAP_TILE * scale;
      const clipSheet = CRAFTPIX_SHEETS[clip.sheet as CraftpixSheetId];
      const clipImage = images.get(clip.sheet as CraftpixSheetId);
      if (clipSheet && clipImage) paletteContext.drawImage(clipImage, (clip.representative % clipSheet.columns) * MANUAL_MAP_TILE, Math.floor(clip.representative / clipSheet.columns) * MANUAL_MAP_TILE, MANUAL_MAP_TILE, MANUAL_MAP_TILE, x, y, MANUAL_MAP_TILE * scale, MANUAL_MAP_TILE * scale);
      paletteContext.strokeStyle = "rgba(255,255,255,.22)";
      paletteContext.strokeRect(x + .5, y + .5, MANUAL_MAP_TILE * scale - 1, MANUAL_MAP_TILE * scale - 1);
    }
    const selected = selectedStamp.animationId ? paletteAnimationClips.find((clip) => clip.id === selectedStamp.animationId) : undefined;
    if (selected) {
      const index = paletteAnimationClips.indexOf(selected);
      paletteContext.strokeStyle = "#ffdf66";
      paletteContext.lineWidth = 3;
      paletteContext.strokeRect((index % columns) * MANUAL_MAP_TILE * scale + 1, Math.floor(index / columns) * MANUAL_MAP_TILE * scale + 1, MANUAL_MAP_TILE * scale - 2, MANUAL_MAP_TILE * scale - 2);
    }
    stampInfo.textContent = selected ? `アニメーション / ${selected.id} / ${selected.frames.length}フレーム` : `アニメーション / ${paletteAnimationClips.length}種類`;
    return;
  }
  paletteCanvas.width = sheet.columns * MANUAL_MAP_TILE * scale;
  paletteCanvas.height = Math.ceil(sheet.frames / sheet.columns) * MANUAL_MAP_TILE * scale;
  paletteContext.imageSmoothingEnabled = false;
  paletteContext.fillStyle = "#101621";
  paletteContext.fillRect(0, 0, paletteCanvas.width, paletteCanvas.height);
  if (image) paletteContext.drawImage(image, 0, 0, image.width * scale, image.height * scale);
  if (categorySelect.value === "source") {
    for (let frame = 0; frame < sheet.frames; frame += 1) if (!sourceFrames.has(`${paletteSheet}:${frame}`)) {
      const x = (frame % sheet.columns) * MANUAL_MAP_TILE * scale;
      const y = Math.floor(frame / sheet.columns) * MANUAL_MAP_TILE * scale;
      paletteContext.fillStyle = "rgba(8, 12, 19, .78)";
      paletteContext.fillRect(x, y, MANUAL_MAP_TILE * scale, MANUAL_MAP_TILE * scale);
    }
  }
  paletteContext.strokeStyle = "rgba(255,255,255,.22)";
  for (let column = 0; column <= sheet.columns; column += 1) { paletteContext.beginPath(); paletteContext.moveTo(column * MANUAL_MAP_TILE * scale + .5, 0); paletteContext.lineTo(column * MANUAL_MAP_TILE * scale + .5, paletteCanvas.height); paletteContext.stroke(); }
  const startColumn = selectedStamp.frame % sheet.columns;
  const startRow = Math.floor(selectedStamp.frame / sheet.columns);
  if (selectedStamp.sheet === paletteSheet) {
    paletteContext.strokeStyle = "#ffdf66"; paletteContext.lineWidth = 3;
    paletteContext.strokeRect(startColumn * MANUAL_MAP_TILE * scale + 1, startRow * MANUAL_MAP_TILE * scale + 1, selectedStamp.width * MANUAL_MAP_TILE * scale - 2, selectedStamp.height * MANUAL_MAP_TILE * scale - 2);
  }
  stampInfo.textContent = `${sheet.label} / frame ${selectedStamp.frame} / ${selectedStamp.width}×${selectedStamp.height} スタンプ`;
}

function renderMapList(): void {
  progress.textContent = `${maps.length} / 10`;
  mapList.innerHTML = maps.map((map) => `<button class="map-list-item ${map.id === activeMap.id ? "active" : ""}" data-map-id="${map.id}">${map.name}<small>${map.legacyReference ? "見本" : "手動マップ"}</small></button>`).join("");
  mapList.querySelectorAll<HTMLButtonElement>("[data-map-id]").forEach((button) => button.addEventListener("click", () => {
    const next = maps.find((map) => map.id === button.dataset.mapId); if (next) setActive(next);
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
  selectedInfo.innerHTML = `<strong>(${point.x}, ${point.y})</strong><br>通行: ${activeMap.collision[manualCellIndex(point.x, point.y)] === 0 ? "可能" : "不可"}${activeMap.collisionLocked[manualCellIndex(point.x, point.y)] ? "（手動固定）" : ""}<br>${layers.map(({ layer, placement }) => `${layerLabels[layer]}: ${placement!.sheet} / #${placement!.frame}`).join("<br>") || "配置なし"}`;
}

function renderValidation(): void {
  const issues = validateManualMap(activeMap);
  validation.innerHTML = issues.length ? issues.map((issue) => `<p class="${issue.severity}">${issue.severity === "error" ? "エラー" : "注意"}: ${issue.message}</p>`).join("") : "<p class=\"ok\">検証OK：試遊できます。</p>";
}

function renderAll(): void { renderMap(); renderPalette(); renderMapList(); renderLayerList(); renderInfo(); renderValidation(); }

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

async function initialize(): Promise<void> {
  try { animationCatalog = await fetch("/assets/dungeons/craftpix-animation-catalog.json").then((response) => response.json() as Promise<CraftpixAnimationCatalog>); } catch { animationCatalog = undefined; }
  for (const [sheetId, sheet] of Object.entries(CRAFTPIX_SHEETS) as [CraftpixSheetId, (typeof CRAFTPIX_SHEETS)[CraftpixSheetId]][]) {
    const image = new Image(); image.src = `/${sheet.path}`; images.set(sheetId, image);
  }
  await Promise.all([...images.values()].map((image) => image.decode().catch(() => undefined)));
  maps = await repository.list();
  if (!maps.length) {
    try {
      const sample = normalizeManualMap(await fetch("/assets/dungeons/manual-showcase-v1.json").then((response) => response.json()));
      if (sample) { maps = [sample]; await repository.save(sample); }
    } catch { /* blank fallback below */ }
  }
  if (!maps.length) { const blank = createBlankManualMap(); maps = [blank]; await repository.save(blank); }
  for (const map of maps) for (const layer of MANUAL_LAYERS) for (const placement of map.layers[layer]) sourceFrames.add(tileKey(placement));
  activeMap = cloneManualMap(maps[0]!);
  mapKindSelect.value = activeMap.kind;
  renderSheetSelect();
  status.textContent = "準備完了。空白マップまたは見本複製から作成できます。";
  renderAll();
}

mapCanvas.addEventListener("pointerdown", (event) => {
  const point = canvasPoint(event); if (!point) return;
  mapCanvas.setPointerCapture(event.pointerId); painting = true; lastPainted = new Set(); beginTransaction();
  if (selectedTool === "rectangle") { selection = { start: point, end: point }; renderMap(); return; }
  if (selectedTool === "fill") { applyTool(point); fillAt(point); completeTransaction(); painting = false; return; }
  applyTool(point); renderAll();
});
mapCanvas.addEventListener("pointermove", (event) => {
  const point = canvasPoint(event); if (!point) return;
  if (painting && selectedTool === "rectangle" && selection) { selection.end = point; renderMap(); return; }
  if (painting && ["paint", "erase", "walkable", "blocked", "edge"].includes(selectedTool)) { applyTool(point); renderAll(); }
  else { pointerStart = point; renderInfo(point); }
});
mapCanvas.addEventListener("pointerup", (event) => {
  if (!painting) return;
  const point = canvasPoint(event);
  if (selectedTool === "rectangle" && selection && point) { selection.end = point; applyRectangle(selection.start, selection.end); }
  selection = undefined; painting = false; completeTransaction();
});
mapCanvas.addEventListener("pointercancel", () => { painting = false; selection = undefined; completeTransaction(); });

paletteCanvas.addEventListener("pointerdown", (event) => {
  const rect = paletteCanvas.getBoundingClientRect(); const scale = paletteCanvas.width / rect.width;
  const x = Math.floor(((event.clientX - rect.left) * scale) / (MANUAL_MAP_TILE * 2)); const y = Math.floor(((event.clientY - rect.top) * scale) / (MANUAL_MAP_TILE * 2));
  paletteStart = { column: Math.max(0, x), row: Math.max(0, y) }; paletteCanvas.setPointerCapture(event.pointerId);
});
paletteCanvas.addEventListener("pointerup", (event) => {
  if (!paletteStart) return;
  const rect = paletteCanvas.getBoundingClientRect(); const scale = paletteCanvas.width / rect.width;
  const x = Math.floor(((event.clientX - rect.left) * scale) / (MANUAL_MAP_TILE * 2)); const y = Math.floor(((event.clientY - rect.top) * scale) / (MANUAL_MAP_TILE * 2));
  if (categorySelect.value === "animation") {
    const clip = paletteAnimationClips[y * 6 + x];
    if (clip) selectedStamp = { sheet: clip.sheet as CraftpixSheetId, frame: clip.representative, width: 1, height: 1, animationId: clip.id };
    paletteStart = undefined;
    renderPalette();
    return;
  }
  const sheet = CRAFTPIX_SHEETS[paletteSheet];
  const startColumn = Math.min(paletteStart.column, Math.max(0, x)); const startRow = Math.min(paletteStart.row, Math.max(0, y));
  selectedStamp = { sheet: paletteSheet, frame: startRow * sheet.columns + startColumn, width: Math.max(1, Math.min(sheet.columns - startColumn, Math.abs(x - paletteStart.column) + 1)), height: Math.max(1, Math.min(Math.ceil(sheet.frames / sheet.columns) - startRow, Math.abs(y - paletteStart.row) + 1)) };
  paletteStart = undefined; renderPalette();
});

layerSelect.addEventListener("change", () => { selectedLayer = layerSelect.value as ManualVisualLayer; renderAll(); });
mapKindSelect.addEventListener("change", () => changeMapKind(mapKindSelect.value as ManualDungeonMap["kind"]));
toolSelect.addEventListener("change", () => { selectedTool = toolSelect.value as Tool; });
collisionToggle.addEventListener("change", renderMap);
gridToggle.addEventListener("change", renderMap);
zoomSelect.addEventListener("change", () => { zoom = Number(zoomSelect.value); renderMap(); });
categorySelect.addEventListener("change", () => { renderSheetSelect(); renderPalette(); });
sheetSelect.addEventListener("change", () => { paletteSheet = sheetSelect.value as CraftpixSheetId; renderPalette(); });

root.querySelector<HTMLButtonElement>("[data-action=new]")?.addEventListener("click", async () => {
  const next = createBlankManualMap(`新しいマップ ${maps.length + 1}`, mapKindSelect.value as ManualDungeonMap["kind"]); maps.push(next); await repository.save(next); setActive(next);
});
root.querySelector<HTMLButtonElement>("[data-action=duplicate-sample]")?.addEventListener("click", async () => {
  const sample = maps.find((map) => map.legacyReference) ?? maps[0]; if (!sample) return;
  const next = cloneManualMap(sample); const identity = createBlankManualMap(`${sample.name} 複製`); next.id = identity.id; next.name = identity.name; next.createdAt = identity.createdAt; next.updatedAt = identity.updatedAt; next.legacyReference = false;
  maps.push(next); await repository.save(next); setActive(next);
});
root.querySelector<HTMLButtonElement>("[data-action=duplicate]")?.addEventListener("click", async () => {
  const next = cloneManualMap(activeMap); const identity = createBlankManualMap(`${activeMap.name} 複製`); next.id = identity.id; next.name = identity.name; next.createdAt = identity.createdAt; next.updatedAt = identity.updatedAt; next.legacyReference = false;
  maps.push(next); await repository.save(next); setActive(next);
});
root.querySelector<HTMLButtonElement>("[data-action=rename]")?.addEventListener("click", () => {
  const name = window.prompt("マップ名", activeMap.name); if (!name?.trim()) return; beginTransaction(); activeMap.name = name.trim(); completeTransaction();
});
root.querySelector<HTMLButtonElement>("[data-action=delete]")?.addEventListener("click", async () => {
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
root.querySelector<HTMLButtonElement>("[data-action=export-map]")?.addEventListener("click", () => download(activeMap, `${activeMap.name}.json`));
root.querySelector<HTMLButtonElement>("[data-action=export-pack]")?.addEventListener("click", () => download({ version: 1, maps }, "manual-dungeon-map-pack-v1.json"));
root.querySelector<HTMLButtonElement>("[data-action=copy-cell]")?.addEventListener("click", async () => {
  if (!pointerStart) return;
  const point = pointerStart;
  const report = { mapId: activeMap.id, mapName: activeMap.name, x: point.x, y: point.y, layer: selectedLayer, collision: activeMap.collision[manualCellIndex(point.x, point.y)] === 0 ? "walkable" : "blocked", tiles: Object.fromEntries(MANUAL_LAYERS.map((layer) => [layer, topPlacement(activeMap, layer, point.x, point.y)])) };
  await navigator.clipboard.writeText(JSON.stringify(report)); status.textContent = "選択情報をコピーしました。";
});
root.querySelector<HTMLButtonElement>("[data-action=try]")?.addEventListener("click", () => {
  const errors = validateManualMap(activeMap).filter((issue) => issue.severity === "error");
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
