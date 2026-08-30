import { DEFAULT_PALETTE_LAYOUT } from "../game/mapAssetCatalog.generated";
import { DUNGEON_THEME_CATALOG } from "../game/dungeonThemeCatalog.generated";
import { generateDungeonFloor, type GeneratedDungeonFloor } from "../game/dungeonGenerator";
import { DUNGEON_THEME_OBJECT_KINDS, createDungeonRenderPlan, type AssetFrameRef, type DungeonThemeDefinition, type DungeonThemeObjectKind } from "../game/dungeonThemes";
import { PALETTE_CELL_ROLES, clonePaletteLayout, validatePaletteLayout, type PaletteCell, type PaletteCellRole, type PaletteLayout, type PalettePage } from "./paletteModel";

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
  autotile?: { scheme: string; animationFrames: number };
}

type EditableTheme = DungeonThemeDefinition & {
  floorVariants: Array<{ assetId: string; frame: number; weight: number }>;
  wall?: { assetId: string };
  wallFrameByMask?: AssetFrameRef[];
  decorations: Array<{
    id: string;
    placement: "floor" | "wall" | "wallFace" | "corner" | "deadEnd";
    enabled?: boolean;
    variants: Array<{ assetId: string; frame: number; weight: number }>;
    weight: number;
    maxPerFloor: number;
  }>;
  spawns?: Array<{ actorId: string; minFloor: number; maxFloor?: number; weight: number; role?: "common" | "elite"; maxPerFloor?: number }>;
};

interface ThemeDocument { version: 1; themes: EditableTheme[] }

const cloneCatalog = (): ThemeDocument => ({ version: 1, themes: structuredClone(DUNGEON_THEME_CATALOG) as unknown as EditableTheme[] });
const escapeHtml = (value: unknown): string => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const ROLE_LABELS: Record<PaletteCellRole, string> = { floor: "床", wall: "壁", prop: "小物", stairs: "階段", liquid: "水・溶岩" };
/** Tiles the game places itself, so the label says what puts one there. */
const OBJECT_LABELS: Record<DungeonThemeObjectKind, string> = { chest: "宝箱", corpse: "冒険者の遺体" };
const WALL_MASK_LABELS = [
  "孤立", "北へ接続", "東へ接続", "北東角",
  "南へ接続", "縦", "東南角", "西が開いたT字",
  "西へ接続", "北西角", "横", "南が開いたT字",
  "南西角", "東が開いたT字", "北が開いたT字", "十字",
] as const;

export class DungeonThemeEditor {
  private document = cloneCatalog();
  private selectedId = "cave";
  private seed = 1;
  private floor = 1;
  private collision = false;
  private annotations = true;
  private dirty = false;
  private generated?: GeneratedDungeonFloor;
  private paletteLayout = clonePaletteLayout(DEFAULT_PALETTE_LAYOUT as unknown as PaletteLayout);
  private palettePageId = "";
  private paletteStatus = "標準パレットを表示中";
  private activeRefPath = "stairsUp";
  private roleFilter: PaletteCellRole | "all" = "all";
  private readonly assetsById: Map<string, EditorAsset>;
  private readonly images = new Map<string, HTMLImageElement>();

  constructor(private readonly host: HTMLElement, assets: readonly EditorAsset[]) {
    this.assetsById = new Map(assets.filter((asset) => asset.tileSize === 16 && asset.mapKinds.includes("dungeon")).map((asset) => [asset.id, asset]));
    for (const asset of this.assetsById.values()) {
      const image = new Image();
      image.onload = () => { this.renderFramePreviews(); this.renderWallPreview(); this.renderDungeonPreview(); };
      image.src = asset.path;
      this.images.set(asset.id, image);
    }
    this.selectPalettePage();
    this.regenerate();
    this.render();
    void this.load();
    void this.loadPalette();
  }

  private get theme(): EditableTheme { return this.document.themes.find((theme) => theme.id === this.selectedId) ?? this.document.themes[0]!; }
  private markDirty(): void { this.dirty = true; this.renderStatus(); }

  private assetOptions(selected: string): string {
    return [...this.assetsById.values()].map((asset) => `<option value="${escapeHtml(asset.id)}"${asset.id === selected ? " selected" : ""}>${escapeHtml(asset.label)} (${escapeHtml(asset.id)})</option>`).join("");
  }

