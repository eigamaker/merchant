import Phaser from "phaser";
import {
  BUTTON_BORDER_WIDTH,
  BUTTON_PALETTE,
  UI_COLORS,
  UI_INK,
  buttonFrameBands,
  frameBands,
  frameBorderWidth,
  gaugeFillWidth,
  minimumFrameSize,
  type ButtonState,
  type UiFrameBand,
  type UiFrameVariant,
} from "../game/uiTheme";

/**
 * ウインドウ枠は Graphics で直接描く。Phaser の NineSlice は WebGL 専用で、
 * Canvas にフォールバックした環境では枠ごと消えてしまうため使わない。
 */

export const UI_ICON_TEXTURE = "ui.craftpix.icons";

/** Icons.png は16x16の6列並び。上6段が単色のUI用ピクトグラム。 */
export const UI_ICON = {
  skull: 0,
  sword: 1,
  chest: 2,
  pouch: 3,
  key: 4,
  heart: 5,
  coins: 6,
  star: 7,
  arch: 8,
  speech: 9,
  gem: 10,
  shield: 18,
  trophy: 19,
  info: 24,
  question: 25,
  arrowUp: 26,
  arrowDown: 27,
  leaf: 34,
  apple: 35,
} as const;

export interface WindowOptions {
  variant?: UiFrameVariant;
  fill?: number;
  fillAlpha?: number;
  /** 四隅の飾り鋲。小さな枠では省く。 */
  rivets?: boolean;
  /** 背面に落とす影の距離。0で影なし。 */
  shadow?: number;
}

export interface GaugeOptions {
  value: number;
  max: number;
  fill: number;
  light: number;
}

export interface SkinButtonOptions {
  label: string;
  key?: string;
  disabled?: boolean;
  /** 押しっぱなしに見せる。タブの選択中などに使う。 */
  active?: boolean;
  onActivate?: () => void;
}

/** 矩形の外周に帯を1本ずつ積む。 */
export function drawFrame(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  bands: readonly UiFrameBand[],
): void {
  for (const band of bands) {
    const left = x + band.inset;
    const top = y + band.inset;
    const bandWidth = width - band.inset * 2;
    const bandHeight = height - band.inset * 2;
    if (bandWidth <= 0 || bandHeight <= 0) return;
    graphics.fillStyle(band.top, 1).fillRect(left, top, bandWidth, 1);
    graphics.fillStyle(band.bottom, 1).fillRect(left, top + bandHeight - 1, bandWidth, 1);
    graphics.fillStyle(band.left, 1).fillRect(left, top, 1, bandHeight);
    graphics.fillStyle(band.right, 1).fillRect(left + bandWidth - 1, top, 1, bandHeight);
  }
}

function drawRivets(graphics: Phaser.GameObjects.Graphics, x: number, y: number, width: number, height: number): void {
  const corners: Array<[number, number]> = [
    [x + 2, y + 2],
    [x + width - 4, y + 2],
    [x + 2, y + height - 4],
    [x + width - 4, y + height - 4],
  ];
  for (const [cx, cy] of corners) {
    graphics.fillStyle(UI_COLORS.outline, 1).fillRect(cx, cy, 2, 2);
    graphics.fillStyle(UI_COLORS.rivet, 1).fillRect(cx, cy, 2, 1).fillRect(cx, cy, 1, 2);
  }
}

/** 左上基準のウインドウ。中身は frameBorderWidth 分だけ内側に置く。 */
export function addWindow(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  options: WindowOptions = {},
): Phaser.GameObjects.Graphics {
  const variant = options.variant ?? "window";
  const bands = frameBands(variant);
  const border = frameBorderWidth(variant);
  const safeWidth = Math.max(minimumFrameSize(variant), Math.round(width));
  const safeHeight = Math.max(minimumFrameSize(variant), Math.round(height));
  const graphics = scene.add.graphics();
  const shadow = options.shadow ?? 0;
  if (shadow > 0) graphics.fillStyle(UI_COLORS.shadow, 0.45).fillRect(x + shadow, y + shadow, safeWidth, safeHeight);
  const fill = options.fill ?? (variant === "window" ? UI_COLORS.windowFill : UI_COLORS.windowFillDeep);
  graphics.fillStyle(fill, options.fillAlpha ?? 1).fillRect(x + border, y + border, safeWidth - border * 2, safeHeight - border * 2);
  drawFrame(graphics, x, y, safeWidth, safeHeight, bands);
  if (options.rivets ?? variant === "window") drawRivets(graphics, x, y, safeWidth, safeHeight);
  return graphics;
}

