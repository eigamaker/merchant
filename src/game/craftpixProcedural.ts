import { placement } from "./craftpixCatalog";
import { canTraverse, reachableCells } from "./dungeonRules";
import {
  DUNGEON_ROOM_TEMPLATES,
  portOutsideCells,
  rotateTemplate,
  templateCells,
  templateCenter,
  validateTemplateLibrary,
  type DungeonRoomTemplate,
  type PlacedTemplate,
  type RoomPort,
  type RoomPortSide,
  type RoomTag,
} from "./dungeonTemplates";
import { Rng } from "./rng";
import type { DungeonHeight, DungeonMap, DungeonRenderLayer, RenderPlacement, Vec } from "./types";

export const CRAFTPIX_PROCEDURAL_WIDTH = 48;
export const CRAFTPIX_PROCEDURAL_HEIGHT = 36;
export const CRAFTPIX_PROCEDURAL_TILE = 16;
const WALL = 1;
const FLOOR = 0;
const MAP_MARGIN = 2;
const ROOM_BUFFER = 1;
const CORRIDOR_RETRIES = 32;

type RoomNode = { id: string; requiredTag: RoomTag; parent?: number; main: boolean };
type RoomEdge = { id: string; from: number; to: number };
type OrientedTemplate = { template: DungeonRoomTemplate; rotation: 0 | 90 | 180 | 270 };

export interface DungeonBlueprintRoom {
  id: string;
  templateId: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  degree: number;
}

export interface DungeonBlueprintConnection {
  id: string;
  fromRoomId: string;
  toRoomId: string;
  fromPortId: string;
  toPortId: string;
  path: Vec[];
}

export interface DungeonBlueprint {
  rooms: DungeonBlueprintRoom[];
  connections: DungeonBlueprintConnection[];
}

export interface CraftpixGenerationResult {
  map: DungeonMap;
  blueprint: DungeonBlueprint;
}

function derivedRng(seed: number, salt: number): Rng {
  return new Rng(Math.imul(seed ^ salt, 0x9e3779b1));
}

function buildNodes(rng: Rng, requiresTomb: boolean): RoomNode[] {
  const branchParentA = rng.next() < 0.5 ? 2 : 3;
  const branchParentB = rng.next() < 0.5 ? 2 : 3;
  return [
    { id: "entrance", requiredTag: "entrance", main: true },
    { id: "main-1", requiredTag: "combat", parent: 0, main: true },
    { id: "main-2", requiredTag: "combat", parent: 1, main: true },
    { id: "main-3", requiredTag: "combat", parent: 2, main: true },
    { id: "main-4", requiredTag: "loot", parent: 3, main: true },
    { id: "exit", requiredTag: "exit", parent: 4, main: true },
    { id: "branch-1", requiredTag: requiresTomb ? "tomb" : "treasure", parent: branchParentA, main: false },
    { id: "branch-2", requiredTag: "loot", parent: branchParentB, main: false },
  ];
}

function edgesFromNodes(nodes: RoomNode[]): RoomEdge[] {
  return nodes.flatMap((node, index) => node.parent === undefined ? [] : [{ id: `${nodes[node.parent]!.id}->${node.id}`, from: node.parent, to: index }]);
}

function nodeDegrees(nodes: RoomNode[], edges: RoomEdge[]): number[] {
  const degrees = Array(nodes.length).fill(0) as number[];
  edges.forEach((edge) => { degrees[edge.from]! += 1; degrees[edge.to]! += 1; });
  return degrees;
}

function chooseTemplate(rng: Rng, requiredTag: RoomTag, degree: number, templates: DungeonRoomTemplate[]): OrientedTemplate {
  const candidates = templates.filter((template) => template.tags.includes(requiredTag) && template.ports.length === degree);
  const weighted = candidates.flatMap((template) => Array.from({ length: template.weight }, () => template));
  if (weighted.length === 0) throw new Error(`No ${degree}-port template for ${requiredTag}`);
  const base = rng.pick(weighted);
  const rotation = rng.pick(base.allowedRotations) as 0 | 90 | 180 | 270;
  return { template: rotateTemplate(base, rotation), rotation };
}

