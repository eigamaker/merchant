/**
 * 経済の作り直しで足した品の32×32アイテム画像を生成する。
 *
 * 16×16で描いた図を2倍に拡大する。既存のアイテム画像と同じ契約
 * （32×32・RGBA・透明な余白あり）を満たすが、絵柄は差し替え前提の暫定である。
 * 差し替え手順は docs/ASSET_PIPELINE.md を参照。
 *
 * 品ごとに絵を起こすのではなく、**形の型（葉・鉱石・宝石・薬瓶）に色を差す**。
 * 暫定画像に手間をかけない代わりに、種類の違いだけは一目で分かるようにしてある。
 */
const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");

const OUTLINE = "#241a14";

/** 形の型。o=輪郭 A=地 B=陰 C=光。 */
const SHAPES = {
  leaf: [
    "................",
    ".......o........",
    "......oAo.......",
    ".....oACAo......",
    "....oAACAAo.....",
    "....oAACAAo.....",
    ".....oACABo.....",
    "......oAABo.....",
    ".......ooo......",
    ".......oB.......",
    "......oAAo......",
    ".....oACAAo.....",
    ".....oAABBo.....",
    "......oBBo......",
    ".......oo.......",
    "................",
  ],
  ore: [
    "................",
    "................",
    ".....oooo.......",
    "....oACCAo......",
    "...oACCCCAo.....",
    "..oAACCCAAo.....",
    "..oAAACAAABo....",
    "..oAAAAAABBo....",
    "..oAAAABBBBo....",
    "...oAABBBBo.....",
    "....oBBBBo......",
    ".....oooo.......",
    "................",
    "................",
    "................",
    "................",
  ],
  gem: [
    "................",
    "................",
    "....oooooo......",
    "...oCCCCCCo.....",
    "..oACCCCCCAo....",
    "..oAACCCCAAo....",
    "...oAACCAABo....",
    "....oAACAABo....",
    ".....oAAAABo....",
    "......oAABo.....",
    ".......oABo.....",
    "........oo......",
    "................",
    "................",
    "................",
    "................",
  ],
  flask: [
    "................",
    ".......oo.......",
    ".......oCo......",
    ".......oCo......",
    "......oCCo......",
    ".....oACCAo.....",
    "....oACCCCAo....",
    "....oACCCCAo....",
    "....oABBBBAo....",
    "....oABBBBAo....",
    "....oABBBBAo....",
    "....oABBBBAo....",
    "....oAABBAAo....",
    ".....oooooo.....",
    "................",
    "................",
  ],
};

/** 品ごとの型と色。 */
const ITEMS = {
  "herb": { shape: "leaf", A: "#4f8a45", B: "#356030", C: "#7fbf6a" },
  "iron-ore": { shape: "ore", A: "#7d7a72", B: "#4f4d47", C: "#a8a49a" },
  "silver-ore": { shape: "ore", A: "#b3bcc4", B: "#7b848d", C: "#e2e8ee" },
  "gold-ore": { shape: "ore", A: "#c9a227", B: "#8c6f16", C: "#f2d76b" },
  "mithril": { shape: "ore", A: "#8fc7d6", B: "#5a8e9d", C: "#cdeef7" },
  "orichalcum": { shape: "ore", A: "#c2662f", B: "#8a4118", C: "#f0a267" },
  "diamond": { shape: "gem", A: "#9fd7e8", B: "#6ba4b8", C: "#f0fbff" },
  "mana-stone": { shape: "gem", A: "#8a6bc4", B: "#5d448e", C: "#c7aef0" },
  "field-flask": { shape: "flask", A: "#8a6b45", B: "#c4645e", C: "#e8b9b5" },
  "elixir": { shape: "flask", A: "#5f4527", B: "#a02f3c", C: "#e07b84" },
  "grand-elixir": { shape: "flask", A: "#6d5a2a", B: "#c9a227", C: "#f7ecb0" },
};

const SCALE = 2;

function rgba(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255];
}

function render(rows, palette) {
  const size = 16 * SCALE;
  const png = new PNG({ width: size, height: size });
  png.data.fill(0);
  rows.forEach((row, y) => {
    [...row].forEach((symbol, x) => {
      const hex = palette[symbol];
      if (!hex) return;
      const [r, g, b, a] = rgba(hex);
      for (let dy = 0; dy < SCALE; dy += 1) for (let dx = 0; dx < SCALE; dx += 1) {
        const index = ((y * SCALE + dy) * size + (x * SCALE + dx)) * 4;
        png.data[index] = r;
        png.data[index + 1] = g;
        png.data[index + 2] = b;
        png.data[index + 3] = a;
      }
    });
  });
  return PNG.sync.write(png);
}

const targets = ["public/assets/items", "assets-src/items/generated-originals"];
for (const directory of targets) fs.mkdirSync(path.resolve(directory), { recursive: true });

for (const [shapeId, rows] of Object.entries(SHAPES)) {
  if (rows.length !== 16) throw new Error(`${shapeId}: ${rows.length} rows, expected 16`);
  for (const row of rows) if (row.length !== 16) throw new Error(`${shapeId}: row width ${row.length}, expected 16`);
}

for (const [id, spec] of Object.entries(ITEMS)) {
  const rows = SHAPES[spec.shape];
  if (!rows) throw new Error(`${id}: unknown shape ${spec.shape}`);
  const bytes = render(rows, { o: OUTLINE, A: spec.A, B: spec.B, C: spec.C });
  for (const directory of targets) fs.writeFileSync(path.resolve(directory, `${id}.png`), bytes);
  console.log(`wrote ${id}.png (32x32, ${spec.shape})`);
}
