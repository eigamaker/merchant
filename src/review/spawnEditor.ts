/**
 * The spawn table: who turns up, how deep, and how hard — on one screen.
 *
 * Before this existed the answer was spread across `themes.json` (three fixed
 * depth buckets) and `engine.ts` (a fixed head count), and a floor with nothing
 * to meet was only discoverable by playing down to it. The depth strip makes
 * that gap visible, and the budget row shows how many bodies a floor can hold
 * once tier costs are taken into account.
 */
import { ACTOR_CATALOG, actorEnemyCost, actorEnemyStatsAt, actorHasEnemyStats, actorSupportsDirectionalMovement } from "../game/actorCatalog";
import { DUNGEON_THEME_CATALOG } from "../game/dungeonThemeCatalog.generated";
import { encounterBudget } from "../game/dungeonDifficulty";
import type { DungeonSpawnEntry } from "../game/dungeonThemes";

const PREVIEW_FLOORS = 16;
const THEME_API = "/__map-editor/dungeon-themes";

type EditableSpawn = DungeonSpawnEntry & { maxFloor?: number };
interface EditableTheme { id: string; label: string; spawns?: EditableSpawn[] }
interface ThemeDocument { version: 1; themes: EditableTheme[] }

const escapeHtml = (value: unknown): string =>
  String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

/** Rows a floor can draw from. Mirrors dungeonThemeSpawns so unsaved edits preview. */
function spawnsAtFloor(entries: readonly EditableSpawn[], floor: number): EditableSpawn[] {
  return entries.filter((entry) => floor >= entry.minFloor && (entry.maxFloor === undefined || floor <= entry.maxFloor));
}

export class SpawnTableEditor {
  private document: ThemeDocument = { version: 1, themes: structuredClone(DUNGEON_THEME_CATALOG) as unknown as EditableTheme[] };
  private themeId = "";
  private status = "";

  constructor(private readonly host: HTMLElement, private readonly onSaved?: () => void) {
    this.render();
    void this.load();
  }

  private get theme(): EditableTheme | undefined {
    return this.document.themes.find((entry) => entry.id === this.themeId) ?? this.document.themes[0];
  }

