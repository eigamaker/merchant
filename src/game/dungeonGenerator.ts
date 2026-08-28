import { isWalkableCell, reachableCells } from "./dungeonRules";
import { DUNGEON_ROOM_TEMPLATES, rotateTemplate, templateCells, templateCenter, type DungeonRoomTemplate, type RoomTag } from "./dungeonTemplates";
import { deriveDungeonSeed, dungeonThemeEnemyRoster } from "./dungeonThemes";
import { Rng } from "./rng";
import type { DungeonGeneratedRoom, DungeonMap, Vec } from "./types";

export const DUNGEON_GENERATOR_VERSION = 1 as const;
export const DUNGEON_WIDTH = 48;
export const DUNGEON_HEIGHT = 36;
const FLOOR = 0;
const WALL = 1;

interface Region { x: number; y: number; width: number; height: number }
interface Edge { a: number; b: number; loop?: boolean }
interface GraphLayout { edges: Edge[]; mainPath: number[]; branchLeaves: Set<number> }

export interface GeneratedDungeonFloor {
  map: DungeonMap;
  rooms: DungeonGeneratedRoom[];
  placementRegions: Record<"entrance" | "exit" | "combat" | "loot" | "treasure" | "tomb" | "normal", Vec[]>;
  usedFallback: boolean;
}

function blankTiles(): number[][] {
  return Array.from({ length: DUNGEON_HEIGHT }, () => Array<number>(DUNGEON_WIDTH).fill(WALL));
}

