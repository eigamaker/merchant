/**
 * 道具袋4種の32×32アイテム画像を生成する。
 *
 * 16×16で描いた図を2倍に拡大する。既存のアイテム画像と同じ契約
 * （32×32・RGBA・透明な余白あり）を満たすが、絵柄は差し替え前提の暫定である。
 * 差し替え手順は docs/ASSET_PIPELINE.md を参照。
 */
const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");

const OUTLINE = "#241a14";

const SPRITES = {
  "cloth-wrap": {
    palette: { o: OUTLINE, K: "#b9cde4", C: "#6f8fb5", d: "#9ab3d0" },
    rows: [
      "................",
      ".......oo.......",
      "......oKKo......",
      ".....oK..Ko.....",
      "....oKo..oKo....",
      "....oKKooKKo....",
      ".....oKKKKo.....",
      "...oooooooooo...",
      "..oCCCCCCCCCCo..",
      ".oCCdCCCCdCCCCo.",
      ".oCCCCddCCCCCCo.",
      ".oCdCCCCCCdCCCo.",
      ".oCCCCddCCCCCCo.",
      "..oCCCCCCCCCCo..",
      "...oCCCCCCCCo...",
      "....oooooooo....",
    ],
  },
  "shoulder-sack": {
    palette: { o: OUTLINE, S: "#8a6b45", B: "#a8834f", h: "#7d5f3c", R: "#5f4527" },
    rows: [
      "................",
      ".....oooo.......",
      "....oSSSSo......",
      "....oSSSSo......",
      "...ooRRRRoo.....",
      "..oBBBBBBBBo....",
      ".oBBBBBBBBBBo...",
      ".oBBhBBBBBhBo...",
      ".oBBBBBBBBBBo...",
      "oBBBBBhhBBBBBo..",
      "oBBBBBBBBBBBBo..",
      "oBBhBBBBBBBhBo..",
      "oBBBBBBBBBBBBo..",
      ".oBBBBBBBBBBo...",
      "..oBBBBBBBBo....",
      "...oooooooo.....",
    ],
  },
  "pedlar-case": {
    palette: { o: OUTLINE, W: "#9b6f42", M: "#c9b071", L: "#d8c88a" },
    rows: [
      "................",
      "................",
      "..oooooooooooo..",
      "..oMWWWWWWWWMo..",
      "..oWWWWWWWWWWo..",
      "..oWWWWWWWWWWo..",
      "..oooooooooooo..",
      "..oMWWWWWWWWMo..",
      "..oWWWWLLWWWWo..",
      "..oWWWWLLWWWWo..",
      "..oWWWWWWWWWWo..",
      "..oWWWWWWWWWWo..",
      "..oMWWWWWWWWMo..",
      "..oooooooooooo..",
      "................",
      "................",
    ],
  },
  "caravan-pack": {
    palette: { o: OUTLINE, P: "#7f6a52", R: "#4c3a28", B: "#b9a27d" },
    rows: [
      "................",
      "....oooooooo....",
      "...oPPPPPPPPo...",
      "..oPPPPPPPPPPo..",
      ".oPPRPPPPPPRPPo.",
      ".oPPRPPPPPPRPPo.",
      ".oPPRPPPPPPRPPo.",
      ".oPPPPPPPPPPPPo.",
      ".oRRRRRRRRRRRRo.",
      ".oBBBBBBBBBBBBo.",
      ".oPPRPPPPPPRPPo.",
      ".oPPRPPPPPPRPPo.",
      "..oPPRPPPPRPPo..",
      "..oPPPPPPPPPPo..",
      "...oooooooooo...",
      "................",
    ],
  },
};

const SCALE = 2;

function rgba(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255];
}

function render(sprite) {
  const size = 16 * SCALE;
  const png = new PNG({ width: size, height: size });
  png.data.fill(0);
  sprite.rows.forEach((row, y) => {
    [...row].forEach((symbol, x) => {
      const hex = sprite.palette[symbol];
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
for (const [id, sprite] of Object.entries(SPRITES)) {
  for (const row of sprite.rows) {
    if (row.length !== 16) throw new Error(`${id}: row width ${row.length}, expected 16`);
  }
  if (sprite.rows.length !== 16) throw new Error(`${id}: ${sprite.rows.length} rows, expected 16`);
  const bytes = render(sprite);
  for (const directory of targets) fs.writeFileSync(path.resolve(directory, `${id}.png`), bytes);
  console.log(`wrote ${id}.png (32x32)`);
}