  private enemies() {
    return Object.values(ACTOR_CATALOG)
      .filter((actor) => actor.roles?.includes("enemy") && actorHasEnemyStats(actor) && actorSupportsDirectionalMovement(actor))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  private async load(): Promise<void> {
    try {
      const response = await fetch(THEME_API);
      if (!response.ok) throw new Error(await response.text());
      this.document = await response.json();
      this.status = "";
    } catch {
      // Without the dev server the bundled catalogue is still editable in memory.
      this.status = "開発サーバーに接続できないため、同梱のテーマを表示しています。";
    }
    this.render();
  }

  private async save(): Promise<void> {
    try {
      if (import.meta.env.DEV) {
        const response = await fetch(THEME_API, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(this.document) });
        if (!response.ok) throw new Error(await response.text());
        this.document = await response.json().then((body) => (body.themes ? body : { version: 1, themes: body }));
        this.status = "出現表を保存しました。";
        this.onSaved?.();
      } else {
        const blob = new Blob([JSON.stringify(this.document, null, 2)], { type: "application/json" });
        const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "dungeon-themes.json" });
        link.click();
        URL.revokeObjectURL(link.href);
        this.status = "JSONを書き出しました。";
      }
    } catch (error) {
      this.status = `保存エラー: ${error instanceof Error ? error.message : "不明"}`;
    }
    this.render();
  }

  private rowMarkup(entry: EditableSpawn, index: number, enemies: ReturnType<SpawnTableEditor["enemies"]>): string {
    const actor = ACTOR_CATALOG[entry.actorId];
    const elite = entry.role === "elite";
    const stats = actorEnemyStatsAt(actor, Math.max(1, entry.minFloor), elite);
    const strip = Array.from({ length: PREVIEW_FLOORS }, (_, offset) => {
      const floor = offset + 1;
      const active = floor >= entry.minFloor && (entry.maxFloor === undefined || floor <= entry.maxFloor);
      return `<span class="spawn-cell${active ? " active" : ""}${elite ? " elite" : ""}" title="B${floor}"></span>`;
    }).join("");
    const options = enemies.map((candidate) => `<option value="${escapeHtml(candidate.id)}"${candidate.id === entry.actorId ? " selected" : ""}>${escapeHtml(candidate.label)}</option>`).join("");
    return `<tr>
      <td><select data-spawn-field="actorId" data-spawn-index="${index}">${options}</select></td>
      <td><input type="number" min="1" data-spawn-field="minFloor" data-spawn-index="${index}" value="${entry.minFloor}"></td>
      <td><input type="number" min="1" data-spawn-field="maxFloor" data-spawn-index="${index}" value="${entry.maxFloor ?? ""}" placeholder="∞"></td>
      <td><input type="number" min="0.1" step="0.1" data-spawn-field="weight" data-spawn-index="${index}" value="${entry.weight}"></td>
      <td><select data-spawn-field="role" data-spawn-index="${index}"><option value="common"${elite ? "" : " selected"}>通常</option><option value="elite"${elite ? " selected" : ""}>強敵</option></select></td>
      <td><input type="number" min="1" data-spawn-field="maxPerFloor" data-spawn-index="${index}" value="${entry.maxPerFloor ?? ""}" placeholder="—"></td>
      <td class="spawn-strip">${strip}</td>
      <td class="num">${stats ? `${stats.maxHp} / ${stats.damage}` : "—"}</td>
      <td><button type="button" data-spawn-remove="${index}" aria-label="この行を削除">✕</button></td>
    </tr>`;
  }

  render(): void {
    const themes = this.document.themes;
    if (!themes.length) { this.host.innerHTML = `<p class="small">ダンジョンテーマがありません。</p>`; return; }
    if (!themes.some((entry) => entry.id === this.themeId)) this.themeId = themes[0]!.id;
    const theme = this.theme!;
    const entries = theme.spawns ?? [];
    const enemies = this.enemies();

    const budgets = Array.from({ length: PREVIEW_FLOORS }, (_, offset) => {
      const floor = offset + 1;
      const available = spawnsAtFloor(entries, floor);
      // The cheapest eligible line bounds how many bodies the budget can buy.
      const cheapest = available.length ? Math.min(...available.map((entry) => actorEnemyCost(ACTOR_CATALOG[entry.actorId], entry.role === "elite"))) : 0;
      const count = cheapest > 0 ? Math.floor(encounterBudget(floor) / cheapest) : 0;
      return `<div class="spawn-budget-column${available.length ? "" : " empty"}"><span>B${floor}</span><strong>${available.length ? `≤${count}` : "空"}</strong></div>`;
    }).join("");

    this.host.innerHTML = `<div class="spawn-editor-toolbar">
        <label>テーマ <select data-spawn-theme>${themes.map((entry) => `<option value="${escapeHtml(entry.id)}"${entry.id === this.themeId ? " selected" : ""}>${escapeHtml(entry.label)}</option>`).join("")}</select></label>
        <button type="button" data-spawn-add>行を追加</button>
        <button type="button" class="primary" data-spawn-save>出現表を保存</button>
        <span class="save-status">${escapeHtml(this.status)}</span>
      </div>
      <p class="small">重みは出やすさの比です。格（ティア）が高い敵ほど1階あたりの予算を多く使うので、強い敵を入れると数が減ります。HP／攻撃は最浅階の値で、深さに応じて自動で伸びます。</p>
      <div class="spawn-table-scroll"><table class="spawn-table"><thead><tr><th>敵</th><th>最浅</th><th>最深</th><th>重み</th><th>種別</th><th>上限/階</th><th>出現する階 (B1〜B${PREVIEW_FLOORS})</th><th>HP/攻撃</th><th></th></tr></thead><tbody>${entries.map((entry, index) => this.rowMarkup(entry, index, enemies)).join("") || `<tr><td colspan="9" class="small">行がありません。「行を追加」から作成します。</td></tr>`}</tbody></table></div>
      <h3>階ごとの想定体数</h3><p class="small">最も安い敵だけで埋めた場合の上限です。「空」はその階に出現候補が無いことを示します。</p>
      <div class="spawn-budget">${budgets}</div>`;

    this.bind(theme, entries);
  }

  private bind(theme: EditableTheme, entries: EditableSpawn[]): void {
    this.host.querySelector<HTMLSelectElement>("[data-spawn-theme]")!.onchange = (event) => {
      this.themeId = (event.currentTarget as HTMLSelectElement).value;
      this.render();
    };
    this.host.querySelector<HTMLButtonElement>("[data-spawn-add]")!.onclick = () => {
      theme.spawns = [...entries, { actorId: this.enemies()[0]?.id ?? "slime1", minFloor: 1, weight: 1 }];
      this.render();
    };
    this.host.querySelector<HTMLButtonElement>("[data-spawn-save]")!.onclick = () => { void this.save(); };
    for (const control of this.host.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-spawn-field]")) {
      control.onchange = () => {
        const entry = entries[Number(control.dataset.spawnIndex)];
        if (!entry) return;
        const raw = control.value.trim();
        const numeric = Number(raw);
        switch (control.dataset.spawnField) {
          case "actorId": entry.actorId = control.value; break;
          case "minFloor": entry.minFloor = Math.max(1, Math.round(numeric) || 1); break;
          // A blank deepest floor means "from the shallowest one down".
          case "maxFloor": if (!raw || !Number.isFinite(numeric)) delete entry.maxFloor; else entry.maxFloor = Math.max(entry.minFloor, Math.round(numeric)); break;
          case "weight": entry.weight = Math.max(0.1, numeric || 1); break;
          case "role": if (control.value === "elite") entry.role = "elite"; else delete entry.role; break;
          case "maxPerFloor": if (!raw || !Number.isFinite(numeric)) delete entry.maxPerFloor; else entry.maxPerFloor = Math.max(1, Math.round(numeric)); break;
        }
        this.render();
      };
    }
    for (const button of this.host.querySelectorAll<HTMLButtonElement>("[data-spawn-remove]")) {
      button.onclick = () => {
        theme.spawns = entries.filter((_, index) => index !== Number(button.dataset.spawnRemove));
        this.render();
      };
    }
  }
}
