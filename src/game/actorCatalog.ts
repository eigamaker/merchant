import { CRAFTPIX_ACTORS, type CraftpixActorDefinition } from "./craftpixActors";
import { GENERATED_ACTORS } from "./actorAssetCatalog.generated";
import { GENERATED_ACTOR_SETTINGS } from "./actorSettings.generated";
import type { ActorSettings, ActorSettingsCatalog } from "./actorSettings";

const BASE_ACTOR_CATALOG: Record<string, CraftpixActorDefinition> = Object.fromEntries([
  ...Object.entries(CRAFTPIX_ACTORS),
  ...GENERATED_ACTORS.map((actor) => [actor.id, actor]),
]);

let activeSettings: ActorSettingsCatalog = GENERATED_ACTOR_SETTINGS;
export const ACTOR_CATALOG: Record<string, CraftpixActorDefinition> = {};

function materialize(actor: CraftpixActorDefinition, settings: ActorSettings | undefined): CraftpixActorDefinition {
  if (!settings) return { ...actor, clips: { ...actor.clips } };
  return {
    ...actor,
    ...(settings.label ? { label: settings.label } : {}),
    ...(settings.roles ? { roles: [...settings.roles] } : {}),
    ...(settings.scale ? { scale: settings.scale } : {}),
    ...(settings.originY !== undefined ? { origin: { ...actor.origin, y: settings.originY } } : {}),
    ...(settings.enemyStats ? { enemyStats: { ...settings.enemyStats } } : {}),
    clips: { ...actor.clips },
  };
}

export function applyActorSettings(settings: ActorSettingsCatalog): void {
  activeSettings = { version: 1, actors: Object.fromEntries(Object.entries(settings.actors).map(([id, value]) => [id, { ...value, roles: value.roles ? [...value.roles] : undefined, enemyStats: value.enemyStats ? { ...value.enemyStats } : undefined }])) };
  for (const [id, actor] of Object.entries(BASE_ACTOR_CATALOG)) ACTOR_CATALOG[id] = materialize(actor, activeSettings.actors[id]);
}

export function currentActorSettings(): ActorSettingsCatalog {
  return { version: 1, actors: Object.fromEntries(Object.entries(activeSettings.actors).map(([id, value]) => [id, { ...value, roles: value.roles ? [...value.roles] : undefined, enemyStats: value.enemyStats ? { ...value.enemyStats } : undefined }])) };
}

applyActorSettings(GENERATED_ACTOR_SETTINGS);

export function actorDefinition(id: string): CraftpixActorDefinition | undefined {
  return ACTOR_CATALOG[id];
}

export function enemyActorIds(): string[] {
  return Object.values(ACTOR_CATALOG).filter((actor) => actor.roles?.includes("enemy") && actorHasEnemyStats(actor)).map((actor) => actor.id).sort();
}

export function actorHasEnemyStats(actor: CraftpixActorDefinition | undefined): boolean {
  const stats = actor?.enemyStats;
  return Boolean(stats && Number.isFinite(stats.baseHp) && Number.isFinite(stats.hpPerFloor) && Number.isFinite(stats.damage));
}
