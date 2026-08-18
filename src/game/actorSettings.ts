export type ActorRole = "player" | "npc" | "enemy";

export interface ActorEnemyStats {
  baseHp: number;
  hpPerFloor: number;
  damage: number;
}

export interface ActorSettings {
  label?: string;
  roles?: readonly ActorRole[];
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
