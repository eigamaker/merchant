import type { ItemRarity } from "./types";

/**
 * ウインドウ・ボタン・ゲージの見た目を決める唯一の参照先。
 *
 * 枠は「輪郭 → 立ち上がりのベベル → 金物の面 → 沈んだ内側」の帯を外から内へ
 * 重ねて描く。帯は矩形の外周1pxずつなので、どの大きさの窓でも同じ厚みになる。
 */

export const UI_COLORS = {
  outline: 0x0a0810,
  frameLight: 0xe8c68d,
  frameBase: 0xbb8c50,
  frameEdge: 0x8b6540,
  frameShadow: 0x5c3d25,
  rivet: 0xf8e5b4,
  windowFill: 0x1b1526,
  windowFillDeep: 0x110c1a,
  sunkenTop: 0x0d0913,
  sunkenBottom: 0x342a47,
  scrim: 0x07060b,
  shadow: 0x05040a,
  gaugeTrack: 0x0d0912,
  bagGauge: 0x3f6f9c,
  bagGaugeLight: 0x8fc6ef,
  selection: 0xb07a50,
  selectionLight: 0xe0a774,
} as const;

export const UI_INK = {
  title: "#ffe8ab",
  body: "#e8e0d1",
  dim: "#a89cad",
  value: "#f6ecd5",
  accent: "#ffd88a",
  onSelection: "#16121b",
  disabled: "#71697a",
  /** マップ上の文字に回す縁取り。板を敷かずに読ませる。 */
  outline: "#0a0810",
} as const;

/** 品物の希少度はインベントリと取引画面で同じ色になる。 */
export const RARITY_INK: Record<ItemRarity, string> = {
  common: "#ddd4c8",
  uncommon: "#8fd694",
  rare: "#7fb8f0",
  legendary: "#f0b95c",
  unique: "#ff9f6a",
};

/** 一覧と詳細で同じ表記になる希少度の名前。 */
export const RARITY_LABEL: Record<ItemRarity, string> = {
  common: "並品",
  uncommon: "上物",
  rare: "稀少",
  legendary: "伝説",
  unique: "唯一",
};

export interface UiFrameBand {
  /** 矩形の外周から内側へ何px目の帯か。 */
  inset: number;
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export type UiFrameVariant = "window" | "inset" | "gauge";

/** 全周同色の帯。 */
const flat = (inset: number, color: number): UiFrameBand => ({ inset, top: color, left: color, right: color, bottom: color });

/** 上・左が明るい＝盛り上がって見える帯。逆にすると沈んで見える。 */
const bevel = (inset: number, light: number, dark: number, raised: boolean): UiFrameBand => ({
  inset,
  top: raised ? light : dark,
  left: raised ? light : dark,
  right: raised ? dark : light,
  bottom: raised ? dark : light,
});

const WINDOW_BANDS: readonly UiFrameBand[] = [
  flat(0, UI_COLORS.outline),
  bevel(1, UI_COLORS.frameLight, UI_COLORS.frameShadow, true),
  flat(2, UI_COLORS.frameBase),
  flat(3, UI_COLORS.frameEdge),
  bevel(4, UI_COLORS.frameLight, UI_COLORS.frameShadow, false),
  flat(5, UI_COLORS.outline),
  bevel(6, UI_COLORS.sunkenBottom, UI_COLORS.sunkenTop, false),
];

const INSET_BANDS: readonly UiFrameBand[] = [
  flat(0, UI_COLORS.frameShadow),
  flat(1, UI_COLORS.outline),
  bevel(2, UI_COLORS.sunkenBottom, UI_COLORS.sunkenTop, false),
];

const GAUGE_BANDS: readonly UiFrameBand[] = [bevel(0, UI_COLORS.sunkenBottom, UI_COLORS.sunkenTop, false)];

const FRAME_BANDS: Record<UiFrameVariant, readonly UiFrameBand[]> = {
  window: WINDOW_BANDS,
  inset: INSET_BANDS,
  gauge: GAUGE_BANDS,
};

/** 枠を構成する帯を外側から順に返す。 */
export function frameBands(variant: UiFrameVariant): readonly UiFrameBand[] {
  return FRAME_BANDS[variant];
}

/** 枠の厚み。中身はこの分だけ内側に置く。 */
export function frameBorderWidth(variant: UiFrameVariant): number {
  return FRAME_BANDS[variant].length;
}

/** 向かい合う帯が食い合わない最小の辺の長さ。 */
export function minimumFrameSize(variant: UiFrameVariant): number {
  return frameBorderWidth(variant) * 2 + 1;
}

export type ButtonState = "idle" | "hover" | "down" | "disabled";

export interface ButtonPalette {
  face: number;
  gloss: number;
  light: number;
  shadow: number;
  rim: number;
  ink: string;
  keyInk: string;
}

export const BUTTON_PALETTE: Record<ButtonState, ButtonPalette> = {
  idle: { face: 0x5b3e32, gloss: 0x86604a, light: 0x9a6f52, shadow: 0x2f1d18, rim: 0xc49a66, ink: "#fff0d0", keyInk: "#cbb8a0" },
  hover: { face: 0x8a6047, gloss: 0xb8865f, light: 0xd3a071, shadow: 0x442b20, rim: 0xffd79a, ink: "#fffaf0", keyInk: "#ffe9c4" },
  down: { face: 0x3d2820, gloss: 0x2a1b16, light: 0x8a6047, shadow: 0x1d120f, rim: 0xc49a66, ink: "#ffe6bd", keyInk: "#bda88c" },
  disabled: { face: 0x2c2732, gloss: 0x373140, light: 0x453e4d, shadow: 0x191520, rim: 0x5b5464, ink: "#7d7587", keyInk: "#6b6474" },
};

/** ボタンの枠。押下中だけベベルを反転して沈んで見せる。 */
export function buttonFrameBands(state: ButtonState): readonly UiFrameBand[] {
  const palette = BUTTON_PALETTE[state];
  return [
    flat(0, UI_COLORS.outline),
    flat(1, palette.rim),
    bevel(2, palette.light, palette.shadow, state !== "down"),
  ];
}

export const BUTTON_BORDER_WIDTH = 3;

/** ゲージの塗り幅。0や範囲外を渡されても軌道に収める。 */
export function gaugeFillWidth(value: number, max: number, trackWidth: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0 || trackWidth <= 0) return 0;
  if (value <= 0) return 0;
  const ratio = Math.min(1, value / max);
  return Math.max(1, Math.round(trackWidth * ratio));
}

