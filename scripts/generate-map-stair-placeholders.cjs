const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");

const output = path.join(__dirname, "..", "assets-src", "map-tiles", "sheets");

function setPixel(image, x, y, [red, green, blue, alpha = 255]) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const offset = (y * image.width + x) * 4;
  image.data[offset] = red;
  image.data[offset + 1] = green;
  image.data[offset + 2] = blue;
  image.data[offset + 3] = alpha;
}

function horizontal(image, y, from, to, color) {
  for (let x = from; x <= to; x += 1) setPixel(image, x, y, color);
}

function stairs(direction) {
  const image = new PNG({ width: 16, height: 16, colorType: 6 });
  image.data.fill(0);
  const outline = [28, 32, 43];
  const tread = [180, 183, 184];
  const edge = [110, 117, 125];
  for (let step = 0; step < 6; step += 1) {
    const y = 3 + step * 2;
    const left = 6 - step;
    const right = 9 + step;
    horizontal(image, y, left, right, outline);
    horizontal(image, y, left + 1, right - 1, tread);
    horizontal(image, y + 1, left, right, outline);
    horizontal(image, y + 1, left + 1, right - 1, edge);
  }
  const arrow = direction === "up" ? [95, 226, 176] : [245, 183, 67];
  if (direction === "up") {
    horizontal(image, 2, 7, 8, arrow);
    horizontal(image, 3, 6, 9, arrow);
    horizontal(image, 4, 5, 10, arrow);
    horizontal(image, 5, 7, 8, arrow);
    horizontal(image, 6, 7, 8, arrow);
  } else {
    horizontal(image, 9, 7, 8, arrow);
    horizontal(image, 10, 7, 8, arrow);
    horizontal(image, 11, 5, 10, arrow);
    horizontal(image, 12, 6, 9, arrow);
    horizontal(image, 13, 7, 8, arrow);
  }
  return PNG.sync.write(image, { colorType: 6, inputColorType: 6, bitDepth: 8 });
}

fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "dungeon-stairs-up.png"), stairs("up"));
fs.writeFileSync(path.join(output, "dungeon-stairs-down.png"), stairs("down"));
console.log("Generated 16px dungeon stair placeholder sources.");