/** 中央に菱形の飾りを置いた仕切り線。 */
export function addDivider(scene: Phaser.Scene, x: number, y: number, width: number, ornament = true): Phaser.GameObjects.Graphics {
  const graphics = scene.add.graphics();
  graphics.fillStyle(UI_COLORS.frameEdge, 0.9).fillRect(x, y, width, 1);
  graphics.fillStyle(UI_COLORS.sunkenBottom, 0.75).fillRect(x, y + 1, width, 1);
  if (!ornament) return graphics;
  const centerX = Math.round(x + width / 2);
  graphics.fillStyle(UI_COLORS.outline, 1).fillRect(centerX - 3, y - 2, 7, 5);
  graphics.fillStyle(UI_COLORS.rivet, 1);
  graphics.fillRect(centerX, y - 2, 1, 1).fillRect(centerX - 1, y - 1, 3, 1).fillRect(centerX - 2, y, 5, 1).fillRect(centerX - 1, y + 1, 3, 1).fillRect(centerX, y + 2, 1, 1);
  return graphics;
}

/** 見出し語のあとに罫線を伸ばす区切り。 */
export function addSectionLabel(scene: Phaser.Scene, x: number, y: number, width: number, label: string): Phaser.GameObjects.Text {
  const text = scene.add.text(x, y, label, { fontSize: "10px", color: UI_INK.accent });
  const ruleX = x + Math.ceil(text.width) + 6;
  const graphics = scene.add.graphics();
  graphics.fillStyle(UI_COLORS.frameEdge, 0.8).fillRect(ruleX, y + 6, Math.max(0, x + width - ruleX), 1);
  graphics.fillStyle(UI_COLORS.sunkenBottom, 0.6).fillRect(ruleX, y + 7, Math.max(0, x + width - ruleX), 1);
  return text;
}

/** 沈んだ軌道に残量を塗るゲージ。 */
export function addGauge(scene: Phaser.Scene, x: number, y: number, width: number, height: number, options: GaugeOptions): Phaser.GameObjects.Graphics {
  const graphics = scene.add.graphics();
  graphics.fillStyle(UI_COLORS.gaugeTrack, 1).fillRect(x, y, width, height);
  const filled = gaugeFillWidth(options.value, options.max, width - 2);
  if (filled > 0) {
    graphics.fillStyle(options.fill, 1).fillRect(x + 1, y + 1, filled, height - 2);
    graphics.fillStyle(options.light, 0.9).fillRect(x + 1, y + 1, filled, 1);
  }
  drawFrame(graphics, x, y, width, height, frameBands("gauge"));
  return graphics;
}

/** 選択中の行を照らす帯。左端に明るい縁を立てる。 */
export function addSelectionBar(scene: Phaser.Scene, x: number, y: number, width: number, height: number): Phaser.GameObjects.Graphics {
  const graphics = scene.add.graphics();
  graphics.fillStyle(UI_COLORS.selection, 1).fillRect(x, y, width, height);
  graphics.fillStyle(UI_COLORS.selectionLight, 0.85).fillRect(x, y, width, 1);
  graphics.fillStyle(UI_COLORS.outline, 0.35).fillRect(x, y + height - 1, width, 1);
  graphics.fillStyle(UI_COLORS.rivet, 1).fillRect(x, y, 2, height);
  return graphics;
}

/**
 * 単色ピクトグラムを塗りつぶし色で置く。影を1px下にずらして輪郭を作る。
 * アイコン素材が無い環境では何も描かず、呼び出し側の文字だけが残る。
 */
export function addUiIcon(scene: Phaser.Scene, x: number, y: number, frame: number, color: number): Phaser.GameObjects.Image | undefined {
  if (!scene.textures.exists(UI_ICON_TEXTURE)) return undefined;
  scene.add.image(x + 1, y + 1, UI_ICON_TEXTURE, frame).setOrigin(0, 0.5).setTintFill(UI_COLORS.outline);
  return scene.add.image(x, y, UI_ICON_TEXTURE, frame).setOrigin(0, 0.5).setTintFill(color);
}

/** 立体的なボタン。ホバーと押下で枠のベベルごと描き直す。 */
export function addSkinButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  options: SkinButtonOptions,
): Phaser.GameObjects.Rectangle {
  const graphics = scene.add.graphics();
  const label = scene.add.text(x + BUTTON_BORDER_WIDTH + 5, y + Math.round((height - 12) / 2), options.label, { fontSize: "10px", color: UI_INK.body });
  const keyLabel = options.key
    ? scene.add.text(x + width - BUTTON_BORDER_WIDTH - 4, y + Math.round((height - 12) / 2), options.key, { fontSize: "10px", color: UI_INK.dim }).setOrigin(1, 0)
    : undefined;
  const restingState: ButtonState = options.disabled ? "disabled" : options.active ? "down" : "idle";

  const paint = (state: ButtonState): void => {
    const palette = BUTTON_PALETTE[state];
    const inner = BUTTON_BORDER_WIDTH;
    graphics.clear();
    graphics.fillStyle(palette.face, 1).fillRect(x + inner, y + inner, width - inner * 2, height - inner * 2);
    graphics.fillStyle(palette.gloss, 0.7).fillRect(x + inner, y + inner, width - inner * 2, 1);
    drawFrame(graphics, x, y, width, height, buttonFrameBands(state));
    label.setColor(palette.ink);
    keyLabel?.setColor(palette.keyInk);
  };
  paint(restingState);

  const hit = scene.add.rectangle(x, y, width, height, 0xffffff, 0.001).setOrigin(0);
  if (!options.disabled) {
    hit.setInteractive({ useHandCursor: true })
      .on("pointerover", () => paint("hover"))
      .on("pointerout", () => paint(restingState))
      .on("pointerup", () => paint("hover"))
      .on("pointerdown", () => {
        paint("down");
        options.onActivate?.();
      });
  }
  return hit;
}