function intersectsWithBuffer(candidate: PlacedTemplate, rooms: PlacedTemplate[]): boolean {
  return rooms.some((room) => candidate.x - ROOM_BUFFER < room.x + room.template.width
    && candidate.x + candidate.template.width + ROOM_BUFFER > room.x
    && candidate.y - ROOM_BUFFER < room.y + room.template.height
    && candidate.y + candidate.template.height + ROOM_BUFFER > room.y);
}

function placeRoom(rng: Rng, id: string, oriented: OrientedTemplate, rooms: PlacedTemplate[]): PlacedTemplate | undefined {
  const slots: Record<string, Vec> = {
    entrance: { x: 8, y: 30 },
    "main-1": { x: 24, y: 28 },
    "main-2": { x: 8, y: 19 },
    "main-3": { x: 24, y: 17 },
    "main-4": { x: 8, y: 8 },
    exit: { x: 24, y: 7 },
    "branch-1": { x: 39, y: 19 },
    "branch-2": { x: 39, y: 8 },
  };
  const slot = slots[id] ?? { x: 24, y: 18 };
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { template } = oriented;
    const jitterX = attempt === 0 ? 0 : rng.int(-2, 2);
    const jitterY = attempt === 0 ? 0 : rng.int(-1, 1);
    const x = Math.min(CRAFTPIX_PROCEDURAL_WIDTH - template.width - MAP_MARGIN, Math.max(MAP_MARGIN, slot.x - Math.floor(template.width / 2) + jitterX));
    const y = Math.min(CRAFTPIX_PROCEDURAL_HEIGHT - template.height - MAP_MARGIN, Math.max(MAP_MARGIN, slot.y - Math.floor(template.height / 2) + jitterY));
    const candidate: PlacedTemplate = { id, x, y, template, rotation: oriented.rotation };
    if (intersectsWithBuffer(candidate, rooms)) continue;
    return candidate;
  }
  return undefined;
}

function roomCenter(room: PlacedTemplate): Vec {
  return templateCenter(room.template, room.x, room.y);
}

function preferredSide(from: Vec, to: Vec): RoomPortSide {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "east" : "west";
  return dy >= 0 ? "south" : "north";
}

function sideScore(port: RoomPort, desired: RoomPortSide): number {
  if (port.side === desired) return 6;
  const opposite: Record<RoomPortSide, RoomPortSide> = { north: "south", east: "west", south: "north", west: "east" };
  if (port.side === opposite[desired]) return 1;
  return 3;
}

function permutations<T>(values: T[]): T[][] {
  if (values.length <= 1) return [values];
  const result: T[][] = [];
  values.forEach((value, index) => {
    const remaining = [...values.slice(0, index), ...values.slice(index + 1)];
    permutations(remaining).forEach((tail) => result.push([value, ...tail]));
  });
  return result;
}

function assignPorts(
  rng: Rng,
  rooms: PlacedTemplate[],
  edges: RoomEdge[],
): Map<string, RoomPort> | undefined {
  const assignment = new Map<string, RoomPort>();
  for (let roomIndex = 0; roomIndex < rooms.length; roomIndex += 1) {
    const room = rooms[roomIndex]!;
    const incident = edges.filter((edge) => edge.from === roomIndex || edge.to === roomIndex);
    const candidates = permutations(room.template.ports);
    let best: { score: number; ports: RoomPort[] } | undefined;
    for (const ports of candidates) {
      let score = 0;
      incident.forEach((edge, index) => {
        const otherIndex = edge.from === roomIndex ? edge.to : edge.from;
        score += sideScore(ports[index]!, preferredSide(roomCenter(room), roomCenter(rooms[otherIndex]!)));
      });
      if (!best || score > best.score || (score === best.score && rng.next() < 0.5)) best = { score, ports };
    }
    if (!best || best.ports.length !== incident.length) return undefined;
    incident.forEach((edge, index) => assignment.set(`${edge.id}:${room.id}`, best!.ports[index]!));
  }
  return assignment;
}

function globalOutsideCells(room: PlacedTemplate, roomPort: RoomPort): Vec[] {
  return portOutsideCells(room.template, roomPort).map((cell) => ({ x: room.x + cell.x, y: room.y + cell.y }));
}

