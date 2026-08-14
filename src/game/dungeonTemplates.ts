import type { Vec } from "./types";

export type RoomTag = "entrance" | "exit" | "combat" | "loot" | "treasure" | "tomb";
export type RoomPortSide = "north" | "east" | "south" | "west";
export const DUNGEON_TEMPLATE_STORAGE_KEY = "dungeon-template-library:v2";

/** A two-cell-wide opening on a room's outer boundary. */
export interface RoomPort {
  id: string;
  side: RoomPortSide;
  /** The first cell along the selected side; the port occupies offset and offset + 1. */
  offset: number;
}

export interface DungeonRoomTemplate {
  version: 2;
  id: string;
  name: string;
  width: number;
  height: number;
  tags: RoomTag[];
  weight: number;
  allowedRotations: Array<0 | 90 | 180 | 270>;
  /** Optional void cells make an L/irregular footprint without mixing art and rules. */
  voidCells?: Vec[];
  ports: RoomPort[];
}

const port = (id: string, side: RoomPortSide, offset: number): RoomPort => ({ id, side, offset });

const room = (
  id: string,
  name: string,
  width: number,
  height: number,
  tags: RoomTag[],
  ports: RoomPort[],
  weight = 1,
  voidCells?: Vec[],
): DungeonRoomTemplate => ({
  version: 2,
  id,
  name,
  width,
  height,
  tags,
  weight,
  allowedRotations: [0, 90, 180, 270],
  ports,
  ...(voidCells ? { voidCells } : {}),
});

/** The first flat-floor library used by the procedural generator and review tool. */
export const DUNGEON_ROOM_TEMPLATES: DungeonRoomTemplate[] = [
  room("entrance-hall", "Entrance landing", 9, 8, ["entrance"], [port("main", "south", 3)]),
  room("exit-sanctum", "Stair sanctum", 9, 9, ["exit"], [port("main", "north", 3)]),
  room("treasure-alcove", "Treasure alcove", 7, 7, ["loot", "treasure"], [port("main", "south", 2)]),
  room("tomb-recess", "Tomb recess", 8, 8, ["tomb", "treasure"], [port("main", "west", 2)]),
  room("combat-square", "Square chamber", 8, 8, ["combat"], [port("north", "north", 3), port("east", "east", 3)]),
  room("combat-gallery", "Long gallery", 11, 7, ["combat"], [port("west", "west", 2), port("east", "east", 3)], 2),
  room("combat-corner", "Corner chamber", 9, 9, ["combat"], [port("north", "north", 3), port("east", "east", 3)]),
  room("loot-store", "L-shaped store room", 10, 8, ["loot"], [port("south", "south", 3), port("west", "west", 2)], 2, [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 8, y: 6 }, { x: 9, y: 6 }, { x: 8, y: 7 }, { x: 9, y: 7 },
  ]),
  room("guard-trident", "Three-way guard room", 9, 9, ["combat"], [port("north", "north", 3), port("east", "east", 3), port("west", "west", 3)]),
  room("library-trident", "Three-way library", 10, 9, ["loot"], [port("north", "north", 4), port("east", "east", 3), port("south", "south", 4)]),
  room("crypt-trident", "Three-way crypt", 9, 10, ["tomb", "treasure"], [port("north", "north", 3), port("west", "west", 3), port("south", "south", 3)]),
  room("great-hall", "Four-way great hall", 10, 10, ["combat"], [
    port("north", "north", 4), port("east", "east", 4), port("south", "south", 4), port("west", "west", 4),
  ]),
];

export interface PlacedTemplate {
  id: string;
  x: number;
  y: number;
  template: DungeonRoomTemplate;
  rotation?: 0 | 90 | 180 | 270;
}

function rotateCell(cell: Vec, width: number, height: number, rotation: 0 | 90 | 180 | 270): Vec {
  if (rotation === 0) return { ...cell };
  if (rotation === 90) return { x: height - 1 - cell.y, y: cell.x };
  if (rotation === 180) return { x: width - 1 - cell.x, y: height - 1 - cell.y };
  return { x: cell.y, y: width - 1 - cell.x };
}

function rotatedPortCells(template: DungeonRoomTemplate, roomPort: RoomPort): Vec[] {
  const cells = portCells(template, roomPort);
  return cells;
}

function portFromCells(id: string, cells: Vec[], width: number, height: number): RoomPort {
  const [a, b] = cells;
  if (!a || !b) throw new Error(`Port ${id} must have two cells`);
  if (a.y === 0 && b.y === 0) return port(id, "north", Math.min(a.x, b.x));
  if (a.x === width - 1 && b.x === width - 1) return port(id, "east", Math.min(a.y, b.y));
  if (a.y === height - 1 && b.y === height - 1) return port(id, "south", Math.min(a.x, b.x));
  if (a.x === 0 && b.x === 0) return port(id, "west", Math.min(a.y, b.y));
  throw new Error(`Rotated port ${id} is no longer on a boundary`);
}

/** Return an oriented copy of a template, including its voids and port positions. */
export function rotateTemplate(template: DungeonRoomTemplate, rotation: 0 | 90 | 180 | 270): DungeonRoomTemplate {
  if (rotation === 0) return structuredClone(template);
  const width = rotation === 90 || rotation === 270 ? template.height : template.width;
  const height = rotation === 90 || rotation === 270 ? template.width : template.height;
  const voidCells = (template.voidCells ?? []).map((cell) => rotateCell(cell, template.width, template.height, rotation));
  const ports = template.ports.map((roomPort) => {
    const cells = rotatedPortCells(template, roomPort).map((cell) => rotateCell(cell, template.width, template.height, rotation));
    return portFromCells(roomPort.id, cells, width, height);
  });
  return { ...structuredClone(template), width, height, allowedRotations: [rotation], voidCells, ports };
}

