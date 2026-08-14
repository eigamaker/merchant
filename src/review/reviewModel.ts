import layout from "../game/craftpixDungeonLayout.json";

export const REVIEW_MAP_ID = "craftpix-showcase";
export const REVIEW_TILE_SIZE = layout.tile;
export const REVIEW_WIDTH = layout.width;
export const REVIEW_HEIGHT = layout.height;
export const REVIEW_ENTRY = { ...layout.entry };
export const REVIEW_STAIRS = { ...layout.stairs };

export type ConnectorKind = "none" | "stairs-up" | "stairs-down" | "stairs-both";

export interface ReviewState {
  version: 2;
  mapId: string;
  tile: number;
  width: number;
  height: number;
  collision: number[];
  heights: number[];
  connectors: ConnectorKind[];
  overhead: boolean[];
  edgeBlocks: string[];
  ledgeEdges: string[];
}

const sourceCollision = layout.collision.flatMap((row) => Array.from(row, (cell) => cell === "." ? 0 : 1));

export function tileIndex(x: number, y: number): number {
  return y * REVIEW_WIDTH + x;
}

export function edgeKey(x: number, y: number, direction: "east" | "south"): string {
  return `${x},${y},${direction}`;
}

export function createInitialReviewState(): ReviewState {
  const connectors: ConnectorKind[] = Array(REVIEW_WIDTH * REVIEW_HEIGHT).fill("none");
  connectors[tileIndex(REVIEW_ENTRY.x, REVIEW_ENTRY.y)] = "stairs-up";
  connectors[tileIndex(REVIEW_STAIRS.x, REVIEW_STAIRS.y)] = "stairs-down";
  return {
    version: 2,
    mapId: REVIEW_MAP_ID,
    tile: REVIEW_TILE_SIZE,
    width: REVIEW_WIDTH,
    height: REVIEW_HEIGHT,
    collision: [...sourceCollision],
    heights: Array(REVIEW_WIDTH * REVIEW_HEIGHT).fill(0),
    connectors,
    overhead: Array(REVIEW_WIDTH * REVIEW_HEIGHT).fill(false),
    edgeBlocks: [],
    ledgeEdges: [],
  };
}

export function cloneReviewState(state: ReviewState): ReviewState {
  return {
    ...state,
    collision: [...state.collision],
    heights: [...state.heights],
    connectors: [...state.connectors],
    overhead: [...state.overhead],
    edgeBlocks: [...state.edgeBlocks],
    ledgeEdges: [...state.ledgeEdges],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isConnector(value: unknown): value is ConnectorKind {
  return value === "none" || value === "stairs-up" || value === "stairs-down" || value === "stairs-both";
}

function numberArray(value: unknown, length: number, min: number, max: number): number[] | undefined {
  if (!Array.isArray(value) || value.length !== length || value.some((entry) => typeof entry !== "number" || !Number.isInteger(entry) || entry < min || entry > max)) return undefined;
  return [...value] as number[];
}

function booleanArray(value: unknown, length: number): boolean[] | undefined {
  if (!Array.isArray(value) || value.length !== length || value.some((entry) => typeof entry !== "boolean")) return undefined;
  return [...value] as boolean[];
}

export function normalizeReviewState(value: unknown): ReviewState | undefined {
  if (!isRecord(value)) return undefined;
  const length = REVIEW_WIDTH * REVIEW_HEIGHT;
  const collision = numberArray(value.collision, length, 0, 1);
  const rawHeights = numberArray(value.heights, length, 0, 3);
  const heights = rawHeights?.map((height) => Math.min(height, 2));
  const connectors = Array.isArray(value.connectors) && value.connectors.length === length && value.connectors.every(isConnector)
    ? [...value.connectors] as ConnectorKind[]
    : undefined;
  const overhead = booleanArray(value.overhead, length);
  const edgeBlocks = Array.isArray(value.edgeBlocks) && value.edgeBlocks.every((entry) => typeof entry === "string")
    ? Array.from(new Set(value.edgeBlocks as string[]))
    : undefined;
  const ledgeEdges = Array.isArray(value.ledgeEdges) && value.ledgeEdges.every((entry) => typeof entry === "string")
    ? Array.from(new Set(value.ledgeEdges as string[]))
    : [];
  if ((value.version !== 1 && value.version !== 2) || value.mapId !== REVIEW_MAP_ID || value.tile !== REVIEW_TILE_SIZE || value.width !== REVIEW_WIDTH || value.height !== REVIEW_HEIGHT || !collision || !heights || !connectors || !overhead || !edgeBlocks) return undefined;
  return { version: 2, mapId: REVIEW_MAP_ID, tile: REVIEW_TILE_SIZE, width: REVIEW_WIDTH, height: REVIEW_HEIGHT, collision, heights, connectors, overhead, edgeBlocks, ledgeEdges };
}

export function toExportObject(state: ReviewState): ReviewState {
  return cloneReviewState(state);
}

export function walkableCount(state: ReviewState): number {
  return state.collision.reduce((count, value) => count + (value === 0 ? 1 : 0), 0);
}