function makeRoomMask(rooms: PlacedTemplate[]): Map<string, string> {
  const mask = new Map<string, string>();
  rooms.forEach((room) => templateCells(room.template).forEach((cell) => mask.set(`${room.x + cell.x},${room.y + cell.y}`, room.id)));
  return mask;
}

function footprint(anchor: Vec): Vec[] {
  return [anchor, { x: anchor.x + 1, y: anchor.y }, { x: anchor.x, y: anchor.y + 1 }, { x: anchor.x + 1, y: anchor.y + 1 }];
}

function pathKey(point: Vec): string {
  return `${point.x},${point.y}`;
}

function manhattan(a: Vec, b: Vec): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function routeCorridor(
  source: Vec,
  target: Vec,
  roomMask: Map<string, string>,
  allowedRooms: Set<string>,
  occupiedCorridor: Set<string>,
): Vec[] | undefined {
  const open: Array<{ point: Vec; cost: number; priority: number }> = [{ point: source, cost: 0, priority: manhattan(source, target) }];
  const cameFrom = new Map<string, string>();
  const costSoFar = new Map<string, number>([[pathKey(source), 0]]);
  const seen = new Set<string>();
  while (open.length > 0) {
    open.sort((a, b) => a.priority - b.priority);
    const current = open.shift()!;
    const currentKey = pathKey(current.point);
    if (seen.has(currentKey)) continue;
    seen.add(currentKey);
    if (current.point.x === target.x && current.point.y === target.y) {
      const path: Vec[] = [];
      let cursor = currentKey;
      while (cursor) {
        const [x, y] = cursor.split(",").map(Number);
        path.push({ x, y });
        const previous = cameFrom.get(cursor);
        if (!previous) break;
        cursor = previous;
      }
      return path.reverse();
    }
    for (const delta of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
      const next = { x: current.point.x + delta.x, y: current.point.y + delta.y };
      const nextFootprint = footprint(next);
      if (nextFootprint.some((cell) => cell.x < 1 || cell.y < 1 || cell.x >= CRAFTPIX_PROCEDURAL_WIDTH - 1 || cell.y >= CRAFTPIX_PROCEDURAL_HEIGHT - 1)) continue;
      if (nextFootprint.some((cell) => {
        const owner = roomMask.get(pathKey(cell));
        return owner !== undefined && !allowedRooms.has(owner);
      })) continue;
      const corridorOverlap = nextFootprint.filter((cell) => occupiedCorridor.has(pathKey(cell))).length;
      const nextKey = pathKey(next);
      const nextCost = current.cost + 1 + corridorOverlap * 3;
      if (nextCost >= (costSoFar.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
      costSoFar.set(nextKey, nextCost);
      cameFrom.set(nextKey, currentKey);
      open.push({ point: next, cost: nextCost, priority: nextCost + manhattan(next, target) });
    }
  }
  return undefined;
}

function carveRoom(tiles: number[][], room: PlacedTemplate): void {
  templateCells(room.template).forEach((cell) => { tiles[room.y + cell.y]![room.x + cell.x] = FLOOR; });
}

function carvePath(tiles: number[][], path: Vec[], occupiedCorridor: Set<string>): void {
  path.forEach((point) => footprint(point).forEach((cell) => {
    if (cell.x > 0 && cell.y > 0 && cell.x < CRAFTPIX_PROCEDURAL_WIDTH - 1 && cell.y < CRAFTPIX_PROCEDURAL_HEIGHT - 1) {
      tiles[cell.y]![cell.x] = FLOOR;
      occupiedCorridor.add(pathKey(cell));
    }
  }));
}

function wallAsset(tiles: number[][], x: number, y: number): string {
  const floorAt = (dx: number, dy: number): boolean => tiles[y + dy]?.[x + dx] === FLOOR;
  const north = floorAt(0, -1);
  const east = floorAt(1, 0);
  const south = floorAt(0, 1);
  const west = floorAt(-1, 0);
  const count = Number(north) + Number(east) + Number(south) + Number(west);
  if (count >= 3) return "wall-inner";
  if (count === 2 && ((north && south) || (east && west))) return "wall-center";
  if (count === 2) return "wall-corner";
  if (north) return "wall-north";
  if (east) return "wall-east";
  if (south) return "wall-south";
  if (west) return "wall-west";
  return "wall-center";
}

function add(layers: Partial<Record<DungeonRenderLayer, RenderPlacement[]>>, item: RenderPlacement): void {
  (layers[item.layer] ??= []).push(item);
}

function renderMap(tiles: number[][], rooms: PlacedTemplate[], entrance: Vec, stairs: Vec, specialRoom: Vec | undefined, seed: number): Partial<Record<DungeonRenderLayer, RenderPlacement[]>> {
  const layers: Partial<Record<DungeonRenderLayer, RenderPlacement[]>> = {};
  const variation = derivedRng(seed, 0x1d5d);
  for (let y = 0; y < CRAFTPIX_PROCEDURAL_HEIGHT; y += 1) {
    for (let x = 0; x < CRAFTPIX_PROCEDURAL_WIDTH; x += 1) {
      if (tiles[y]![x] === FLOOR) {
        add(layers, placement(variation.next() < 0.08 ? "floor-alt" : "floor", x, y));
        if (variation.next() < 0.025) add(layers, placement("crack", x, y));
        continue;
      }
      const adjacentFloor = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => tiles[y + dy]?.[x + dx] === FLOOR);
      if (!adjacentFloor) continue;
      add(layers, placement(wallAsset(tiles, x, y), x, y));
      if (tiles[y + 1]?.[x] === FLOOR) add(layers, { ...placement("overhead-wall", x, y, "overhead"), offsetY: 8 });
    }
  }
  add(layers, placement("stairs-up", entrance.x, entrance.y));
  add(layers, placement("stairs-down", stairs.x, stairs.y));
  if (specialRoom) add(layers, placement("tomb", specialRoom.x, specialRoom.y));
  rooms.forEach((room, index) => {
    if (index > 0 && index % 3 === 0) {
      const center = roomCenter(room);
      if (!specialRoom || center.x !== specialRoom.x || center.y !== specialRoom.y) add(layers, placement("torch", center.x, center.y));
    }
  });
  return layers;
}

function createBlueprint(rooms: PlacedTemplate[], edges: RoomEdge[], assignment: Map<string, RoomPort>, paths: Map<string, Vec[]>): DungeonBlueprint {
  return {
    rooms: rooms.map((room) => ({
      id: room.id,
      templateId: room.template.id,
      name: room.template.name,
      x: room.x,
      y: room.y,
      width: room.template.width,
      height: room.template.height,
      rotation: room.rotation ?? 0,
      degree: room.template.ports.length,
    })),
    connections: edges.map((edge) => {
      const fromRoom = rooms[edge.from]!;
      const toRoom = rooms[edge.to]!;
      return {
        id: edge.id,
        fromRoomId: fromRoom.id,
        toRoomId: toRoom.id,
        fromPortId: assignment.get(`${edge.id}:${fromRoom.id}`)!.id,
        toPortId: assignment.get(`${edge.id}:${toRoom.id}`)!.id,
        path: paths.get(edge.id) ?? [],
      };
    }),
  };
}

/** Generate a flat Craftpix dungeon and its inspectable room/connection blueprint. */
export function createCraftpixProceduralDungeonWithBlueprint(
  seed: number,
  floor: number,
  requiresTomb = false,
  templates = DUNGEON_ROOM_TEMPLATES,
): CraftpixGenerationResult {
  const templateErrors = validateTemplateLibrary(templates);
  if (templateErrors.length > 0) throw new Error(`Invalid Craftpix template library: ${templateErrors.join("; ")}`);
  let lastError = "unknown";
  for (let retry = 0; retry < CORRIDOR_RETRIES; retry += 1) {
    const rng = derivedRng(seed ^ Math.imul(floor, 7919), retry + 1);
    const nodes = buildNodes(rng, requiresTomb);
    const edges = edgesFromNodes(nodes);
    const degrees = nodeDegrees(nodes, edges);
    const rooms: PlacedTemplate[] = [];
    let failed = false;
    for (const [index, node] of nodes.entries()) {
      let oriented: OrientedTemplate;
      try { oriented = chooseTemplate(rng, node.requiredTag, degrees[index]!, templates); }
      catch (error) { lastError = error instanceof Error ? error.message : "template selection failed"; failed = true; break; }
      const room = placeRoom(rng, node.id, oriented, rooms);
      if (!room) { lastError = `could not place ${node.id}`; failed = true; break; }
      rooms.push(room);
    }
    if (failed) continue;
    const assignment = assignPorts(rng, rooms, edges);
    if (!assignment) { lastError = "could not assign ports"; continue; }
    const roomMask = makeRoomMask(rooms);
    const tiles = Array.from({ length: CRAFTPIX_PROCEDURAL_HEIGHT }, () => Array(CRAFTPIX_PROCEDURAL_WIDTH).fill(WALL));
    rooms.forEach((room) => carveRoom(tiles, room));
    const occupiedCorridor = new Set<string>();
    const paths = new Map<string, Vec[]>();
    for (const edge of edges) {
      const fromRoom = rooms[edge.from]!;
      const toRoom = rooms[edge.to]!;
      const fromPort = assignment.get(`${edge.id}:${fromRoom.id}`)!;
      const toPort = assignment.get(`${edge.id}:${toRoom.id}`)!;
      const source = globalOutsideCells(fromRoom, fromPort)[0]!;
      const target = globalOutsideCells(toRoom, toPort)[0]!;
      const path = routeCorridor(source, target, roomMask, new Set([fromRoom.id, toRoom.id]), occupiedCorridor);
      if (!path) { lastError = `could not route ${edge.id}`; failed = true; break; }
      carvePath(tiles, path, occupiedCorridor);
      paths.set(edge.id, path);
    }
    if (failed) continue;
    const entrance = roomCenter(rooms[0]!);
    const stairs = roomCenter(rooms[5]!);
    const tomb = rooms.find((room) => room.template.tags.includes("tomb"));
    const specialRoom = requiresTomb && tomb ? roomCenter(tomb) : undefined;
    const heights = Array.from({ length: CRAFTPIX_PROCEDURAL_HEIGHT }, () => Array<DungeonHeight>(CRAFTPIX_PROCEDURAL_WIDTH).fill(0));
    const map: DungeonMap = {
      width: CRAFTPIX_PROCEDURAL_WIDTH,
      height: CRAFTPIX_PROCEDURAL_HEIGHT,
      tileSize: CRAFTPIX_PROCEDURAL_TILE,
      visualTheme: "craftpix-procedural",
      formatVersion: 2,
      tiles,
      heights,
      hardEdges: [],
      ledgeEdges: [],
      traversalLinks: [],
      entrance,
      stairs,
      returnStairs: { ...entrance },
      specialRoom,
      renderLayers: renderMap(tiles, rooms, entrance, stairs, specialRoom, seed),
      generation: {
        algorithm: "craftpix-ports-v2",
        seed,
        floor,
        templateLibraryVersion: 2,
        catalogVersion: 1,
        blueprintSummary: { roomCount: rooms.length, branchCount: 2, loopCount: 0 },
      },
    };
    const reached = reachableCells(map, entrance);
    const floorCount = tiles.flat().filter((cell) => cell === FLOOR).length;
    const hasEntranceStep = [
      { x: entrance.x + 1, y: entrance.y }, { x: entrance.x - 1, y: entrance.y },
      { x: entrance.x, y: entrance.y + 1 }, { x: entrance.x, y: entrance.y - 1 },
    ].some((next) => canTraverse(map, entrance, next));
    if (!reached.has(`${stairs.x},${stairs.y}`)) { lastError = "stairs unreachable"; continue; }
    if (specialRoom && !reached.has(`${specialRoom.x},${specialRoom.y}`)) { lastError = "tomb unreachable"; continue; }
    if (reached.size !== floorCount) { lastError = "isolated floor"; continue; }
    if (floorCount < 360 || !hasEntranceStep) { lastError = "entrance invalid"; continue; }
    return { map, blueprint: createBlueprint(rooms, edges, assignment, paths) };
  }
  throw new Error(`Craftpix procedural generation failed after ${CORRIDOR_RETRIES} retries: ${lastError}`);
}

export function createCraftpixProceduralDungeon(seed: number, floor: number, requiresTomb = false, templates = DUNGEON_ROOM_TEMPLATES): DungeonMap {
  return createCraftpixProceduralDungeonWithBlueprint(seed, floor, requiresTomb, templates).map;
}
