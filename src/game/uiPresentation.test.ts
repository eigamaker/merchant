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
    expect(scene).toContain('if (this.just("space")) { events.push(...performDungeonCommand(this.state, { type: "attack"');
    expect(scene).toContain('label: "攻撃"');
    expect(scene).toContain('label: "インベントリ"');
    expect(scene).toContain("this.openSystemMenu()");
    expect(scene).not.toContain('label: "メニュー"');
    expect(scene).not.toContain("KeyCodes.F1");
    expect(scene).toContain('label: "手動保存 1"');
    expect(scene).toContain("setInteractive({ useHandCursor: !choice.disabled })");
    expect(scene).toContain('hit.on("pointerdown"');
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

  it("renders the opening separately and keeps location headings out of the map", () => {
    const scene = readFileSync(resolve(process.cwd(), "src/scenes/MerchantScene.ts"), "utf8");
    expect(scene).toContain("if (!this.gameStarted) {");
    expect(scene).toContain("this.renderSplashScreen()");
    expect(scene).not.toContain("自宅兼店舗 — ${this.state.day}日目");
    expect(scene).not.toContain("深層ダンジョン 地下${run.floor}階");
    expect(scene).toContain("this.add.rectangle(320, 180, 640, 360, 0x07060b, 0.88).setInteractive()");
  });
});
