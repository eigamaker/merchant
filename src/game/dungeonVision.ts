import type { DungeonMap, DungeonRun, Vec } from "./types";

/** 松明の届く距離。これより外は闇に沈み、敵の姿も見えない。 */
export const VISION_RADIUS = 6;

/** 一度でも灯りが届いた場所は覚えている。地形だけが薄明かりで残り、そこにいる者は見えない。 */
const SEEN = "1";
const UNSEEN = "0";

/** 記憶した地形の暗さ。灯りの縁は二段で落として、円の切り口を和らげる。 */
const REMEMBERED_SHADE = 0.66;
const EDGE_SHADE = 0.34;
const NEAR_EDGE_SHADE = 0.16;

export function inVision(from: Vec, target: Vec, radius: number = VISION_RADIUS): boolean {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  return dx * dx + dy * dy <= radius * radius;
}

function blocksSight(map: DungeonMap, pos: Vec): boolean {
  return pos.x < 0 || pos.y < 0 || pos.x >= map.width || pos.y >= map.height || map.tiles[pos.y]?.[pos.x] !== 0;
}

/** Bresenham line of sight. The target wall is visible, but walls before it hide everything beyond. */
export function hasDungeonLineOfSight(map: DungeonMap, from: Vec, target: Vec): boolean {
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(target.x - from.x);
  const dy = Math.abs(target.y - from.y);
  const sx = from.x < target.x ? 1 : -1;
  const sy = from.y < target.y ? 1 : -1;
  let error = dx - dy;
  while (x !== target.x || y !== target.y) {
    const previous = { x, y };
    const twice = error * 2;
    if (twice > -dy) { error -= dy; x += sx; }
    if (twice < dx) { error += dx; y += sy; }
    const current = { x, y };
    if (current.x !== previous.x && current.y !== previous.y
      && blocksSight(map, { x: current.x, y: previous.y })
      && blocksSight(map, { x: previous.x, y: current.y })) return false;
    if (current.x === target.x && current.y === target.y) return true;
    if (blocksSight(map, current)) return false;
  }
  return true;
}

export function hasDungeonVision(map: DungeonMap, from: Vec, target: Vec, radius: number = VISION_RADIUS): boolean {
  return inVision(from, target, radius) && hasDungeonLineOfSight(map, from, target);
}

function memoryOf(map: DungeonMap): string {
  const size = Math.max(0, map.width * map.height);
  const current = map.explored;
  return current && current.length === size ? current : UNSEEN.repeat(size);
}

export function isExplored(map: DungeonMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  return map.explored?.[y * map.width + x] === SEEN;
}

/** 主人公の周りを「見た」ことにする。記憶は階ごとに残り、階層の記録にも一緒に運ばれる。 */
export function markExplored(run: DungeonRun, radius: number = VISION_RADIUS): void {
  const map = run.map;
  const cells = memoryOf(map).split("");
  const minX = Math.max(0, run.player.x - radius);
  const maxX = Math.min(map.width - 1, run.player.x + radius);
  const minY = Math.max(0, run.player.y - radius);
  const maxY = Math.min(map.height - 1, run.player.y + radius);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (hasDungeonVision(map, run.player, { x, y }, radius)) cells[y * map.width + x] = SEEN;
    }
  }
  map.explored = cells.join("");
}

/**
 * その升にかぶせる闇の濃さ。0 は素通し、1 は完全な闇。
 * 灯りの内側は素通し、縁は二段で翳り、外は記憶の有無で分かれる。
 */
export function fogOpacity(from: Vec, target: Vec, explored: boolean, radius: number = VISION_RADIUS): number {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const distance = dx * dx + dy * dy;
  if (distance <= (radius - 2) * (radius - 2)) return 0;
  if (distance <= (radius - 1) * (radius - 1)) return NEAR_EDGE_SHADE;
  if (distance <= radius * radius) return EDGE_SHADE;
  return explored ? REMEMBERED_SHADE : 1;
}

export function dungeonFogOpacity(map: DungeonMap, from: Vec, target: Vec, explored: boolean, radius: number = VISION_RADIUS): number {
  if (!hasDungeonVision(map, from, target, radius)) return explored ? REMEMBERED_SHADE : 1;
  return fogOpacity(from, target, explored, radius);
}
