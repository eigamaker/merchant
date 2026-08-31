import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("readable canvas presentation", () => {
  it("does not declare text smaller than 10px and applies high-resolution Japanese text", () => {
    const scene = readFileSync(resolve(process.cwd(), "src/scenes/MerchantScene.ts"), "utf8");
    const sizes = [...scene.matchAll(/fontSize:\s*"(\d+)px"/g)].map((match) => Number(match[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(10);
    expect(scene).toContain("child.setResolution(2)");
    expect(scene).toContain("Noto Sans JP Variable");
  });

  it("uses only one-to-one or two-to-one desktop canvas scaling", () => {
    const css = readFileSync(resolve(process.cwd(), "src/style.css"), "utf8");
    expect(css).toContain("width: 640px");
    expect(css).toContain("width: 1280px");
  });

  it("exposes the context action and system menus with mouse-selectable choices", () => {
    const scene = readFileSync(resolve(process.cwd(), "src/scenes/MerchantScene.ts"), "utf8");
    // 商人は戦わない。攻撃の入力も行動一覧の攻撃も、画面から消えていること。
    expect(scene).not.toContain('type: "attack"');
    expect(scene).not.toContain('label: "攻撃"');
    expect(scene).toContain('label: "押し返し"');
    expect(scene).toContain('label: "インベントリ"');
    expect(scene).toContain("this.openSystemMenu()");
    expect(scene).not.toContain('label: "メニュー"');
    expect(scene).not.toContain("KeyCodes.F1");
    expect(scene).toContain('label: "手動保存 1"');
    expect(scene).toContain("setInteractive({ useHandCursor: !choice.disabled })");
    expect(scene).toContain('hit.on("pointerdown"');
  });

  it("exposes the safe home vault and no longer enters a game-over menu", () => {
    const scene = readFileSync(resolve(process.cwd(), "src/scenes/MerchantScene.ts"), "utf8");
    expect(scene).toContain("private openVault()");
    expect(scene).toContain('label: `金庫 (${this.state.vaultGold}G)`');
    expect(scene).not.toContain("showGameOver");
    expect(scene).not.toContain("deleteCampaign(campaignId)");
  });

  it("uses one WASD-adjacent shortcut definition in the help and map HUD", () => {
    const scene = readFileSync(resolve(process.cwd(), "src/scenes/MerchantScene.ts"), "utf8");
    expect(scene).toContain('investigate: "E"');
    expect(scene).toContain('inventory: "R"');
    expect(scene).toContain('talk: "T"');
    expect(scene).toContain('shop: "F"');
    expect(scene).toContain('menu: "Tab / Esc"');
    expect(scene).toContain('const controls = this.state.location === "home" ? HOME_CONTROL_LINES : DUNGEON_CONTROL_LINES');
    expect(scene).toContain('const hint = this.state.location === "home" ? HOME_SHORTCUT_HINT : DUNGEON_SHORTCUT_HINT');
    expect(scene).not.toMatch(/KeyCodes\.(?:I|O|M|L|H|Z)\b/);
    expect(scene).not.toContain("E/Enter");
    expect(scene).not.toContain("M/Esc");
  });

  it("draws every window, button and gauge through the shared skin", () => {
    const scene = readFileSync(resolve(process.cwd(), "src/scenes/MerchantScene.ts"), "utf8");
    // 枠付きの窓・立体ボタン・ゲージは uiSkin 経由に統一する。
    expect(scene).toContain('from "./uiSkin"');
    expect(scene).toContain("addWindow(this, PANEL_X, 0, PANEL_W, 360)");
    expect(scene).toContain("addWindow(this, 0, LOG_Y, MAP_W, LOG_H)");
    expect(scene).toContain("addWindow(this, 40, 20, 560, 320, { shadow: 4 })");
    expect(scene).toContain("addWindow(this, 10, 10, 620, 340, { shadow: 4 })");
    expect(scene).toContain("addGauge(this,");
    expect(scene).toContain("addSelectionBar(this,");
    expect(scene).toContain("addSkinButton(this, x, y, width, height,");
    expect(scene).not.toContain("addUiPanel");
    expect(scene).not.toContain("setStrokeStyle");
  });

  it("keeps the skin geometry inside the 640x360 canvas", () => {
    const scene = readFileSync(resolve(process.cwd(), "src/scenes/MerchantScene.ts"), "utf8");
    const top = Number(/const ACTION_BUTTON_TOP = (\d+);/.exec(scene)?.[1]);
    const height = Number(/const ACTION_BUTTON_H = (\d+);/.exec(scene)?.[1]);
    const pitch = Number(/const ACTION_BUTTON_PITCH = (\d+);/.exec(scene)?.[1]);
    expect(pitch).toBeGreaterThan(height);
    // 自宅の9件と、護衛行で14px下がるダンジョンの8件がどちらも枠の内側に収まる。
    expect(top + 8 * pitch + height).toBeLessThanOrEqual(353);
    expect(top + 14 + 7 * pitch + height).toBeLessThanOrEqual(353);
  });

  it("fits the message log rows, divider and hint inside the log window", () => {
    const scene = readFileSync(resolve(process.cwd(), "src/scenes/MerchantScene.ts"), "utf8");
    const value = (name: string): number => Number(new RegExp(`const ${name} = (\\d+);`).exec(scene)?.[1]);
    const logHeight = value("LOG_H");
    const rows = value("LOG_ROW_COUNT");
    const top = value("LOG_ROW_TOP");
    const pitch = value("LOG_ROW_PITCH");
    const rowHeight = value("LOG_ROW_H");
    const dividerY = value("LOG_DIVIDER_Y");
    const hintY = value("LOG_HINT_Y");
    const hintHeight = value("LOG_HINT_H");
    // 窓枠は7px。本文はその内側から始まり、ヒントの下端も内側で終わる。
    const border = 7;
    expect(rows).toBeGreaterThanOrEqual(2);
    expect(top).toBeGreaterThanOrEqual(border);
    expect(pitch).toBeGreaterThanOrEqual(rowHeight);
    // 最終行が罫線に食い込まない。
    expect(top + (rows - 1) * pitch + rowHeight).toBeLessThanOrEqual(dividerY);
    // ヒストリの保持数と行数が一致する。
    expect(scene).toContain("this.messageLog.length > LOG_ROW_COUNT");
    expect(scene).toContain("this.messageLog.slice(-LOG_ROW_COUNT)");
    // ヒントの下端が窓の内側に収まる。
    expect(hintY).toBeGreaterThan(dividerY);
    expect(hintY + hintHeight).toBeLessThanOrEqual(logHeight - border);
  });

  it("shows a context prompt and a context-labelled investigate button", () => {
    const scene = readFileSync(resolve(process.cwd(), "src/scenes/MerchantScene.ts"), "utf8");
    expect(scene).toContain("private investigateContext()");
    expect(scene).toContain("this.renderDungeonPrompt()");
    // プロンプトと右のボタンは同じ判断から作る。
    expect(scene).toContain("label: this.investigateContext() ?? \"調べる\"");
    expect(scene).toContain("disabled: !this.investigateContext()");
  });

  it("feeds combat back with floating values, a defeat burst and an edge flash", () => {
    const scene = readFileSync(resolve(process.cwd(), "src/scenes/MerchantScene.ts"), "utf8");
    expect(scene).toContain("addFloatingValue");
    expect(scene).toContain("addDefeatBurst");
    expect(scene).toContain("addEdgeFlash(this, 0, 0, MAP_W, MAP_H");
    // 倒された相手はスプライトが消えているので、撃破地点から数値を出す。
    expect(scene).toContain("defeatedAt.set(event.actorId, event.pos)");
  });

  it("reaches the gear hand-over from the escort profile", () => {
    const scene = readFileSync(resolve(process.cwd(), "src/scenes/MerchantScene.ts"), "utf8");
    expect(scene).toContain("private openNpcGear(");
    expect(scene).toContain("private openEntrustGear(");
    expect(scene).toContain('label: "装備を預ける"');
    // 接客中は在庫を動かせない、という既存の規則に従う。
    expect(scene).toContain("canReorganizeHomeInventory(this.state)");
  });

  it("renders the opening separately and keeps location headings out of the map", () => {
    const scene = readFileSync(resolve(process.cwd(), "src/scenes/MerchantScene.ts"), "utf8");
    expect(scene).toContain("if (!this.gameStarted) {");
    expect(scene).toContain("this.renderSplashScreen()");
    expect(scene).not.toContain("自宅兼店舗 — ${this.state.day}日目");
    expect(scene).not.toContain("深層ダンジョン 地下${run.floor}階");
    expect(scene).toContain("this.add.rectangle(320, 180, 640, 360, 0x07060b, 0.88).setInteractive()");
  });

  it("exposes daily expedition, shop inventory lock, and guard reputation flows", () => {
    const scene = readFileSync(resolve(process.cwd(), "src/scenes/MerchantScene.ts"), "utf8");
    expect(scene).toContain("canBeginExpedition(this.state)");
    expect(scene).toContain('"本日の探索済み"');
    expect(scene).toContain("canReorganizeHomeInventory(this.state)");
    expect(scene).toContain("営業中は在庫整理できない。");
    expect(scene).toContain('"在庫管理（営業中）"');
    expect(scene).toContain("private openEscortProfile");
    expect(scene).toContain("private openEscortObservations");
    expect(scene).toContain("private openEscortHistory");
    expect(scene).toContain("private openGuardDescentPrompt");
  });

  it("starts customer exit immediately after a sale without redrawing away its tween", () => {
    const scene = readFileSync(resolve(process.cwd(), "src/scenes/MerchantScene.ts"), "utf8");
    expect(scene).toContain("if (result.accepted) this.finishCustomerAndContinue();");
    expect(scene).not.toContain('this.openMenu(result.accepted ? "売買成立"');
    expect(scene).toMatch(/if \(this\.just\("enter"\) \|\| this\.just\("space"\)\)[\s\S]*?if \(this\.modal\) this\.render\(\);\s*return;/);
    expect(scene).toMatch(/hit\.on\("pointerdown"[\s\S]*?choice\.action\(\);\s*if \(this\.modal\) this\.render\(\);/);
  });
});
