/**
 * Runtime-neutral actor definitions for the supplied Craftpix character packs.
 *
 * Each action sheet is kept separate because the source packs use a different
 * number of frames per action. The importer records the exact dimensions and
 * the renderer creates the animation from this manifest.
 */

import type { ActorArchetype, ActorTier } from "./dungeonDifficulty";
import type { ActorRole } from "./actorSettings";

export type ActorAction = "idle" | "walk" | "run" | "attack" | "walkAttack" | "runAttack" | "hurt" | "death";
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

const clip = (action: ActorAction, path: string, columns: number, frameRate: number, repeat = -1, frameWidth = 64, frameHeight = 64, directions: readonly ActorDirection[] = MONSTER_DIRECTION_ROWS): CraftpixActorClip => ({
  action,
  path,
  frameWidth,
  frameHeight,
  columns,
  rows: 4,
  directions,
  frameRate,
  repeat,
});

type ActorColumns = Partial<Record<"idle" | "walk" | "run" | "attack" | "walkAttack" | "runAttack" | "hurt" | "death", number>>;

function characterSet(prefix: string, folder: string, sourcePack: string, columns: ActorColumns, roles: readonly ActorRole[] = ["enemy"], profile?: { archetype: ActorArchetype; tier: ActorTier }, rows: readonly ActorDirection[] = MONSTER_DIRECTION_ROWS): CraftpixActorDefinition {
  const uppercaseActions = prefix.startsWith("Swordsman") || prefix.startsWith("Slime") || prefix.startsWith("Plant") || prefix.startsWith("Vampires");
  const file = (action: string): string => {
    const names: Record<string, string> = uppercaseActions
      ? { idle: "Idle", walk: "Walk", run: "Run", attack: "Attack", walkAttack: "Walk_Attack", runAttack: "Run_Attack", hurt: "Hurt", death: "Death" }
      : { idle: "idle", walk: "walk", run: "run", attack: "attack", hurt: "hurt", death: "death" };
    const actionName = prefix.startsWith("Swordsman") && action === "attack" ? "attack" : (names[action] ?? action);
    return `assets/actors/craftpix/${folder}/${prefix}_${actionName}_with_shadow.png`;
  };

  const clips: Partial<Record<ActorAction, CraftpixActorClip>> = {
    idle: clip("idle", file("idle"), columns.idle ?? 4, 5, -1, 64, 64, rows),
    walk: clip("walk", file("walk"), columns.walk ?? 6, 8, -1, 64, 64, rows),
    run: clip("run", file("run"), columns.run ?? 8, 10, -1, 64, 64, rows),
    attack: clip("attack", file("attack"), columns.attack ?? 8, 12, 0, 64, 64, rows),
    hurt: clip("hurt", file("hurt"), columns.hurt ?? 5, 8, 0, 64, 64, rows),
    death: clip("death", file("death"), columns.death ?? 7, 8, 0, 64, 64, rows),
  };
  if (prefix.startsWith("Swordsman")) {
    clips.walkAttack = clip("walkAttack", file("walkAttack"), columns.walkAttack ?? 6, 12, 0, 64, 64, rows);
    clips.runAttack = clip("runAttack", file("runAttack"), columns.runAttack ?? 8, 12, 0, 64, 64, rows);
  }

  return {
    id: folder.toLowerCase(),
    label: folder,
    sourcePack,
    clips,
    // The visible character occupies roughly 20–27px inside a 64px source
    // cell. Render at native scale and anchor the feet to the shadow.
    scale: 1,
    origin: { x: 0.5, y: 0.72 },
    roles,
    ...(profile ?? {}),
  };
}

/**
 * There is no built-in protagonist sheet. The player wears whichever actor
 * carries the `player` role, which `playerActor()` in actorCatalog resolves, so
 * swapping the protagonist is a checkbox rather than an edit here.
 */

/**
 * The level 2/3 Swordsman sheets are human NPC variants, not enemies. They are
 * marked `adventurer` because these are the faces the guild roster wears; a
 * townsfolk sheet has to be registered before the town can stop using the
 * legacy three-frame sprites.
 */
