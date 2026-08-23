import { describe, expect, it } from "vitest";
import {
  BUTTON_BORDER_WIDTH,
  BUTTON_PALETTE,
  capacityGaugeColors,
  buttonFrameBands,
  frameBands,
  frameBorderWidth,
  gaugeFillWidth,
  hpGaugeColors,
  minimumFrameSize,
  rarityInk,
  rarityLabel,
  type UiFrameVariant,
} from "./uiTheme";

const VARIANTS: UiFrameVariant[] = ["window", "inset", "gauge"];

describe("ウインドウ枠の帯", () => {
  it("外側から1pxずつ隙間なく内側へ並ぶ", () => {
    for (const variant of VARIANTS) {
      const bands = frameBands(variant);
      expect(bands.length).toBeGreaterThan(0);
      expect(bands.map((band) => band.inset)).toEqual(bands.map((_, index) => index));
    }
  });

  it("枠の厚みは帯の本数と一致し、最小サイズは向かい合っても潰れない", () => {
    for (const variant of VARIANTS) {
      expect(frameBorderWidth(variant)).toBe(frameBands(variant).length);
      expect(minimumFrameSize(variant)).toBeGreaterThan(frameBorderWidth(variant) * 2);
    }
  });

  it("ウインドウは内側に文字を置ける余白が残る厚みに収まる", () => {
    // 192px幅のステータス窓でも中身に150px以上残る厚みにしておく。
    expect(frameBorderWidth("window")).toBeLessThanOrEqual(8);
    expect(frameBorderWidth("inset")).toBeLessThan(frameBorderWidth("window"));
  });

  it("押下中のボタンだけベベルが反転する", () => {
    const idle = buttonFrameBands("idle").at(-1)!;
    const down = buttonFrameBands("down").at(-1)!;
    expect(idle.top).toBe(idle.left);
    expect(idle.right).toBe(idle.bottom);
    expect(idle.top).toBe(BUTTON_PALETTE.idle.light);
    expect(idle.bottom).toBe(BUTTON_PALETTE.idle.shadow);
    expect(down.top).toBe(BUTTON_PALETTE.down.shadow);
    expect(down.bottom).toBe(BUTTON_PALETTE.down.light);
    expect(buttonFrameBands("idle")).toHaveLength(BUTTON_BORDER_WIDTH);
  });
});

describe("ゲージ", () => {
  it("軌道の幅に比例して塗り、満杯を超えても溢れない", () => {
    expect(gaugeFillWidth(5, 10, 100)).toBe(50);
    expect(gaugeFillWidth(10, 10, 100)).toBe(100);
    expect(gaugeFillWidth(30, 10, 100)).toBe(100);
  });

  it("残りが0なら描かず、わずかでも残っていれば1px残す", () => {
    expect(gaugeFillWidth(0, 10, 100)).toBe(0);
    expect(gaugeFillWidth(-3, 10, 100)).toBe(0);
    expect(gaugeFillWidth(0.01, 10, 100)).toBe(1);
  });

  it("最大値や幅が壊れていても0を返す", () => {
    expect(gaugeFillWidth(5, 0, 100)).toBe(0);
    expect(gaugeFillWidth(5, 10, 0)).toBe(0);
    expect(gaugeFillWidth(Number.NaN, 10, 100)).toBe(0);
  });

  it("HPは半分で黄、四分の一で赤に変わる", () => {
    const full = hpGaugeColors(10, 10);
    const half = hpGaugeColors(5, 10);
    const low = hpGaugeColors(2, 10);
    expect(full.fill).not.toBe(half.fill);
    expect(half.fill).not.toBe(low.fill);
    expect(hpGaugeColors(6, 10).fill).toBe(full.fill);
    expect(hpGaugeColors(2.5, 10).fill).toBe(low.fill);
  });

  it("積載は満杯に近づくと警告色になる", () => {
    const light = capacityGaugeColors(1, 10);
    expect(capacityGaugeColors(5, 10).fill).toBe(light.fill);
    expect(capacityGaugeColors(8, 10).fill).not.toBe(light.fill);
    expect(capacityGaugeColors(10, 10).fill).toBe(hpGaugeColors(1, 10).fill);
  });
});

describe("希少度の表示", () => {
  it("希少度ごとに色と名前が変わる", () => {
    const inks = new Set(["common", "uncommon", "rare", "legendary", "unique"].map((rarity) => rarityInk(rarity as never)));
    expect(inks.size).toBe(5);
    expect(rarityLabel("legendary")).toBe("伝説");
  });

  it("希少度が無い品はcommonとして扱う", () => {
    expect(rarityInk(undefined)).toBe(rarityInk("common"));
    expect(rarityLabel(undefined)).toBe(rarityLabel("common"));
  });
});
