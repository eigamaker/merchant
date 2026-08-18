import { CRAFTPIX_ACTORS, type CraftpixActorDefinition } from "./craftpixActors";
import { GENERATED_ACTORS } from "./actorAssetCatalog.generated";

export const ACTOR_CATALOG: Record<string, CraftpixActorDefinition> = Object.fromEntries([
  ...Object.entries(CRAFTPIX_ACTORS),
  ...GENERATED_ACTORS.map((actor) => [actor.id, actor]),
]);

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