  private refEditor(label: string, ref: AssetFrameRef, path: string, weight?: number): string {
    const active = path === this.activeRefPath ? " active" : "";
    return `<div class="theme-ref${active}" data-theme-ref-row="${escapeHtml(path)}"><span>${escapeHtml(label)}</span><canvas width="32" height="32" data-theme-frame-preview="${escapeHtml(path)}"></canvas><select data-theme-ref-asset="${escapeHtml(path)}" aria-label="${escapeHtml(label)}の素材">${this.assetOptions(ref.assetId)}</select><input data-theme-ref-frame="${escapeHtml(path)}" type="number" min="0" value="${ref.frame}" title="frame" aria-label="${escapeHtml(label)}のframe">${weight === undefined ? "<span class=\"theme-ref-weight-spacer\"></span>" : `<input data-theme-ref-weight="${escapeHtml(path)}" type="number" min="0.01" step="0.01" value="${weight}" title="weight" aria-label="${escapeHtml(label)}のweight">`}<button type="button" class="theme-ref-target" data-theme-ref-target="${escapeHtml(path)}">選択先</button></div>`;
  }

  /** Expanded blob sheets are the only assets a theme can name as its wall set. */
  private wallSets(): EditorAsset[] {
    return [...this.assetsById.values()].filter((asset) => asset.autotile?.scheme === "blob47");
  }

  /**
   * One choice replaces sixteen frame numbers: an expanded autotile resolves
   * every neighbourhood on its own. Themes that still carry the old sixteen
   * frames keep their grid so they stay editable.
   */
  private renderWallEditor(theme: EditableTheme): string {
    const sets = this.wallSets();
    if (theme.wall || !theme.wallFrameByMask) {
      const selected = theme.wall?.assetId ?? "";
      const asset = this.assetsById.get(selected);
      const options = sets.map((entry) => `<option value="${escapeHtml(entry.id)}"${entry.id === selected ? " selected" : ""}>${escapeHtml(entry.label)}</option>`).join("");
      const missing = selected && !asset ? `<p class="small theme-wall-missing">素材 ${escapeHtml(selected)} が見つかりません。</p>` : "";
      const detail = asset ? `47タイル × ${asset.autotile!.animationFrames}コマ` : "壁セットを選択してください";
      return `<div class="theme-wall-set">
        <label>壁セット <select data-theme-wall-set aria-label="壁セット">${options || `<option value="">展開済みオートタイルがありません</option>`}</select></label>
        <canvas width="376" height="16" data-theme-wall-preview></canvas>
        <p class="small">${escapeHtml(detail)}・8近傍から自動でつながります。</p>${missing}
      </div>`;
    }
    return `<div class="theme-wall-grid">${theme.wallFrameByMask.map((ref, index) => this.refEditor(`${WALL_MASK_LABELS[index]} (${index.toString(2).padStart(4, "0")})`, ref, `wall:${index}`)).join("")}</div>`;
  }

