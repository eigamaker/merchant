import { describe, expect, it } from "vitest";
import { VISION_RADIUS, fogOpacity, hasDungeonVision, inVision, isExplored, markExplored } from "./dungeonVision";
import type { DungeonMap, DungeonRun } from "./types";

const testMap = (width = 20, height = 16): DungeonMap => ({
  width,
  height,
  tiles: Array.from({ length: height }, () => Array.from({ length: width }, () => 0)),
  stairsUp: { x: 1, y: 1 },
});

const testRun = (map: DungeonMap, player = { x: 10, y: 8 }): DungeonRun => ({
  seed: 1,
  themeScheduleVersion: 1,
  themePoolIds: ["cave"],
  startedDay: 1,
  floor: 1,
  map,
  player,
  enemies: [],
  items: [],
  chests: [],
  bodies: [],
  adventurers: [],
  shoveCooldown: 0,
  highestFloor: 1,
  turn: 0,
  timeUnits: 0,
  settledTimeBands: 0,
  floorStates: {},
});

describe("dungeonVision", () => {
  it("灯りは半径ぶん届き、その外には届かない", () => {
    const from = { x: 10, y: 8 };
    expect(inVision(from, { x: 10 + VISION_RADIUS, y: 8 })).toBe(true);
    expect(inVision(from, { x: 10, y: 8 - VISION_RADIUS })).toBe(true);
    expect(inVision(from, { x: 10 + VISION_RADIUS + 1, y: 8 })).toBe(false);
    expect(inVision(from, { x: 15, y: 12 })).toBe(false);
  });

  it("歩いた場所の記憶は積み上がり、消えない", () => {
    const map = testMap();
    const run = testRun(map, { x: 3, y: 3 });
    markExplored(run);
    expect(isExplored(map, 3, 3)).toBe(true);
    expect(isExplored(map, 16, 12)).toBe(false);
    const seenFirst = (map.explored ?? "").split("").filter((cell) => cell === "1").length;

    run.player = { x: 16, y: 12 };
    markExplored(run);
    expect(isExplored(map, 16, 12)).toBe(true);
    // 離れても最初に見た場所は覚えている。
    expect(isExplored(map, 3, 3)).toBe(true);
    const seenAfter = (map.explored ?? "").split("").filter((cell) => cell === "1").length;
    expect(seenAfter).toBeGreaterThan(seenFirst);
  });

  it("記憶は盤面の升数と一致し、端でも溢れない", () => {
    const map = testMap(12, 9);
    const run = testRun(map, { x: 0, y: 0 });
    markExplored(run);
    expect(map.explored).toHaveLength(12 * 9);
    expect(isExplored(map, -1, 0)).toBe(false);
    expect(isExplored(map, 12, 0)).toBe(false);
  });

  it("闇の濃さは足元から外へ向かって濃くなる", () => {
    const from = { x: 10, y: 8 };
    expect(fogOpacity(from, { x: 10, y: 8 }, true)).toBe(0);
    const edge = fogOpacity(from, { x: 10 + VISION_RADIUS, y: 8 }, true);
    const nearEdge = fogOpacity(from, { x: 10 + VISION_RADIUS - 1, y: 8 }, true);
    expect(nearEdge).toBeGreaterThan(0);
    expect(edge).toBeGreaterThan(nearEdge);
    // 見たことのある場所は薄明かりで残り、知らない場所は完全な闇。
    expect(fogOpacity(from, { x: 19, y: 15 }, true)).toBeLessThan(1);
    expect(fogOpacity(from, { x: 19, y: 15 }, false)).toBe(1);
  });

  it("壁自体は見えるが、その背後は見えず探索済みにもならない", () => {
    const map = testMap(12, 8);
    map.tiles[3]![5] = 1;
    const from = { x: 3, y: 3 };
    expect(hasDungeonVision(map, from, { x: 5, y: 3 })).toBe(true);
    expect(hasDungeonVision(map, from, { x: 6, y: 3 })).toBe(false);
    const run = testRun(map, from);
    markExplored(run);
    expect(isExplored(map, 5, 3)).toBe(true);
    expect(isExplored(map, 6, 3)).toBe(false);
  });

  it("閉じた角を斜めに透視しない", () => {
    const map = testMap(8, 8);
    map.tiles[2]![3] = 1;
    map.tiles[3]![2] = 1;
    expect(hasDungeonVision(map, { x: 2, y: 2 }, { x: 3, y: 3 })).toBe(false);
    map.tiles[2]![3] = 0;
    expect(hasDungeonVision(map, { x: 2, y: 2 }, { x: 3, y: 3 })).toBe(true);
  });
});