function key(pos: Vec): string { return `${pos.x},${pos.y}`; }
function manhattan(a: Vec, b: Vec): number { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

function splitRegions(rng: Rng, target: number): Region[] {
  const regions: Region[] = [{ x: 1, y: 1, width: DUNGEON_WIDTH - 2, height: DUNGEON_HEIGHT - 2 }];
  while (regions.length < target) {
    const candidates = regions.map((region, index) => ({ region, index }))
      .filter(({ region }) => region.width >= 22 || region.height >= 22)
      .sort((a, b) => b.region.width * b.region.height - a.region.width * a.region.height);
    const selected = candidates[0];
    if (!selected) break;
    const { region, index } = selected;
    const vertical = region.width >= 22 && (region.height < 22 || region.width / region.height >= 1.15 || rng.next() < 0.5);
    if (vertical) {
      const cut = rng.int(11, region.width - 11);
      regions.splice(index, 1,
        { x: region.x, y: region.y, width: cut, height: region.height },
        { x: region.x + cut, y: region.y, width: region.width - cut, height: region.height });
    } else {
      const cut = rng.int(11, region.height - 11);
      regions.splice(index, 1,
        { x: region.x, y: region.y, width: region.width, height: cut },
        { x: region.x, y: region.y + cut, width: region.width, height: region.height - cut });
    }
  }
  return regions;
}

function graphLayout(rng: Rng, count: number): GraphLayout {
  const branchCount = Math.min(rng.int(2, 3), Math.max(1, count - 5));
  const mainLength = Math.max(5, count - branchCount);
  const edges: Edge[] = [];
  const mainPath = Array.from({ length: mainLength }, (_, index) => index);
  for (let index = 1; index < mainLength; index += 1) edges.push({ a: index - 1, b: index });
  const branchLeaves = new Set<number>();
  const attachments = Array.from({ length: Math.max(1, mainLength - 2) }, (_, index) => index + 1);
  for (let index = mainLength; index < count; index += 1) {
    const attachment = attachments[(index - mainLength) % attachments.length]!;
    edges.push({ a: attachment, b: index });
    branchLeaves.add(index);
  }
  if (rng.next() < 0.35 && branchLeaves.size > 0 && mainLength > 4) {
    const leaf = [...branchLeaves][rng.int(0, branchLeaves.size - 1)]!;
    const existing = edges.find((edge) => edge.a === leaf || edge.b === leaf)!;
    const attached = existing.a === leaf ? existing.b : existing.a;
    const candidates = mainPath.slice(1, -1).filter((room) => room !== attached && Math.abs(room - attached) >= 2);
    if (candidates.length) edges.push({ a: leaf, b: rng.pick(candidates), loop: true });
  }
  return { edges, mainPath, branchLeaves };
}

function roomDegree(edges: readonly Edge[], index: number): number {
  return edges.filter((edge) => edge.a === index || edge.b === index).length;
}

function desiredTag(index: number, graph: GraphLayout): DungeonGeneratedRoom["tag"] {
  if (index === graph.mainPath[0]) return "entrance";
  if (index === graph.mainPath[graph.mainPath.length - 1]) return "exit";
  if (graph.branchLeaves.has(index)) return index % 2 === 0 ? "treasure" : "tomb";
  return index % 3 === 0 ? "loot" : "combat";
}

function templateCandidates(region: Region, degree: number, tag: DungeonGeneratedRoom["tag"]): Array<{ template: DungeonRoomTemplate; rotation: 0 | 90 | 180 | 270 }> {
  const result: Array<{ template: DungeonRoomTemplate; rotation: 0 | 90 | 180 | 270 }> = [];
  const relevant = DUNGEON_ROOM_TEMPLATES.filter((template) => template.tags.includes(tag as RoomTag));
  const collect = (pool: readonly DungeonRoomTemplate[]) => {
    for (const base of pool) for (const rotation of base.allowedRotations) {
      const template = rotateTemplate(base, rotation);
      if (template.ports.length >= degree && template.width <= region.width - 2 && template.height <= region.height - 2) result.push({ template, rotation });
    }
  };
  collect(relevant);
  if (result.length === 0 && tag !== "entrance" && tag !== "exit") {
    collect(DUNGEON_ROOM_TEMPLATES.filter((template) => !template.tags.includes("entrance") && !template.tags.includes("exit")));
  }
  return result;
}

function weightedTemplate(rng: Rng, candidates: Array<{ template: DungeonRoomTemplate; rotation: 0 | 90 | 180 | 270 }>) {
  const weighted = candidates.flatMap((candidate) => Array(Math.max(1, Math.round(candidate.template.weight))).fill(candidate) as typeof candidates);
  return rng.pick(weighted);
}

function carveTemplate(tiles: number[][], template: DungeonRoomTemplate, x: number, y: number): Vec[] {
  const cells = templateCells(template).map((cell) => ({ x: x + cell.x, y: y + cell.y }));
  for (const cell of cells) tiles[cell.y]![cell.x] = FLOOR;
  return cells;
}

function carveWideCell(tiles: number[][], x: number, y: number, horizontal: boolean): void {
  if (x > 0 && y > 0 && x < DUNGEON_WIDTH - 1 && y < DUNGEON_HEIGHT - 1) tiles[y]![x] = FLOOR;
  const second = horizontal ? { x, y: y + 1 } : { x: x + 1, y };
  if (second.x > 0 && second.y > 0 && second.x < DUNGEON_WIDTH - 1 && second.y < DUNGEON_HEIGHT - 1) tiles[second.y]![second.x] = FLOOR;
}

function carveWideCorridor(tiles: number[][], from: Vec, to: Vec, horizontalFirst: boolean): void {
  let x = from.x;
  let y = from.y;
  const horizontal = () => { while (x !== to.x) { carveWideCell(tiles, x, y, true); x += Math.sign(to.x - x); } carveWideCell(tiles, x, y, true); };
  const vertical = () => { while (y !== to.y) { carveWideCell(tiles, x, y, false); y += Math.sign(to.y - y); } carveWideCell(tiles, x, y, false); };
  if (horizontalFirst) { horizontal(); vertical(); } else { vertical(); horizontal(); }
}

function graphDistances(edges: readonly Edge[], start: number, count: number): number[] {
  const result = Array<number>(count).fill(Number.POSITIVE_INFINITY);
  result[start] = 0;
  const queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    for (const edge of edges) {
      const next = edge.a === current ? edge.b : edge.b === current ? edge.a : undefined;
      if (next === undefined || Number.isFinite(result[next])) continue;
      result[next] = result[current]! + 1;
      queue.push(next);
    }
  }
  return result;
}