export function templateCells(roomTemplate: DungeonRoomTemplate): Vec[] {
  const voids = new Set((roomTemplate.voidCells ?? []).map((cell) => `${cell.x},${cell.y}`));
  const cells: Vec[] = [];
  for (let y = 0; y < roomTemplate.height; y += 1) {
    for (let x = 0; x < roomTemplate.width; x += 1) {
      if (!voids.has(`${x},${y}`)) cells.push({ x, y });
    }
  }
  return cells;
}

export function templateCenter(roomTemplate: DungeonRoomTemplate, x: number, y: number): Vec {
  return { x: x + Math.floor(roomTemplate.width / 2), y: y + Math.floor(roomTemplate.height / 2) };
}

export function portCells(template: DungeonRoomTemplate, roomPort: RoomPort): Vec[] {
  if (roomPort.side === "north") return [{ x: roomPort.offset, y: 0 }, { x: roomPort.offset + 1, y: 0 }];
  if (roomPort.side === "east") return [{ x: template.width - 1, y: roomPort.offset }, { x: template.width - 1, y: roomPort.offset + 1 }];
  if (roomPort.side === "south") return [{ x: roomPort.offset, y: template.height - 1 }, { x: roomPort.offset + 1, y: template.height - 1 }];
  return [{ x: 0, y: roomPort.offset }, { x: 0, y: roomPort.offset + 1 }];
}

export function portOutsideCells(template: DungeonRoomTemplate, roomPort: RoomPort): Vec[] {
  return portCells(template, roomPort).map((cell) => ({
    x: cell.x + (roomPort.side === "east" ? 1 : roomPort.side === "west" ? -1 : 0),
    y: cell.y + (roomPort.side === "south" ? 1 : roomPort.side === "north" ? -1 : 0),
  }));
}

export function templatePortCount(template: DungeonRoomTemplate): number {
  return template.ports.length;
}

function isFloor(template: DungeonRoomTemplate, cell: Vec): boolean {
  return templateCells(template).some((candidate) => candidate.x === cell.x && candidate.y === cell.y);
}

function validateConnected(template: DungeonRoomTemplate): boolean {
  const cells = templateCells(template);
  const start = cells[0];
  if (!start) return false;
  const reached = new Set([`${start.x},${start.y}`]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const delta of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
      const next = { x: current.x + delta.x, y: current.y + delta.y };
      const key = `${next.x},${next.y}`;
      if (!reached.has(key) && isFloor(template, next)) { reached.add(key); queue.push(next); }
    }
  }
  return reached.size === cells.length;
}

export function cloneTemplateLibrary(templates = DUNGEON_ROOM_TEMPLATES): DungeonRoomTemplate[] {
  return structuredClone(templates);
}

/** Shared validation for the review editor and the runtime generator. */
export function validateTemplateLibrary(templates: DungeonRoomTemplate[]): string[] {
  const errors: string[] = [];
  const required: RoomTag[] = ["entrance", "exit", "combat", "loot", "treasure", "tomb"];
  required.forEach((tag) => {
    if (!templates.some((template) => template.tags.includes(tag))) errors.push(`Missing required template tag: ${tag}`);
  });
  const ids = new Set<string>();
  templates.forEach((template) => {
    if (template.version !== 2) errors.push(`${template.id || "(empty)"}: template version must be 2`);
    if (!template.id || ids.has(template.id)) errors.push(`Template id must be unique: ${template.id || "(empty)"}`);
    ids.add(template.id);
    if (!Number.isInteger(template.width) || !Number.isInteger(template.height) || template.width < 6 || template.width > 14 || template.height < 6 || template.height > 14) {
      errors.push(`${template.id}: size must be 6–14 cells`);
    }
    const voids = new Set<string>();
    for (const cell of template.voidCells ?? []) {
      if (cell.x < 0 || cell.y < 0 || cell.x >= template.width || cell.y >= template.height) errors.push(`${template.id}: void cell is out of bounds`);
      const key = `${cell.x},${cell.y}`;
      if (voids.has(key)) errors.push(`${template.id}: duplicate void cell`);
      voids.add(key);
    }
    if (templateCells(template).length < 24) errors.push(`${template.id}: needs at least 24 floor cells`);
    if (!validateConnected(template)) errors.push(`${template.id}: floor cells must be connected`);
    const portKeys = new Set<string>();
    template.ports.forEach((roomPort) => {
      const sideLength = roomPort.side === "north" || roomPort.side === "south" ? template.width : template.height;
      if (!Number.isInteger(roomPort.offset) || roomPort.offset < 1 || roomPort.offset > sideLength - 3) errors.push(`${template.id}:${roomPort.id}: port must stay one cell away from corners`);
      const cells = portCells(template, roomPort);
      cells.forEach((cell) => {
        const key = `${cell.x},${cell.y}`;
        if (portKeys.has(key)) errors.push(`${template.id}:${roomPort.id}: ports overlap`);
        portKeys.add(key);
        if (!isFloor(template, cell)) errors.push(`${template.id}:${roomPort.id}: port must be on floor cells`);
      });
    });
    if (template.ports.length < 1 || template.ports.length > 4) errors.push(`${template.id}: port count must be 1–4`);
  });
  return errors;
}
