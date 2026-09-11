/**
 * Unified pixel-art animation manifests. Export names remain compatible with saved
 * actor IDs and editor integrations; all runtime art comes from unified/.
 */

import type { ActorArchetype, ActorTier } from "./dungeonDifficulty";
import type { ActorRole } from "./actorSettings";

export type ActorAction = "idle" | "walk" | "run" | "attack" | "walkAttack" | "runAttack" | "hurt" | "death" | "interact" | "cast";
export type ActorDirection = "down" | "left" | "right" | "up";

export interface CraftpixActorClip {
  action: ActorAction;
  path: string;
  /** Optional source-sheet metadata emitted by the TMX importer. */
  width?: number;
  height?: number;
  tileSize?: number;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: 4;
  /** The source sheets are four directional rows; this is explicit metadata. */
  directions: readonly ActorDirection[];
  frameRate: number;
  repeat?: number;
  durationsMs?: readonly number[];
}

export interface CraftpixActorDefinition {
  version?: number;
  id: string;
  label: string;
  sourcePack?: string;
  clips: Partial<Record<ActorAction, CraftpixActorClip>>;
  scale: number;
  origin: { x: 0.5; y: number };
  roles?: readonly ActorRole[];
  /** What kind of thing it is and how big a deal — the numbers come from dungeonDifficulty. */
  archetype?: ActorArchetype;
  tier?: ActorTier;
  /** Legacy explicit numbers, still honoured for actors without a tier. */
  enemyStats?: { baseHp: number; hpPerFloor: number; damage: number };
}

/**
 * Which facing each row of a sheet holds. The packs do not agree: the monster
 * sheets run front, back, then the two sides, while the human sheets put the
 * sides in the middle and the back last. Reading one order onto the other
 * leaves a character showing its back when it walks right.
 *
 * Verified against the art rather than assumed: in every sheet the two side
 * rows are near-exact mirrors of one another, which is what identifies them.
 */
export const MONSTER_DIRECTION_ROWS = ["down", "up", "left", "right"] as const;
export const HUMAN_DIRECTION_ROWS = ["down", "left", "right", "up"] as const;

const ACTIONS: readonly ActorAction[] = ["idle", "walk", "run", "attack", "walkAttack", "runAttack", "hurt", "death", "interact", "cast"];

function characterSet(id: string, label: string, roles: readonly ActorRole[], profile?: { archetype: ActorArchetype; tier: ActorTier }, directions: readonly ActorDirection[] = MONSTER_DIRECTION_ROWS): CraftpixActorDefinition {
  const clips: Partial<Record<ActorAction, CraftpixActorClip>> = {};
  for (const action of ACTIONS) clips[action] = {
    action, path: `assets/actors/unified/${id}/${action}.png`,
    frameWidth: 32, frameHeight: 32, columns: 4, rows: 4, directions,
    frameRate: action === "idle" ? 4 : action === "run" || action === "runAttack" ? 12 : 8,
    repeat: ["idle", "walk", "run"].includes(action) ? -1 : 0,
  };
  return { id, label, sourcePack: "unified-pixel-2026", clips, scale: 1, origin: { x: 0.5, y: 0.875 }, roles, ...profile };
}


/**
 * There is no built-in protagonist sheet. The player wears whichever actor
 * carries the `player` role, which `playerActor()` in actorCatalog resolves, so
 * swapping the protagonist is a checkbox rather than an edit here.
 */

/** Stable adventurer IDs are retained for existing rosters. */
export const CRAFTPIX_NPC_ACTORS = {
  swordsman_lvl1: characterSet("swordsman_lvl1", "見習い剣士", ["npc", "adventurer"], undefined, HUMAN_DIRECTION_ROWS),
  swordsman_lvl2: characterSet("swordsman_lvl2", "女剣士", ["npc", "adventurer"], undefined, HUMAN_DIRECTION_ROWS),
  swordsman_lvl3: characterSet("swordsman_lvl3", "黄金の冒険者", ["npc", "adventurer"], undefined, HUMAN_DIRECTION_ROWS),
} as const;

export type CraftpixNpcActorId = keyof typeof CRAFTPIX_NPC_ACTORS;

export const CRAFTPIX_ENEMY_ACTORS = {
  slime1: characterSet("slime1", "スライム 1", ["enemy"], { archetype: "swarm", tier: 1 }),
  slime2: characterSet("slime2", "スライム 2", ["enemy"], { archetype: "swarm", tier: 2 }),
  slime3: characterSet("slime3", "スライム 3", ["enemy"], { archetype: "swarm", tier: 3 }),
  plant1: characterSet("plant1", "捕食植物 1", ["enemy"], { archetype: "lurker", tier: 1 }),
  plant2: characterSet("plant2", "捕食植物 2", ["enemy"], { archetype: "lurker", tier: 2 }),
  plant3: characterSet("plant3", "捕食植物 3", ["enemy"], { archetype: "lurker", tier: 3 }),
  orc1: characterSet("orc1", "オーク 1", ["enemy"], { archetype: "brute", tier: 1 }),
  orc2: characterSet("orc2", "オーク 2", ["enemy"], { archetype: "brute", tier: 2 }),
  orc3: characterSet("orc3", "オーク 3", ["enemy"], { archetype: "brute", tier: 3 }),
  vampire1: characterSet("vampire1", "吸血術師 1", ["enemy"], { archetype: "caster", tier: 2 }),
  vampire2: characterSet("vampire2", "吸血術師 2", ["enemy"], { archetype: "caster", tier: 3 }),
  vampire3: characterSet("vampire3", "吸血術師 3", ["enemy"], { archetype: "caster", tier: 4 }),
} as const;

export type CraftpixEnemyActorId = keyof typeof CRAFTPIX_ENEMY_ACTORS;

export const CRAFTPIX_ENEMY_POOLS = {
  outdoor: ["slime1", "slime2", "plant1"] as const,
  shallow: ["slime1", "slime2", "orc1"] as const,
  middle: ["orc1", "orc2", "plant2", "vampire1"] as const,
  deep: ["orc3", "plant3", "vampire2", "vampire3"] as const,
};

export const CRAFTPIX_ACTORS = {
  ...CRAFTPIX_NPC_ACTORS,
  ...CRAFTPIX_ENEMY_ACTORS,
} as const;

export function craftpixActor(id: string): CraftpixActorDefinition | undefined {
  return CRAFTPIX_ACTORS[id as keyof typeof CRAFTPIX_ACTORS];
}

export function actorFrame(action: CraftpixActorClip, direction: ActorDirection, frame: number): number {
  const row = action.directions.indexOf(direction);
  if (row < 0) throw new RangeError(`unknown actor direction: ${direction}`);
  if (!Number.isInteger(frame) || frame < 0 || frame >= action.columns) throw new RangeError(`actor frame out of range: ${frame}`);
  return row * action.columns + frame;
}
