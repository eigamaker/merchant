import type { Vec } from "./types";

export type AuthoredMapKind = "town" | "interior" | "dungeon";
export type AuthoredMarkerKind = "start" | "portal" | "stairsUp" | "stairsDown" | "poi" | "enemySpawn" | "npcSpawn" | "chest" | "trap";

export interface AuthoredPortal {
  id: string;
  kind: "portal" | "stairsUp" | "stairsDown";
  position: Vec;
  targetMapId?: string;
  targetMarkerId?: string;
  activation: "enter";
}

export interface AuthoredEnemySpawn {
  id: string;
  position: Vec;
  pool: "outdoor" | "shallow" | "middle" | "deep";
  count: { min: number; max: number };
  fixedActorId?: string;
}

export interface AuthoredMapDescriptor {
  id: string;
  name: string;
  kind: AuthoredMapKind;
  width: number;
  height: number;
  tileSize: 16;
  sourceDocumentId?: string;
  portals: AuthoredPortal[];
  enemySpawns: AuthoredEnemySpawn[];
}

/** The first connected content set used by the editor's playable samples. */
export const AUTHORED_SAMPLE_MAPS: readonly AuthoredMapDescriptor[] = [
  {
    id: "town-main",
    name: "灰灯町",
    kind: "town",
    width: 60,
    height: 45,
    tileSize: 16,
    portals: [
      { id: "guild-entry", kind: "portal", position: { x: 18, y: 11 }, targetMapId: "guild-hall-1f", targetMarkerId: "guild-exit", activation: "enter" },
      { id: "workshop-entry", kind: "portal", position: { x: 42, y: 16 }, targetMapId: "glassblower-workshop", targetMarkerId: "workshop-exit", activation: "enter" },
      { id: "dungeon-entry", kind: "portal", position: { x: 31, y: 34 }, targetMapId: "dungeon-manual-01", targetMarkerId: "dungeon-entrance", activation: "enter" },
    ],
    enemySpawns: [],
  },
  {
    id: "guild-hall-1f",
    name: "ギルドホール",
    kind: "interior",
    width: 32,
    height: 24,
    tileSize: 16,
    portals: [{ id: "guild-exit", kind: "portal", position: { x: 16, y: 22 }, targetMapId: "town-main", targetMarkerId: "guild-entry", activation: "enter" }],
    enemySpawns: [],
  },
  {
    id: "glassblower-workshop",
    name: "ガラス工房",
    kind: "interior",
    width: 32,
    height: 24,
    tileSize: 16,
    portals: [{ id: "workshop-exit", kind: "portal", position: { x: 15, y: 22 }, targetMapId: "town-main", targetMarkerId: "workshop-entry", activation: "enter" }],
    enemySpawns: [],
  },
  {
    id: "dungeon-manual-01",
    name: "地下迷宮・手作り区画",
    kind: "dungeon",
    width: 48,
    height: 36,
    tileSize: 16,
    portals: [
      { id: "dungeon-entrance", kind: "stairsUp", position: { x: 6, y: 30 }, targetMapId: "town-main", targetMarkerId: "dungeon-entry", activation: "enter" },
      { id: "dungeon-down", kind: "stairsDown", position: { x: 41, y: 6 }, activation: "enter" },
    ],
    enemySpawns: [{ id: "dungeon-pool-1", position: { x: 25, y: 18 }, pool: "shallow", count: { min: 2, max: 4 } }],
  },
];

export function authoredMap(id: string): AuthoredMapDescriptor | undefined {
  return AUTHORED_SAMPLE_MAPS.find((map) => map.id === id);
}

export function validateAuthoredMapConnections(maps: readonly AuthoredMapDescriptor[] = AUTHORED_SAMPLE_MAPS): string[] {
  const issues: string[] = [];
  const byId = new Map(maps.map((map) => [map.id, map]));
  for (const map of maps) for (const portal of map.portals) {
    if (!portal.targetMapId) continue;
    const target = byId.get(portal.targetMapId);
    if (!target) { issues.push(`${map.id}:${portal.id} target map is missing`); continue; }
    if (portal.targetMarkerId && !target.portals.some((candidate) => candidate.id === portal.targetMarkerId)) issues.push(`${map.id}:${portal.id} target marker is missing`);
  }
  return issues;
}