  /** Draws the first tiles of the chosen wall set so the choice is visible. */
  private renderWallPreview(): void {
    const canvas = this.host.querySelector<HTMLCanvasElement>("[data-theme-wall-preview]");
    if (!canvas) return;
    const context = canvas.getContext("2d");
    const asset = this.theme.wall ? this.assetsById.get(this.theme.wall.assetId) : undefined;
    const image = asset ? this.images.get(asset.id) : undefined;
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!asset || !image?.complete || image.naturalWidth === 0) return;
    const tiles = Math.min(asset.columns, Math.floor(canvas.width / 16));
    for (let tile = 0; tile < tiles; tile += 1) context.drawImage(image, tile * 16, 0, 16, 16, tile * 16, 0, 16, 16);
  }

  private dungeonPalettePages(): PalettePage[] {
    return this.paletteLayout.pages.filter((page) => page.mapKind === "dungeon" && page.tileSize === 16);
  }

  private selectPalettePage(): void {
    const pages = this.dungeonPalettePages();
    if (!pages.some((page) => page.id === this.palettePageId)) this.palettePageId = pages[0]?.id ?? "";
  }

  private get palettePage(): PalettePage | undefined {
    return this.dungeonPalettePages().find((page) => page.id === this.palettePageId);
  }

  private refLabel(path: string): string {
    if (path.startsWith("object:")) return OBJECT_LABELS[path.slice("object:".length) as DungeonThemeObjectKind] ?? path;
    if (path === "stairsUp") return "上り階段";
    if (path === "stairsDown") return "下り階段";
    const [kind, first, second] = path.split(":");
    if (kind === "floor") return `床 ${Number(first) + 1}`;
    if (kind === "wall") return `壁 ${WALL_MASK_LABELS[Number(first)] ?? first}`;
    if (kind === "decor") return `装飾 ${Number(first) + 1}・候補 ${Number(second) + 1}`;
    return path;
  }

  /** Cells the picker should offer, honouring the role filter and hiding rejects. */
  private pickableCells(page: PalettePage | undefined): PaletteCell[] {
    if (!page) return [];
    return page.cells.filter((cell) => cell.status !== "rejected" && (this.roleFilter === "all" || cell.role === this.roleFilter));
  }

  private renderPalettePicker(): string {
    const pages = this.dungeonPalettePages();
    const page = this.palettePage;
    const cells = this.pickableCells(page);
    const maxColumn = cells.length ? Math.max(1, ...cells.map((cell) => cell.x + 1)) : 1;
    const maxRow = cells.length ? Math.max(1, ...cells.map((cell) => cell.y + 1)) : 1;
    return `<section class="map-editor-side theme-asset-palette-panel">
      <div class="panel-heading"><div><h2>素材パレットから割り当て</h2><p class="small">設定先を選び、画像をクリックするか設定欄へドラッグします。タイル名は不要です。</p></div><div class="theme-palette-heading"><strong data-theme-palette-target>選択先: ${escapeHtml(this.refLabel(this.activeRefPath))}</strong><label class="theme-palette-filter">用途 <select data-theme-palette-role aria-label="用途で絞り込む">${["all", ...PALETTE_CELL_ROLES].map((role) => `<option value="${role}"${role === this.roleFilter ? " selected" : ""}>${role === "all" ? "すべて" : escapeHtml(ROLE_LABELS[role as PaletteCellRole])}</option>`).join("")}</select></label><button type="button" data-theme-palette-reload>再読込</button></div></div>
      <div class="theme-palette-tabs" role="tablist" aria-label="ダンジョン素材パレット">${pages.map((entry) => `<button type="button" role="tab" data-theme-palette-page="${escapeHtml(entry.id)}" class="${entry.id === page?.id ? "active" : ""}" aria-selected="${entry.id === page?.id}">${escapeHtml(entry.label)}</button>`).join("")}</div>
      <div class="theme-palette-scroll">${page ? `<div class="theme-palette-grid" style="grid-template-columns:repeat(${maxColumn},48px);grid-template-rows:repeat(${maxRow},48px)">${cells.map((cell) => `<button type="button" class="theme-palette-cell" draggable="true" data-theme-palette-asset="${escapeHtml(cell.assetId)}" data-theme-palette-frame="${cell.frame}" style="grid-column:${cell.x + 1};grid-row:${cell.y + 1}" title="${escapeHtml(this.assetsById.get(cell.assetId)?.label ?? cell.assetId)} / frame ${cell.frame}"><canvas width="44" height="44" data-theme-palette-preview data-asset-id="${escapeHtml(cell.assetId)}" data-frame="${cell.frame}"></canvas></button>`).join("")}</div>` : `<p class="small">16pxのダンジョン用パレットがありません。素材パレット編集で作成してください。</p>`}</div>
      <p class="theme-palette-status" data-theme-palette-status>${escapeHtml(this.paletteStatus)}</p>
    </section>`;
  }

  private render(): void {
    const theme = this.theme;
    this.host.innerHTML = `
      <div class="theme-editor-toolbar">
        <label>テーマ <select data-theme-select>${this.document.themes.map((entry) => `<option value="${escapeHtml(entry.id)}"${entry.id === theme.id ? " selected" : ""}>${escapeHtml(entry.label)} (${escapeHtml(entry.id)})</option>`).join("")}</select></label>
        <label class="check"><input data-theme-enabled type="checkbox"${theme.enabled ? " checked" : ""}${theme.id === "cave" ? " disabled" : ""}>有効</label>
        <button class="primary" data-theme-save>テーマ定義を保存</button><span data-theme-status></span>
      </div>
      ${this.renderPalettePicker()}
      <div class="theme-editor-grid">
        <aside class="map-editor-side theme-contract-panel">
          <div class="panel-heading"><div><h2>${escapeHtml(theme.label)}</h2><p class="small">IDは公開後固定です。画像パック交換時は参照先とframeだけを変更します。</p></div><code>${escapeHtml(theme.id)}</code></div>
          <h3>階段</h3>${this.refEditor("上り", theme.stairsUp, "stairsUp")}${this.refEditor("下り", theme.stairsDown, "stairsDown")}
          <h3>ゲーム内オブジェクト</h3><p class="small">遺体や宝箱など、ゲームが理由あって置くタイルです。未設定なら共通の仮素材のままになります。</p>
          ${DUNGEON_THEME_OBJECT_KINDS.map((kind) => this.refEditor(OBJECT_LABELS[kind], theme.objects?.[kind] ?? { assetId: "", frame: 0 }, `object:${kind}`)).join("")}
          <h3>床候補</h3><div class="theme-ref-list">${theme.floorVariants.map((ref, index) => this.refEditor(`床 ${index + 1}`, ref, `floor:${index}`, ref.weight)).join("")}</div>
          <h3>壁</h3>${this.renderWallEditor(theme)}
        </aside>
        <section class="map-editor-side theme-preview-panel">
          <div class="panel-heading"><div><h2>生成プレビュー</h2><p class="small">テーマを変えても論理地形と配置領域は変わりません。</p></div><span data-theme-preview-status></span></div>
          <div class="theme-preview-controls"><label>seed <input data-theme-seed type="number" value="${this.seed}"></label><label>地下階 <input data-theme-floor type="number" min="1" value="${this.floor}"></label><button data-theme-regenerate>再生成</button><label class="check"><input data-theme-collision type="checkbox"${this.collision ? " checked" : ""}>衝突表示</label><label class="check"><input data-theme-annotations type="checkbox"${this.annotations ? " checked" : ""}>主経路・部屋タグ</label></div>
          <div class="theme-preview-wrap"><canvas width="384" height="288" data-theme-preview></canvas></div>
          <h3>環境装飾</h3><div class="theme-decoration-list">${theme.decorations.map((rule, ruleIndex) => `<fieldset><legend>${escapeHtml(rule.id)}</legend><label><input type="checkbox" data-theme-decoration-enabled="${ruleIndex}"${rule.enabled === false ? "" : " checked"}> 配置する</label><label>配置 <select data-theme-decoration-placement="${ruleIndex}">${["floor", "wall", "wallFace", "corner", "deadEnd"].map((value) => `<option${value === rule.placement ? " selected" : ""}>${value}</option>`).join("")}</select></label><label>出現率 <input data-theme-decoration-weight="${ruleIndex}" type="number" min="0.001" max="1" step="0.001" value="${rule.weight}"></label><label>上限 <input data-theme-decoration-max="${ruleIndex}" type="number" min="1" value="${rule.maxPerFloor}"></label>${rule.variants.map((ref, variantIndex) => this.refEditor(`候補 ${variantIndex + 1}`, ref, `decor:${ruleIndex}:${variantIndex}`, ref.weight)).join("")}</fieldset>`).join("")}</div>
          <h3>出現する敵</h3><p class="small">${theme.spawns?.length ? `${theme.spawns.length}行の出現表があります。` : "出現表がありません。"}深さごとの内訳と重みは「出現表」タブで編集します。</p>
        </section>
      </div>`;
    this.bind();
    this.renderFramePreviews();
    this.renderWallPreview();
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
    const roleFilter = this.host.querySelector<HTMLSelectElement>("[data-theme-palette-role]");
    if (roleFilter) roleFilter.onchange = () => { this.roleFilter = roleFilter.value as PaletteCellRole | "all"; this.render(); };
    const wallSet = this.host.querySelector<HTMLSelectElement>("[data-theme-wall-set]");
    if (wallSet) wallSet.onchange = () => {
      this.theme.wall = { assetId: wallSet.value };
      // A theme cannot hold both wall descriptions; the set replaces the grid.
      delete this.theme.wallFrameByMask;
      this.markDirty();
      this.renderWallPreview();
      this.renderDungeonPreview();
    };
    this.host.querySelectorAll<HTMLSelectElement>("[data-theme-ref-asset]").forEach((input) => { input.onfocus = () => this.selectRef(input.dataset.themeRefAsset!); input.onchange = () => { this.retargetRef(input.dataset.themeRefAsset!, { assetId: input.value }); this.markDirty(); this.renderFramePreviews(); this.renderDungeonPreview(); }; });
    this.host.querySelectorAll<HTMLInputElement>("[data-theme-ref-frame]").forEach((input) => { input.onfocus = () => this.selectRef(input.dataset.themeRefFrame!); input.onchange = () => { this.retargetRef(input.dataset.themeRefFrame!, { frame: Math.max(0, Number(input.value) || 0) }); this.markDirty(); this.renderFramePreviews(); this.renderDungeonPreview(); }; });
    this.host.querySelectorAll<HTMLInputElement>("[data-theme-ref-weight]").forEach((input) => { input.onfocus = () => this.selectRef(input.dataset.themeRefWeight!); input.onchange = () => { const ref = this.refAt(input.dataset.themeRefWeight!) as { weight?: number }; ref.weight = Math.max(0.01, Number(input.value) || 1); this.markDirty(); this.renderDungeonPreview(); }; });
    this.host.querySelectorAll<HTMLButtonElement>("[data-theme-ref-target]").forEach((button) => button.onclick = () => this.selectRef(button.dataset.themeRefTarget!));
    this.host.querySelectorAll<HTMLElement>("[data-theme-ref-row]").forEach((row) => {
      row.ondragover = (event) => { event.preventDefault(); row.classList.add("drop-target"); };
      row.ondragleave = () => row.classList.remove("drop-target");
      row.ondrop = (event) => {
        event.preventDefault();
        row.classList.remove("drop-target");
        const raw = event.dataTransfer?.getData("application/x-dungeon-theme-frame") || event.dataTransfer?.getData("text/plain");
        if (!raw) return;
        try { const value = JSON.parse(raw) as AssetFrameRef; this.assignPaletteFrame(row.dataset.themeRefRow!, value.assetId, value.frame); } catch { /* Ignore unrelated drags. */ }
      };
    });
    this.host.querySelectorAll<HTMLButtonElement>("[data-theme-palette-page]").forEach((button) => button.onclick = () => { this.palettePageId = button.dataset.themePalettePage!; this.render(); });
    this.host.querySelector<HTMLButtonElement>("[data-theme-palette-reload]")!.onclick = () => { void this.loadPalette(); };
    this.host.querySelectorAll<HTMLButtonElement>("[data-theme-palette-asset]").forEach((button) => {
      const assetId = button.dataset.themePaletteAsset!;
      const frame = Number(button.dataset.themePaletteFrame) || 0;
      button.onclick = () => this.assignPaletteFrame(this.activeRefPath, assetId, frame);
      button.ondragstart = (event) => {
        const payload = JSON.stringify({ assetId, frame });
        event.dataTransfer?.setData("application/x-dungeon-theme-frame", payload);
        event.dataTransfer?.setData("text/plain", payload);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
      };
    });
    this.host.querySelectorAll<HTMLInputElement>("[data-theme-decoration-enabled]").forEach((input) => input.onchange = () => {
      const rule = this.theme.decorations[Number(input.dataset.themeDecorationEnabled)]!;
      // Only the off state is written, so an ordinary rule stays a plain entry.
      if (input.checked) delete rule.enabled; else rule.enabled = false;
      this.markDirty();
      this.renderDungeonPreview();
    });
    this.host.querySelectorAll<HTMLSelectElement>("[data-theme-decoration-placement]").forEach((input) => input.onchange = () => { this.theme.decorations[Number(input.dataset.themeDecorationPlacement)]!.placement = input.value as EditableTheme["decorations"][number]["placement"]; this.markDirty(); this.renderDungeonPreview(); });
    this.host.querySelectorAll<HTMLInputElement>("[data-theme-decoration-weight]").forEach((input) => input.onchange = () => { this.theme.decorations[Number(input.dataset.themeDecorationWeight)]!.weight = Math.max(0.001, Number(input.value) || 0.001); this.markDirty(); this.renderDungeonPreview(); });
    this.host.querySelectorAll<HTMLInputElement>("[data-theme-decoration-max]").forEach((input) => input.onchange = () => { this.theme.decorations[Number(input.dataset.themeDecorationMax)]!.maxPerFloor = Math.max(1, Number(input.value) || 1); this.markDirty(); this.renderDungeonPreview(); });
  }

  /**
   * Points a reference at a different picture. A stair's height is derived from
   * the sheet by the build, so a stale one is cleared here rather than left to
   * stretch over whatever frame the author picked next.
   */
  private retargetRef(path: string, changes: { assetId?: string; frame?: number }): void {
    const [kind, name] = path.split(":");
    // An object entry exists only while it names a picture, so editing one into
    // being creates it and editing the asset away removes it again.
    if (kind === "object") ((this.theme.objects ??= {})[name as DungeonThemeObjectKind] ??= { assetId: "", frame: 0 });
    const ref = this.refAt(path);
    if (changes.assetId !== undefined) ref.assetId = changes.assetId;
    if (changes.frame !== undefined) ref.frame = changes.frame;
    delete ref.height;
    if (kind === "object" && !ref.assetId) delete this.theme.objects?.[name as DungeonThemeObjectKind];
  }

  private refAt(path: string): AssetFrameRef & { weight?: number; height?: 1 | 2 } {
    if (path === "stairsUp" || path === "stairsDown") return this.theme[path];
    const [kind, first, second] = path.split(":");
    // Reading never creates the entry. Every render asks for one of these, and a
    // theme that gained an empty reference on sight would fail to save.
    if (kind === "object") return this.theme.objects?.[first as DungeonThemeObjectKind] ?? { assetId: "", frame: 0 };
    if (kind === "floor") return this.theme.floorVariants[Number(first)]!;
    if (kind === "wall") return this.theme.wallFrameByMask?.[Number(first)] ?? { assetId: "", frame: 0 };
    return this.theme.decorations[Number(first)]!.variants[Number(second)]!;
  }

  private selectRef(path: string): void {
    this.activeRefPath = path;
    this.host.querySelectorAll<HTMLElement>("[data-theme-ref-row]").forEach((row) => row.classList.toggle("active", row.dataset.themeRefRow === path));
    const target = this.host.querySelector<HTMLElement>("[data-theme-palette-target]");
    if (target) target.textContent = `選択先: ${this.refLabel(path)}`;
  }

  private assignPaletteFrame(path: string, assetId: string, frame: number): void {
    const asset = this.assetsById.get(assetId);
    if (!asset || frame < 0 || frame >= asset.frameCount) {
      this.paletteStatus = "このセルは16pxダンジョン素材として利用できません";
      this.renderPaletteStatus();
      return;
    }
    this.retargetRef(path, { assetId, frame });
    this.host.querySelectorAll<HTMLSelectElement>("[data-theme-ref-asset]").forEach((input) => { if (input.dataset.themeRefAsset === path) input.value = assetId; });
    this.host.querySelectorAll<HTMLInputElement>("[data-theme-ref-frame]").forEach((input) => { if (input.dataset.themeRefFrame === path) input.value = String(frame); });
    this.paletteStatus = `${this.refLabel(path)}へ画像を設定しました`;
    this.selectRef(path);
    this.markDirty();
    this.renderPaletteStatus();
    this.renderFramePreviews();
    this.renderWallPreview();
    this.renderDungeonPreview();
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
    this.host.querySelectorAll<HTMLCanvasElement>("[data-theme-palette-preview]").forEach((canvas) => this.drawFrame(canvas, { assetId: canvas.dataset.assetId!, frame: Number(canvas.dataset.frame) || 0 }));
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
    const drawRef = (ref: AssetFrameRef, x: number, y: number): void => {
      const asset = this.assetsById.get(ref.assetId);
      const image = this.images.get(ref.assetId);
      if (!asset || !image?.complete || image.naturalWidth === 0 || ref.frame >= asset.frameCount) return;
      const sx = asset.margin + (ref.frame % asset.columns) * (asset.tileSize + asset.spacing);
      const sy = asset.margin + Math.floor(ref.frame / asset.columns) * (asset.tileSize + asset.spacing);
      context.drawImage(image, sx, sy, asset.tileSize, asset.tileSize, x * scale, y * scale, scale, scale);
    };
    for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) {
      const index = y * map.width + x;
      for (const ref of [plan.ground[index], plan.structure[index], plan.decoration[index]]) {
        if (ref) drawRef(ref, x, y);
      }
      const above = plan.overhang[index];
      if (above && y > 0) drawRef(above, x, y - 1);
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

  private renderPaletteStatus(): void {
    const status = this.host.querySelector<HTMLElement>("[data-theme-palette-status]");
    if (status) status.textContent = this.paletteStatus;
  }

  private async loadPalette(): Promise<void> {
    if (!import.meta.env.DEV) return;
    try {
      this.paletteStatus = "パレットを読み込み中…";
      this.renderPaletteStatus();
      const response = await fetch("/__map-editor/palettes", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("palette endpoint unavailable");
      const incoming = await response.json() as PaletteLayout;
      const errors = validatePaletteLayout(incoming);
      if (errors.length) throw new Error(errors.join(", "));
      this.paletteLayout = clonePaletteLayout(incoming);
      this.selectPalettePage();
      this.paletteStatus = "保存済みの素材パレットを表示中";
      this.render();
    } catch {
      this.paletteLayout = clonePaletteLayout(DEFAULT_PALETTE_LAYOUT as unknown as PaletteLayout);
      this.selectPalettePage();
      this.paletteStatus = "標準パレットを表示中";
      this.render();
    }
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
