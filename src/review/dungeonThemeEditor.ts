import { DUNGEON_THEME_CATALOG } from "../game/dungeonThemeCatalog.generated";
import { generateDungeonFloor, type GeneratedDungeonFloor } from "../game/dungeonGenerator";
import { createDungeonRenderPlan, type AssetFrameRef, type DungeonThemeDefinition } from "../game/dungeonThemes";

interface EditorAsset {
  id: string;
  label: string;
  path: string;
  tileSize: number;
  margin: number;
  spacing: number;
  columns: number;
  rows: number;
  frameCount: number;
  mapKinds: readonly string[];
}

type EditableTheme = DungeonThemeDefinition & {
  floorVariants: Array<{ assetId: string; frame: number; weight: number }>;
  wallFrameByMask: AssetFrameRef[];
  decorations: Array<{
    id: string;
    placement: "floor" | "wall" | "corner" | "deadEnd";
    variants: Array<{ assetId: string; frame: number; weight: number }>;
    weight: number;
    maxPerFloor: number;
  }>;
  enemyPools: { shallow: string[]; middle: string[]; deep: string[] };
};

interface ThemeDocument { version: 1; themes: EditableTheme[] }

const cloneCatalog = (): ThemeDocument => ({ version: 1, themes: structuredClone(DUNGEON_THEME_CATALOG) as unknown as EditableTheme[] });
const escapeHtml = (value: unknown): string => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export class DungeonThemeEditor {
  private document = cloneCatalog();
  private selectedId = "cave";
  private seed = 1;
  private floor = 1;
  private collision = false;
  private annotations = true;
  private dirty = false;
  private generated?: GeneratedDungeonFloor;
  private readonly assetsById: Map<string, EditorAsset>;
  private readonly images = new Map<string, HTMLImageElement>();

  constructor(private readonly host: HTMLElement, assets: readonly EditorAsset[]) {
    this.assetsById = new Map(assets.filter((asset) => asset.tileSize === 16 && asset.mapKinds.includes("dungeon")).map((asset) => [asset.id, asset]));
    for (const asset of this.assetsById.values()) {
      const image = new Image();
      image.onload = () => { this.renderFramePreviews(); this.renderDungeonPreview(); };
      image.src = asset.path;
      this.images.set(asset.id, image);
    }
    this.regenerate();
    this.render();
    void this.load();
  }

  private get theme(): EditableTheme { return this.document.themes.find((theme) => theme.id === this.selectedId) ?? this.document.themes[0]!; }
  private markDirty(): void { this.dirty = true; this.renderStatus(); }

  private assetOptions(selected: string): string {
    return [...this.assetsById.values()].map((asset) => `<option value="${escapeHtml(asset.id)}"${asset.id === selected ? " selected" : ""}>${escapeHtml(asset.label)} (${escapeHtml(asset.id)})</option>`).join("");
  }

  private refEditor(label: string, ref: AssetFrameRef, path: string, weight?: number): string {
    return `<label class="theme-ref"><span>${escapeHtml(label)}</span><canvas width="32" height="32" data-theme-frame-preview="${escapeHtml(path)}"></canvas><select data-theme-ref-asset="${escapeHtml(path)}">${this.assetOptions(ref.assetId)}</select><input data-theme-ref-frame="${escapeHtml(path)}" type="number" min="0" value="${ref.frame}" title="frame">${weight === undefined ? "" : `<input data-theme-ref-weight="${escapeHtml(path)}" type="number" min="0.01" step="0.01" value="${weight}" title="weight">`}</label>`;
  }

  private render(): void {
    const theme = this.theme;
    this.host.innerHTML = `
      <div class="theme-editor-toolbar">
        <label>テーマ <select data-theme-select>${this.document.themes.map((entry) => `<option value="${escapeHtml(entry.id)}"${entry.id === theme.id ? " selected" : ""}>${escapeHtml(entry.label)} (${escapeHtml(entry.id)})</option>`).join("")}</select></label>
        <label class="check"><input data-theme-enabled type="checkbox"${theme.enabled ? " checked" : ""}${theme.id === "cave" ? " disabled" : ""}>有効</label>
        <button class="primary" data-theme-save>テーマ定義を保存</button><span data-theme-status></span>
      </div>
      <div class="theme-editor-grid">
        <aside class="map-editor-side theme-contract-panel">
          <div class="panel-heading"><div><h2>${escapeHtml(theme.label)}</h2><p class="small">IDは公開後固定です。画像パック交換時は参照先とframeだけを変更します。</p></div><code>${escapeHtml(theme.id)}</code></div>
          <h3>階段</h3>${this.refEditor("上り", theme.stairsUp, "stairsUp")}${this.refEditor("下り", theme.stairsDown, "stairsDown")}
          <h3>床候補</h3><div class="theme-ref-list">${theme.floorVariants.map((ref, index) => this.refEditor(`床 ${index + 1}`, ref, `floor:${index}`, ref.weight)).join("")}</div>
          <h3>壁マスク <small>N=1 / E=2 / S=4 / W=8</small></h3><div class="theme-wall-grid">${theme.wallFrameByMask.map((ref, index) => this.refEditor(index.toString(2).padStart(4, "0"), ref, `wall:${index}`)).join("")}</div>
        </aside>
        <section class="map-editor-side theme-preview-panel">
          <div class="panel-heading"><div><h2>生成プレビュー</h2><p class="small">テーマを変えても論理地形と配置領域は変わりません。</p></div><span data-theme-preview-status></span></div>
          <div class="theme-preview-controls"><label>seed <input data-theme-seed type="number" value="${this.seed}"></label><label>地下階 <input data-theme-floor type="number" min="1" value="${this.floor}"></label><button data-theme-regenerate>再生成</button><label class="check"><input data-theme-collision type="checkbox"${this.collision ? " checked" : ""}>衝突表示</label><label class="check"><input data-theme-annotations type="checkbox"${this.annotations ? " checked" : ""}>主経路・部屋タグ</label></div>
          <div class="theme-preview-wrap"><canvas width="384" height="288" data-theme-preview></canvas></div>
          <h3>環境装飾</h3><div class="theme-decoration-list">${theme.decorations.map((rule, ruleIndex) => `<fieldset><legend>${escapeHtml(rule.id)}</legend><label>配置 <select data-theme-decoration-placement="${ruleIndex}">${["floor", "wall", "corner", "deadEnd"].map((value) => `<option${value === rule.placement ? " selected" : ""}>${value}</option>`).join("")}</select></label><label>出現率 <input data-theme-decoration-weight="${ruleIndex}" type="number" min="0.001" max="1" step="0.001" value="${rule.weight}"></label><label>上限 <input data-theme-decoration-max="${ruleIndex}" type="number" min="1" value="${rule.maxPerFloor}"></label>${rule.variants.map((ref, variantIndex) => this.refEditor(`候補 ${variantIndex + 1}`, ref, `decor:${ruleIndex}:${variantIndex}`, ref.weight)).join("")}</fieldset>`).join("")}</div>
          <h3>深度別の敵候補</h3><div class="theme-enemy-pools">${(["shallow", "middle", "deep"] as const).map((depth) => `<label>${depth}<textarea data-theme-enemy-pool="${depth}" rows="2">${escapeHtml(theme.enemyPools[depth].join(", "))}</textarea></label>`).join("")}</div>
        </section>
      </div>`;
    this.bind();
    this.renderFramePreviews();
    this.renderDungeonPreview();
    this.renderStatus();
  }

  private bind(): void {
    this.host.querySelector<HTMLSelectElement>("[data-theme-select]")!.onchange = (event) => { this.selectedId = (event.currentTarget as HTMLSelectElement).value; this.regenerate(); this.render(); };
    this.host.querySelector<HTMLInputElement>("[data-theme-enabled]")!.onchange = (event) => { this.theme.enabled = (event.currentTarget as HTMLInputElement).checked; this.markDirty(); };
    this.host.querySelector<HTMLButtonElement>("[data-theme-save]")!.onclick = () => { void this.save(); };
    this.host.querySelector<HTMLButtonElement>("[data-theme-regenerate]")!.onclick = () => { this.seed = Number(this.host.querySelector<HTMLInputElement>("[data-theme-seed]")!.value) || 1; this.floor = Math.max(1, Number(this.host.querySelector<HTMLInputElement>("[data-theme-floor]")!.value) || 1); this.regenerate(); this.renderDungeonPreview(); };
    this.host.querySelector<HTMLInputElement>("[data-theme-collision]")!.onchange = (event) => { this.collision = (event.currentTarget as HTMLInputElement).checked; this.renderDungeonPreview(); };
    this.host.querySelector<HTMLInputElement>("[data-theme-annotations]")!.onchange = (event) => { this.annotations = (event.currentTarget as HTMLInputElement).checked; this.renderDungeonPreview(); };
    this.host.querySelectorAll<HTMLSelectElement>("[data-theme-ref-asset]").forEach((input) => input.onchange = () => { this.refAt(input.dataset.themeRefAsset!).assetId = input.value; this.markDirty(); this.renderFramePreviews(); this.renderDungeonPreview(); });
    this.host.querySelectorAll<HTMLInputElement>("[data-theme-ref-frame]").forEach((input) => input.onchange = () => { this.refAt(input.dataset.themeRefFrame!).frame = Math.max(0, Number(input.value) || 0); this.markDirty(); this.renderFramePreviews(); this.renderDungeonPreview(); });
    this.host.querySelectorAll<HTMLInputElement>("[data-theme-ref-weight]").forEach((input) => input.onchange = () => { const ref = this.refAt(input.dataset.themeRefWeight!) as { weight?: number }; ref.weight = Math.max(0.01, Number(input.value) || 1); this.markDirty(); this.renderDungeonPreview(); });
    this.host.querySelectorAll<HTMLSelectElement>("[data-theme-decoration-placement]").forEach((input) => input.onchange = () => { this.theme.decorations[Number(input.dataset.themeDecorationPlacement)]!.placement = input.value as EditableTheme["decorations"][number]["placement"]; this.markDirty(); this.renderDungeonPreview(); });
    this.host.querySelectorAll<HTMLInputElement>("[data-theme-decoration-weight]").forEach((input) => input.onchange = () => { this.theme.decorations[Number(input.dataset.themeDecorationWeight)]!.weight = Math.max(0.001, Number(input.value) || 0.001); this.markDirty(); this.renderDungeonPreview(); });
    this.host.querySelectorAll<HTMLInputElement>("[data-theme-decoration-max]").forEach((input) => input.onchange = () => { this.theme.decorations[Number(input.dataset.themeDecorationMax)]!.maxPerFloor = Math.max(1, Number(input.value) || 1); this.markDirty(); this.renderDungeonPreview(); });
    this.host.querySelectorAll<HTMLTextAreaElement>("[data-theme-enemy-pool]").forEach((input) => input.onchange = () => { const depth = input.dataset.themeEnemyPool as "shallow" | "middle" | "deep"; this.theme.enemyPools[depth] = input.value.split(/[,\s]+/).map((value) => value.trim()).filter(Boolean); this.markDirty(); });
  }

  private refAt(path: string): AssetFrameRef & { weight?: number } {
    if (path === "stairsUp" || path === "stairsDown") return this.theme[path];
    const [kind, first, second] = path.split(":");
    if (kind === "floor") return this.theme.floorVariants[Number(first)]!;
    if (kind === "wall") return this.theme.wallFrameByMask[Number(first)]!;
    return this.theme.decorations[Number(first)]!.variants[Number(second)]!;
  }

  private drawFrame(canvas: HTMLCanvasElement, ref: AssetFrameRef): void {
    const context = canvas.getContext("2d")!;
    context.imageSmoothingEnabled = false;
    context.fillStyle = "#a94055";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const asset = this.assetsById.get(ref.assetId);
    const image = this.images.get(ref.assetId);
    if (!asset || !image?.complete || image.naturalWidth === 0 || ref.frame < 0 || ref.frame >= asset.frameCount) return;
    const x = asset.margin + (ref.frame % asset.columns) * (asset.tileSize + asset.spacing);
    const y = asset.margin + Math.floor(ref.frame / asset.columns) * (asset.tileSize + asset.spacing);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, x, y, asset.tileSize, asset.tileSize, 0, 0, canvas.width, canvas.height);
  }

  private renderFramePreviews(): void {
    this.host.querySelectorAll<HTMLCanvasElement>("[data-theme-frame-preview]").forEach((canvas) => this.drawFrame(canvas, this.refAt(canvas.dataset.themeFramePreview!)));
  }

  private regenerate(): void { this.generated = generateDungeonFloor(this.seed, this.floor, this.theme.id); }

  private renderDungeonPreview(): void {
    const canvas = this.host.querySelector<HTMLCanvasElement>("[data-theme-preview]");
    if (!canvas || !this.generated) return;
    const map = this.generated.map;
    const context = canvas.getContext("2d")!;
    const scale = Math.min(canvas.width / map.width, canvas.height / map.height);
    context.imageSmoothingEnabled = false;
    context.fillStyle = "#080b10";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const plan = createDungeonRenderPlan(map, this.seed, this.floor, this.theme);
    for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) {
      const index = y * map.width + x;
      for (const ref of [plan.ground[index], plan.structure[index], plan.decoration[index]]) {
        if (!ref) continue;
        const asset = this.assetsById.get(ref.assetId);
        const image = this.images.get(ref.assetId);
        if (!asset || !image?.complete || image.naturalWidth === 0 || ref.frame >= asset.frameCount) continue;
        const sx = asset.margin + (ref.frame % asset.columns) * (asset.tileSize + asset.spacing);
        const sy = asset.margin + Math.floor(ref.frame / asset.columns) * (asset.tileSize + asset.spacing);
        context.drawImage(image, sx, sy, asset.tileSize, asset.tileSize, x * scale, y * scale, scale, scale);
      }
      if (this.collision) { context.fillStyle = map.tiles[y]?.[x] === 0 ? "#00c8f044" : "#ff4b1f55"; context.fillRect(x * scale, y * scale, scale, scale); }
    }
    if (this.annotations) {
      context.lineWidth = 2;
      context.strokeStyle = "#ffe066";
      context.beginPath();
      for (const [index, id] of map.procedural?.mainPathRoomIds.entries() ?? []) {
        const room = map.procedural!.rooms.find((entry) => entry.id === id)!;
        if (index === 0) context.moveTo((room.center.x + 0.5) * scale, (room.center.y + 0.5) * scale);
        else context.lineTo((room.center.x + 0.5) * scale, (room.center.y + 0.5) * scale);
      }
      context.stroke();
      context.font = "9px sans-serif";
      for (const room of map.procedural?.rooms ?? []) { context.fillStyle = room.mainPath ? "#fff2a8" : "#b9f6e9"; context.fillText(room.tag, room.x * scale, (room.y + 1) * scale); }
    }
    const status = this.host.querySelector<HTMLElement>("[data-theme-preview-status]");
    if (status) status.textContent = `${map.procedural?.rooms.length ?? 0}室 / 主経路${map.procedural?.mainPathRoomIds.length ?? 0}室${this.generated.usedFallback ? " / BSP fallback" : ""}`;
  }

  private renderStatus(message?: string): void {
    const status = this.host.querySelector<HTMLElement>("[data-theme-status]");
    if (status) status.textContent = message ?? (this.dirty ? "未保存" : "保存済み");
  }

  private async load(): Promise<void> {
    if (!import.meta.env.DEV) return;
    try {
      const response = await fetch("/__map-editor/dungeon-themes", { headers: { Accept: "application/json" } });
      if (!response.ok) return;
      this.document = await response.json() as ThemeDocument;
      this.selectedId = this.document.themes.some((theme) => theme.id === this.selectedId) ? this.selectedId : this.document.themes[0]!.id;
      this.dirty = false;
      this.regenerate();
      this.render();
    } catch { this.renderStatus("組み込み定義を表示中"); }
  }

  private async save(): Promise<void> {
    if (!import.meta.env.DEV) { this.renderStatus("保存は npm run edit で利用できます"); return; }
    try {
      this.renderStatus("保存中…");
      const response = await fetch("/__map-editor/dungeon-themes", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(this.document) });
      if (!response.ok) throw new Error(await response.text());
      this.dirty = false;
      this.renderStatus("保存しました。カタログを再生成しています…");
      window.setTimeout(() => window.location.reload(), 250);
    } catch (error) { this.renderStatus(`保存エラー: ${error instanceof Error ? error.message : "不明"}`); }
  }
}
