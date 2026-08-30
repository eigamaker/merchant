import type { ActorArchetype, ActorTier } from "./dungeonDifficulty";

/**
 * What an actor sheet may be used for.
 *
 * `npc` says the sheet is a person rather than a monster. `townsfolk` and
 * `adventurer` say which kind, and the roster draws its faces from them: an
 * adventurer met in the dungeon can only wear a sheet marked `adventurer`, so
 * nobody turns up in art nobody chose for the job.
 */
export type ActorRole = "player" | "npc" | "enemy" | "townsfolk" | "adventurer";

/** The two halves of `npc`, in the order the editor lists them. */
export const NPC_ACTOR_ROLES = ["townsfolk", "adventurer"] as const;
export type NpcActorRole = typeof NPC_ACTOR_ROLES[number];

export interface ActorEnemyStats {
  baseHp: number;
  hpPerFloor: number;
  damage: number;
}

export interface ActorSettings {
  label?: string;
  roles?: readonly ActorRole[];
  /** Identity, not numbers: the curve in dungeonDifficulty turns this into stats. */
  archetype?: ActorArchetype;
  tier?: ActorTier;
  enemyStats?: ActorEnemyStats;
  scale?: number;
  originY?: number;
}

export interface ActorSettingsCatalog {
  version: 1;
  actors: Record<string, ActorSettings>;
}

export const EMPTY_ACTOR_SETTINGS: ActorSettingsCatalog = { version: 1, actors: {} };

export function cloneActorSettings(value: ActorSettingsCatalog): ActorSettingsCatalog {
  return {
    version: 1,
    actors: Object.fromEntries(Object.entries(value.actors).map(([id, settings]) => [id, {
      ...settings,
      roles: settings.roles ? [...settings.roles] : undefined,
      enemyStats: settings.enemyStats ? { ...settings.enemyStats } : undefined,
    }])),
  };
}
