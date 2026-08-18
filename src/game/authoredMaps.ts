import type { Vec } from "./types";

export type AuthoredMapKind = "home" | "dungeon";
export type AuthoredMarkerKind = "homeSpawn" | "dungeonEntrance" | "stairsUp" | "stairsDown";

export interface AuthoredPortal {
  id: string;
  kind: AuthoredMarkerKind;
  position: Vec;
  targetMapId?: string;
  targetMarkerId?: string;
  activation: "enter";
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
  enemySpawns: never[];
}

export const AUTHORED_SAMPLE_MAPS: readonly AuthoredMapDescriptor[] = [
  {
    id: "home",
    name: "自宅兼店舗",
    kind: "home",
    width: 32,
    height: 20,
    tileSize: 16,
    portals: [
      { id: "home-spawn", kind: "homeSpawn", position: { x: 16, y: 16 }, targetMapId: "home", activation: "enter" },
      { id: "dungeon-entrance", kind: "dungeonEntrance", position: { x: 16, y: 2 }, targetMapId: "dungeon", targetMarkerId: "dungeon-up", activation: "enter" },
    ],
    enemySpawns: [],
  },
  {
    id: "dungeon",
    name: "ダンジョン",
    kind: "dungeon",
    width: 48,
    height: 36,
    tileSize: 16,
    portals: [
      { id: "dungeon-up", kind: "stairsUp", position: { x: 6, y: 30 }, targetMapId: "home", targetMarkerId: "dungeon-entrance", activation: "enter" },
      { id: "dungeon-down", kind: "stairsDown", position: { x: 41, y: 6 }, activation: "enter" },
    ],
    enemySpawns: [],
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
