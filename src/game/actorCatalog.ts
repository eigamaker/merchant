import { CRAFTPIX_ACTORS, type CraftpixActorDefinition } from "./craftpixActors";
import { GENERATED_ACTORS } from "./actorAssetCatalog.generated";
import { GENERATED_ACTOR_SETTINGS } from "./actorSettings.generated";
import type { ActorSettings, ActorSettingsCatalog, NpcActorRole } from "./actorSettings";
import { enemyCost, enemyStatsAt, legacyEnemyStatsAt, type ActorProfile, type EnemyStats } from "./dungeonDifficulty";

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
    ...(settings.archetype ? { archetype: settings.archetype } : {}),
    ...(settings.tier ? { tier: settings.tier } : {}),
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

/**
 * The sheet the protagonist wears.
 *
 * This used to be one hard-coded definition shipped with the game. It is now
 * whichever actor carries the `player` role, so the character settings decide
 * it. Nothing marked leaves this undefined, and the scenes fall back to the
 * legacy sprite rather than drawing nothing.
 */
export function playerActor(): CraftpixActorDefinition | undefined {
  const marked = Object.values(ACTOR_CATALOG).filter((actor) => actor.roles?.includes("player")).sort((a, b) => a.id.localeCompare(b.id));
  return marked[0];
}

/**
 * The sheets an author has approved for a kind of person, in a stable order.
 * The roster picks faces from here rather than from a fixed table, so what
 * walks around town or through the dungeon is always something chosen.
 */
export function npcActorIds(role: NpcActorRole): string[] {
  return Object.values(ACTOR_CATALOG).filter((actor) => actor.roles?.includes(role)).map((actor) => actor.id).sort();
}

export function enemyActorIds(): string[] {
  return Object.values(ACTOR_CATALOG).filter((actor) => actor.roles?.includes("enemy") && actorHasEnemyStats(actor) && actorSupportsDirectionalMovement(actor)).map((actor) => actor.id).sort();
}

/** An actor can fight if it has a tier profile, or legacy numbers of its own. */
export function actorHasEnemyStats(actor: CraftpixActorDefinition | undefined): boolean {
  if (actorProfile(actor)) return true;
  const stats = actor?.enemyStats;
  return Boolean(stats && Number.isFinite(stats.baseHp) && Number.isFinite(stats.hpPerFloor) && Number.isFinite(stats.damage));
}

export function actorProfile(actor: CraftpixActorDefinition | undefined): ActorProfile | undefined {
  return actor?.archetype && actor.tier ? { archetype: actor.archetype, tier: actor.tier } : undefined;
}

/** What this actor is worth on a floor. Prefers the shared curve over old numbers. */
export function actorEnemyStatsAt(actor: CraftpixActorDefinition | undefined, floor: number, elite = false): EnemyStats | undefined {
  const profile = actorProfile(actor);
  if (profile) return enemyStatsAt(profile, floor, elite);
  const stats = actor?.enemyStats;
  return stats ? legacyEnemyStatsAt(stats, floor) : undefined;
}

/** Cost against a floor's encounter budget; legacy actors count as one tier-one. */
export function actorEnemyCost(actor: CraftpixActorDefinition | undefined, elite = false): number {
  const profile = actorProfile(actor);
  return profile ? enemyCost(profile, elite) : 1;
}

/** Dungeon actors must not swap between a fallback sprite and an action-only sheet. */
export function actorSupportsDirectionalMovement(actor: CraftpixActorDefinition | undefined): boolean {
  const idle = actor?.clips.idle;
  const walk = actor?.clips.walk;
  return Boolean(idle && walk && idle.rows === 4 && walk.rows === 4
    && idle.directions.length === 4 && walk.directions.length === 4);
}
