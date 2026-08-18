const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}

function png(width, height, pixel) {
  const row = width * 4 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = y * row + 1 + x * 4;
      const value = pixel(x, y);
      raw[offset] = value;
      raw[offset + 1] = value;
      raw[offset + 2] = value;
      raw[offset + 3] = 255;
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const output = path.join(__dirname, "..", "public", "assets", "map-tiles");
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "home-floor.png"), png(16, 16, () => 124));
fs.writeFileSync(path.join(output, "dungeon-floor.png"), png(16, 16, () => 85));
for (const name of ["home-wall.png", "dungeon-wall.png"]) {
  fs.writeFileSync(path.join(output, name), png(64, 64, (x, y) => ((x >> 4) + (y >> 4)) % 2 ? 51 : 170));
}
