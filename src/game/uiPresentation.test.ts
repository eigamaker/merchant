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

  it("keeps shortcuts in help and the right action panel, not under every message", () => {
    const scene = readFileSync(resolve(process.cwd(), "src/scenes/MerchantScene.ts"), "utf8");
    expect(scene).toContain('investigate: "E"');
    expect(scene).toContain('inventory: "R"');
    expect(scene).toContain('talk: "T"');
    expect(scene).toContain('shop: "F"');
    expect(scene).toContain('menu: "Tab / Esc"');
    expect(scene).toContain('const controls = this.state.location === "home" ? HOME_CONTROL_LINES : DUNGEON_CONTROL_LINES');
    expect(scene).not.toContain("HOME_SHORTCUT_HINT");
    expect(scene).not.toContain("DUNGEON_SHORTCUT_HINT");
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

  it("wraps the latest message across the full log window without a shortcut footer", () => {
    const scene = readFileSync(resolve(process.cwd(), "src/scenes/MerchantScene.ts"), "utf8");
    const value = (name: string): number => Number(new RegExp(`const ${name} = (\\d+);`).exec(scene)?.[1]);
    const logHeight = value("LOG_H");
    const rows = value("LOG_ROW_COUNT");
    const previousY = value("LOG_PREVIOUS_Y");
    const previousHeight = value("LOG_PREVIOUS_H");
    const latestY = value("LOG_LATEST_AFTER_PREVIOUS_Y");
    expect(rows).toBeGreaterThanOrEqual(2);
    expect(previousY + previousHeight).toBeLessThanOrEqual(latestY);
    expect(latestY).toBeLessThan(logHeight - 7);
    expect(scene).toContain("this.messageLog.slice(-LOG_ROW_COUNT)");
    expect(scene).toContain("wordWrap: { width: LOG_TEXT_W, useAdvancedWrap: true }");
    expect(scene).toContain("maxLines: previous ? 3 : 4");
    expect(scene).not.toContain("LOG_HINT");
    expect(scene).not.toContain("LOG_DIVIDER");
  });

  it("reports whether a manual save succeeded", () => {
    const scene = readFileSync(resolve(process.cwd(), "src/scenes/MerchantScene.ts"), "utf8");
    expect(scene).toContain('this.openMenu("保存しました"');
    expect(scene).toContain('this.openMenu("保存できませんでした"');
  });

  it("offers unlimited shop stock while provisions consume bag slots", () => {
    const scene = readFileSync(resolve(process.cwd(), "src/scenes/MerchantScene.ts"), "utf8");
    expect(scene).toContain("private openProvisionPurchaseMenu()");
    expect(scene).toContain("積めるだけ");
    expect(scene).toContain("食品商の在庫に上限はない");
    expect(scene).toContain("携行食料は${PROVISIONS_PER_SLOT}個まで1枠");
    expect(scene).toContain("捨てる: 携行食料");
  });

  it("routes healing medicine through the apothecary and return stones through deep chests", () => {
    const scene = readFileSync(resolve(process.cwd(), "src/scenes/MerchantScene.ts"), "utf8");
    expect(scene).toContain("private openApothecaryShop()");
    expect(scene).toContain("薬師ネヴァの薬屋");
    expect(scene).toContain("回復薬は店頭販売できない");
    expect(scene).toContain("地下13階以深の宝箱");
    expect(scene).not.toContain('["provisions", "smokeBombs", "returnStones"]');
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
    expect(scene).toContain('label: "護衛装備を整える"');
    // 接客中は在庫を動かせない、という既存の規則に従う。
    expect(scene).toContain("canReorganizeHomeInventory(this.state)");
  });

  it("keeps gear hand-over out of customer service and confirms escort departure", () => {
    const scene = readFileSync(resolve(process.cwd(), "src/scenes/MerchantScene.ts"), "utf8");
    const visitorMenu = scene.slice(scene.indexOf("private openNpcVisitor("), scene.indexOf("private openDungeonAdventurer("));
    expect(visitorMenu).not.toContain('label: "装備を預ける"');
    expect(scene).toContain("private requestExpeditionStart()");
    expect(scene).toContain('this.openMenu("護衛を連れていきますか？"');
    expect(scene).toContain('this.openMenu("護衛を連れずに入りますか？"');
    expect(scene).toContain('label: "出発前に護衛装備を整える"');
    expect(scene).toContain('label: "契約を取り消して単独で入る"');
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