/**
 * 演出は自分の tween を自分で畳む。
 *
 * `render()` は毎行動で表示物を破棄するため、走ったままの tween が
 * 破棄済みの対象へ書き込まないよう、破棄イベントで確実に止める。
 */
function selfCleaningTween(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.GameObject,
  config: Phaser.Types.Tweens.TweenBuilderConfig,
): void {
  const tween = scene.tweens.add(config);
  target.once(Phaser.GameObjects.Events.DESTROY, () => tween.remove());
}

/**
 * 打撃や増減をその場で読ませる、浮かんで消える数値。
 *
 * 生成した本人が後片付けまで持つ。`render()` がシーンごと作り直しても
 * 破棄済みの対象へ触らないよう、完了時に生存を確かめてから消す。
 */
export function addFloatingValue(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  color: string,
): Phaser.GameObjects.Text {
  const text = scene.add.text(x, y, label, {
    fontSize: "11px",
    color,
    stroke: UI_INK.outline,
    strokeThickness: 3,
  }).setOrigin(0.5, 1);
  selfCleaningTween(scene, text, {
    targets: text,
    y: y - 13,
    duration: 620,
    ease: "Quad.Out",
    alpha: { from: 1, to: 0, delay: 240, duration: 380 },
    onComplete: () => { if (text.scene) text.destroy(); },
  } as Phaser.Types.Tweens.TweenBuilderConfig);
  return text;
}

/** 主人公が傷ついたことを画面の縁で伝える。中央の絵は覆わない。 */
export function addEdgeFlash(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number,
): Phaser.GameObjects.Graphics {
  const graphics = scene.add.graphics();
  const bands = [0.42, 0.26, 0.14, 0.07];
  bands.forEach((alpha, index) => {
    const inset = index * 2;
    graphics.fillStyle(color, alpha);
    graphics.fillRect(x + inset, y + inset, width - inset * 2, 2);
    graphics.fillRect(x + inset, y + height - inset - 2, width - inset * 2, 2);
    graphics.fillRect(x + inset, y + inset, 2, height - inset * 2);
    graphics.fillRect(x + width - inset - 2, y + inset, 2, height - inset * 2);
  });
  selfCleaningTween(scene, graphics, {
    targets: graphics,
    alpha: 0,
    duration: 340,
    ease: "Quad.Out",
    onComplete: () => { if (graphics.scene) graphics.destroy(); },
  } as Phaser.Types.Tweens.TweenBuilderConfig);
  return graphics;
}

/** 敵を退けた地点で弾ける光。倒れた本体は既に消えているので、跡だけを見せる。 */
export function addDefeatBurst(
  scene: Phaser.Scene,
  x: number,
  y: number,
  tile: number,
): Phaser.GameObjects.Graphics {
  const graphics = scene.add.graphics();
  const half = Math.max(3, Math.round(tile * 0.34));
  graphics.fillStyle(UI_COLORS.rivet, 0.95);
  graphics.fillRect(-half, -1, half * 2, 2).fillRect(-1, -half, 2, half * 2);
  graphics.fillStyle(0xffffff, 0.85).fillRect(-2, -2, 4, 4);
  graphics.setPosition(x, y);
  selfCleaningTween(scene, graphics, {
    targets: graphics,
    scaleX: 1.9,
    scaleY: 1.9,
    alpha: 0,
    duration: 280,
    ease: "Quad.Out",
    onComplete: () => { if (graphics.scene) graphics.destroy(); },
  } as Phaser.Types.Tweens.TweenBuilderConfig);
  return graphics;
}

/**
 * はみ出す行を決められた枠に収める。ログのように高さが決まっている場所で使う。
 *
 * 折り返しを1行で打ち切ったうえで、描画面そのものを行の寸法へ固定する。
 * 想定外に背の高い文字が来ても、隣の行や罫線を押し出さない。
 */
export function addSingleLineText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number,
  label: string,
  style: Phaser.Types.GameObjects.Text.TextStyle,
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, label, {
    ...style,
    wordWrap: { width: maxWidth, useAdvancedWrap: true },
    maxLines: 1,
  }).setFixedSize(maxWidth, maxHeight);
}
