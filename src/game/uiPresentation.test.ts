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
    expect(scene).toContain('if (this.just("space")) { this.openDungeonActionMenu()');
    expect(scene).toContain("this.openSystemMenu()");
    expect(scene).toContain("setInteractive({ useHandCursor: !choice.disabled })");
    expect(scene).toContain('hit.on("pointerdown"');
  });
});