function placementRegions(rooms: readonly DungeonGeneratedRoom[]): GeneratedDungeonFloor["placementRegions"] {
  const result: GeneratedDungeonFloor["placementRegions"] = { entrance: [], exit: [], combat: [], loot: [], treasure: [], tomb: [], normal: [] };
  for (const room of rooms) {
    const cells = room.cells.filter((cell) => manhattan(cell, room.center) > 1);
    result[room.tag].push(...cells);
    if (room.tag !== "entrance" && room.tag !== "exit") result.normal.push(...cells);
  }
  return result;
}

function validFloor(map: DungeonMap, rooms: readonly DungeonGeneratedRoom[]): boolean {
  const reached = reachableCells(map, map.stairsUp);
  return rooms.length >= 8 && rooms.length <= 12 && map.procedural!.mainPathRoomIds.length >= 5
    && Boolean(map.stairsDown && reached.has(key(map.stairsDown)))
    && rooms.every((room) => room.cells.every((cell) => reached.has(key(cell))));
}

function tryGenerate(seed: number, floor: number, themeId: string, attempt: number): GeneratedDungeonFloor | undefined {
  const layoutSeed = deriveDungeonSeed(seed, "layout", floor);
  const rng = new Rng(deriveDungeonSeed(layoutSeed, "attempt", attempt));
  const target = rng.int(8, 12);
  const regions = splitRegions(rng, target);
  if (regions.length < 8) return undefined;
  const graph = graphLayout(rng, regions.length);
  const assignedRegions: Region[] = [];
  const nodesByNeed = Array.from({ length: regions.length }, (_, index) => index).sort((a, b) => roomDegree(graph.edges, b) - roomDegree(graph.edges, a));
  const regionsByArea = [...regions].sort((a, b) => b.width * b.height - a.width * a.height);
  nodesByNeed.forEach((node, index) => { assignedRegions[node] = regionsByArea[index]!; });
  const tiles = blankTiles();
  const distances = graphDistances(graph.edges.filter((edge) => !edge.loop), 0, regions.length);
  const rooms: DungeonGeneratedRoom[] = [];
  for (let index = 0; index < regions.length; index += 1) {
    const region = assignedRegions[index]!;
    const tag = desiredTag(index, graph);
    const candidates = templateCandidates(region, roomDegree(graph.edges, index), tag);
    if (candidates.length === 0) return undefined;
    const selected = weightedTemplate(rng, candidates);
    const maxX = region.x + region.width - selected.template.width - 1;
    const maxY = region.y + region.height - selected.template.height - 1;
    const x = rng.int(region.x + 1, maxX);
    const y = rng.int(region.y + 1, maxY);
    const cells = carveTemplate(tiles, selected.template, x, y);
    rooms.push({
      id: `room-${index}`,
      templateId: selected.template.id,
      rotation: selected.rotation,
      tag,
      x, y,
      width: selected.template.width,
      height: selected.template.height,
      center: templateCenter(selected.template, x, y),
      cells,
      graphDistance: distances[index]!,
      mainPath: graph.mainPath.includes(index),
      deadEnd: roomDegree(graph.edges.filter((edge) => !edge.loop), index) === 1,
    });
  }
  for (const edge of graph.edges) carveWideCorridor(tiles, rooms[edge.a]!.center, rooms[edge.b]!.center, rng.next() < 0.5);
  const entrance = rooms[graph.mainPath[0]!]!.center;
  const exit = rooms[graph.mainPath[graph.mainPath.length - 1]!]!.center;
  const map: DungeonMap = {
    width: DUNGEON_WIDTH,
    height: DUNGEON_HEIGHT,
    tileSize: 16,
    tiles,
    formatVersion: 2,
    heights: Array.from({ length: DUNGEON_HEIGHT }, () => Array<0 | 1 | 2>(DUNGEON_WIDTH).fill(0)),
    hardEdges: [],
    ledgeEdges: [],
    traversalLinks: [],
    stairsUp: { ...entrance },
    stairsDown: { ...exit },
    enemyRoster: [...dungeonThemeEnemyRoster(themeId, floor)],
    procedural: {
      generatorVersion: DUNGEON_GENERATOR_VERSION,
      themeId,
      layoutSeed,
      fallback: false,
      mainPathRoomIds: graph.mainPath.map((index) => rooms[index]!.id),
      rooms,
    },
  };
  if (!validFloor(map, rooms)) return undefined;
  return { map, rooms, placementRegions: placementRegions(rooms), usedFallback: false };
}