export const CRAFTPIX_NPC_ACTORS = {
  swordsman_lvl1: characterSet("Swordsman_lvl1", "Swordsman_lvl1", "swordsman", { idle: 12, walk: 6, run: 8, attack: 8, walkAttack: 6, runAttack: 8, hurt: 5, death: 7 }, ["npc", "adventurer"], undefined, HUMAN_DIRECTION_ROWS),
  swordsman_lvl2: characterSet("Swordsman_lvl2", "Swordsman_lvl2", "swordsman", { idle: 12, walk: 6, run: 8, attack: 8, walkAttack: 6, runAttack: 8, hurt: 5, death: 7 }, ["npc", "adventurer"], undefined, HUMAN_DIRECTION_ROWS),
  swordsman_lvl3: characterSet("Swordsman_lvl3", "Swordsman_lvl3", "swordsman", { idle: 12, walk: 6, run: 8, attack: 8, walkAttack: 6, runAttack: 8, hurt: 5, death: 7 }, ["npc", "adventurer"], undefined, HUMAN_DIRECTION_ROWS),
} as const;

export type CraftpixNpcActorId = keyof typeof CRAFTPIX_NPC_ACTORS;

export const CRAFTPIX_ENEMY_ACTORS = {
  slime1: characterSet("Slime1", "Slime1", "slimes", { idle: 6, walk: 8, run: 8, attack: 10, hurt: 5, death: 10 }, ["enemy"], { archetype: "swarm", tier: 1 }),
  slime2: characterSet("Slime2", "Slime2", "slimes", { idle: 6, walk: 8, run: 8, attack: 11, hurt: 5, death: 10 }, ["enemy"], { archetype: "swarm", tier: 2 }),
  slime3: characterSet("Slime3", "Slime3", "slimes", { idle: 6, walk: 8, run: 8, attack: 9, hurt: 5, death: 10 }, ["enemy"], { archetype: "swarm", tier: 3 }),
  plant1: characterSet("Plant1", "Plant1", "predator-plants", { idle: 4, walk: 6, run: 8, attack: 7, hurt: 5, death: 10 }, ["enemy"], { archetype: "lurker", tier: 1 }),
  plant2: characterSet("Plant2", "Plant2", "predator-plants", { idle: 4, walk: 6, run: 8, attack: 7, hurt: 5, death: 10 }, ["enemy"], { archetype: "lurker", tier: 2 }),
  plant3: characterSet("Plant3", "Plant3", "predator-plants", { idle: 4, walk: 6, run: 8, attack: 7, hurt: 5, death: 10 }, ["enemy"], { archetype: "lurker", tier: 3 }),
  orc1: characterSet("orc1", "Orc1", "orcs", { idle: 4, walk: 6, run: 8, attack: 8, hurt: 6, death: 8 }, ["enemy"], { archetype: "brute", tier: 1 }),
  orc2: characterSet("orc2", "Orc2", "orcs", { idle: 4, walk: 6, run: 8, attack: 8, hurt: 6, death: 8 }, ["enemy"], { archetype: "brute", tier: 2 }),
  orc3: characterSet("orc3", "Orc3", "orcs", { idle: 4, walk: 6, run: 8, attack: 8, hurt: 6, death: 8 }, ["enemy"], { archetype: "brute", tier: 3 }),
  vampire1: { ...characterSet("Vampires1", "Vampires1", "vampires", { idle: 4, walk: 6, run: 8, attack: 12, hurt: 4, death: 11 }, ["enemy"], { archetype: "caster", tier: 2 }), id: "vampire1" },
  vampire2: { ...characterSet("Vampires2", "Vampires2", "vampires", { idle: 4, walk: 6, run: 8, attack: 12, hurt: 4, death: 11 }, ["enemy"], { archetype: "caster", tier: 3 }), id: "vampire2" },
  vampire3: { ...characterSet("Vampires3", "Vampires3", "vampires", { idle: 4, walk: 6, run: 8, attack: 12, hurt: 4, death: 11 }, ["enemy"], { archetype: "caster", tier: 4 }), id: "vampire3" },
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