/** 残量で色が変わるHPゲージ。半分で黄、四分の一で赤。 */
export function hpGaugeColors(value: number, max: number): { fill: number; light: number } {
  const ratio = max > 0 ? value / max : 0;
  if (ratio <= 0.25) return { fill: 0x9c2b26, light: 0xe2564a };
  if (ratio <= 0.5) return { fill: 0xb07d24, light: 0xf0c95d };
  return { fill: 0x3f8f4a, light: 0x86d187 };
}

/** 満杯に近いほど警告色に寄る積載ゲージ。 */
export function capacityGaugeColors(value: number, max: number): { fill: number; light: number } {
  const ratio = max > 0 ? value / max : 0;
  if (ratio >= 1) return { fill: 0x9c2b26, light: 0xe2564a };
  if (ratio >= 0.8) return { fill: 0xb07d24, light: 0xf0c95d };
  return { fill: UI_COLORS.bagGauge, light: UI_COLORS.bagGaugeLight };
}

/** 希少度の文字色。未設定の品はcommon扱い。 */
export function rarityInk(rarity: ItemRarity | undefined): string {
  return RARITY_INK[rarity ?? "common"] ?? RARITY_INK.common;
}

/** 希少度の表示名。未設定の品はcommon扱い。 */
export function rarityLabel(rarity: ItemRarity | undefined): string {
  return RARITY_LABEL[rarity ?? "common"] ?? RARITY_LABEL.common;
}

/** ログ1行の調子。表示色だけを決め、ゲーム進行には影響しない。 */
export type MessageTone = "info" | "damage" | "gain" | "trade" | "warn";

const TONE_INK: Record<MessageTone, string> = {
  info: "#e8e0d1",
  damage: "#ff9a8f",
  gain: "#8fd694",
  trade: "#ffd88a",
  warn: "#ffb45c",
};

export function toneInk(tone: MessageTone): string {
  return TONE_INK[tone];
}

/**
 * 本文からログの調子を決める。
 *
 * 判定順が意味を持つ。被害の報告は金額や入手の語を含むことがあるので先に見る。
 */
export function messageTone(text: string): MessageTone {
  if (/ダメージ|倒した|退けた|死亡|力尽きた|空腹|物語はここで終わった|罠/.test(text)) return "damage";
  if (/売却|売った|買った|仕入れた|報酬|G[でを]/.test(text)) return "trade";
  if (/拾った|回収した|見つけた|回復した|得た/.test(text)) return "gain";
  if (/できない|足りない|いっぱい|売り切れ|不足|残っていない|塞いで|ない。/.test(text)) return "warn";
  return "info";
}

/** 浮かぶ数値の色。敵への打撃と味方の被弾を取り違えないための対応表。 */
export const FLOATING_INK = {
  enemy: "#ffe6a8",
  ally: "#ff8f80",
  heal: "#96e39b",
  gold: "#ffd166",
} as const;

export type FloatingKind = keyof typeof FLOATING_INK;