function fallbackDungeon(seed: number, floor: number, themeId: string): GeneratedDungeonFloor {
  const layoutSeed = deriveDungeonSeed(seed, "layout", floor);
  const rng = new Rng(layoutSeed);
  const tiles = blankTiles();
  const rooms: DungeonGeneratedRoom[] = [];
  let regions = splitRegions(rng, 10);
  if (regions.length < 8) {
    regions = [];
    for (let row = 0; row < 2; row += 1) for (let column = 0; column < 4; column += 1) {
      regions.push({ x: 1 + column * 11, y: 1 + row * 17, width: column === 3 ? 13 : 11, height: 17 });
    }
  }
  for (const [index, region] of regions.entries()) {
    const width = rng.int(4, Math.max(4, Math.min(9, region.width - 2)));
    const height = rng.int(4, Math.max(4, Math.min(7, region.height - 2)));
    const x = rng.int(region.x + 1, region.x + region.width - width - 1);
    const y = rng.int(region.y + 1, region.y + region.height - height - 1);
    const cells: Vec[] = [];
    for (let yy = y; yy < y + height; yy += 1) for (let xx = x; xx < x + width; xx += 1) { tiles[yy]![xx] = FLOOR; cells.push({ x: xx, y: yy }); }
    rooms.push({ id: `fallback-room-${index}`, templateId: "legacy-bsp", rotation: 0, tag: index === 0 ? "entrance" : index === regions.length - 1 ? "exit" : "combat", x, y, width, height, center: { x: x + Math.floor(width / 2), y: y + Math.floor(height / 2) }, cells, graphDistance: index, mainPath: true, deadEnd: index === 0 || index === regions.length - 1 });
  }
  for (let index = 1; index < rooms.length; index += 1) carveWideCorridor(tiles, rooms[index - 1]!.center, rooms[index]!.center, rng.next() < 0.5);
  const map: DungeonMap = {
    width: DUNGEON_WIDTH, height: DUNGEON_HEIGHT, tileSize: 16, tiles, formatVersion: 2,
    heights: Array.from({ length: DUNGEON_HEIGHT }, () => Array<0 | 1 | 2>(DUNGEON_WIDTH).fill(0)),
    hardEdges: [], ledgeEdges: [], traversalLinks: [],
    stairsUp: { ...rooms[0]!.center }, stairsDown: { ...rooms[rooms.length - 1]!.center },
    enemyRoster: [...dungeonThemeEnemyRoster(themeId, floor)],
    procedural: { generatorVersion: 1, themeId, layoutSeed, fallback: true, mainPathRoomIds: rooms.map((room) => room.id), rooms },
  };
  return { map, rooms, placementRegions: placementRegions(rooms), usedFallback: true };
}

export function generateDungeonFloor(seed: number, floor: number, themeId: string): GeneratedDungeonFloor {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const generated = tryGenerate(seed, floor, themeId, attempt);
    if (generated) return generated;
  }
  return fallbackDungeon(seed, floor, themeId);
}

export function generatedPlacementCells(map: DungeonMap, tags: readonly DungeonGeneratedRoom["tag"][]): Vec[] {
  const selected = map.procedural?.rooms.filter((room) => tags.includes(room.tag)) ?? [];
  return selected.flatMap((room) => room.cells.filter((cell) => isWalkableCell(map, cell) && manhattan(cell, room.center) > 1));
}
