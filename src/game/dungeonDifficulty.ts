/**
 * How hard the dungeon gets, in one place.
 *
 * The rules used to be spread across three files that disagreed with each
 * other: `dungeonThemes.ts` called floor 6 "deep" while `engine.ts` called it
 * floor 7, hit points grew with depth but damage never did, and every floor
 * placed a fixed head count regardless of what was in it.
 *
 * The split is deliberate. **Curves live here** so they can be tested and tuned
 * once. **Identity lives in the data** — an actor declares what kind of thing it
 * is (`archetype`) and how big a deal it is (`tier`), never its own numbers.
 */

export type ActorArchetype = "brute" | "swarm" | "caster" | "lurker";
export type ActorTier = 1 | 2 | 3 | 4 | 5;

export const ACTOR_ARCHETYPES: readonly ActorArchetype[] = ["brute", "swarm", "caster", "lurker"];
export const ACTOR_TIERS: readonly ActorTier[] = [1, 2, 3, 4, 5];

export interface EnemyStats {
  maxHp: number;
  damage: number;
}

/** 通常生成ダンジョンの最深部。町側の潜行シミュレーションとも共有する。 */
export const DUNGEON_MAX_FLOOR = 30;
/** テーマと同じく、戦力も3階をひと区切りとして上がる。 */
export const DIFFICULTY_ZONE_FLOORS = 3;

/** Floor-one values for a tier-one enemy of each kind. */
const ARCHETYPE_BASE: Record<ActorArchetype, EnemyStats> = {
  brute: { maxHp: 5, damage: 2 },
  swarm: { maxHp: 4, damage: 1 },
  caster: { maxHp: 4, damage: 2 },
  lurker: { maxHp: 5, damage: 2 },
};

/** How much bigger a deal each tier is than a tier-one of the same kind. */
const TIER_SCALE: Record<ActorTier, number> = { 1: 1, 2: 1.25, 3: 1.55, 4: 1.9, 5: 2.3 };

/**
 * Depth growth. Hit points climb faster than damage: a deep floor should take
 * longer to clear without turning a single mistake into a death.
 */
export const DEPTH_HP_PER_ZONE = 0.45;
export const DEPTH_DAMAGE_PER_ZONE = 0.24;
/** A champion of its kind, used sparingly by the spawn table. */
export const ELITE_SCALE = 1.8;

export function difficultyZone(floor: number): number {
  return Math.floor(Math.max(0, floor - 1) / DIFFICULTY_ZONE_FLOORS);
}

export function depthScale(floor: number, perZone: number): number {
  return 1 + perZone * difficultyZone(floor);
}

/** The one definition of where the shallow/middle/deep bands start. */
export const DEPTH_BANDS = { middle: 3, deep: 6 } as const;
export type DepthBand = "shallow" | "middle" | "deep";

export function depthBand(floor: number): DepthBand {
  if (floor >= DEPTH_BANDS.deep) return "deep";
  if (floor >= DEPTH_BANDS.middle) return "middle";
  return "shallow";
}

export interface ActorProfile {
  archetype: ActorArchetype;
  tier: ActorTier;
}

/** What an actor of this kind and tier is worth on the given floor. */
export function enemyStatsAt(profile: ActorProfile, floor: number, elite = false): EnemyStats {
  const base = ARCHETYPE_BASE[profile.archetype];
  const tier = TIER_SCALE[profile.tier];
  const champion = elite ? ELITE_SCALE : 1;
  return {
    maxHp: Math.max(1, Math.round(base.maxHp * tier * depthScale(floor, DEPTH_HP_PER_ZONE) * champion)),
    damage: Math.max(1, Math.round(base.damage * tier * depthScale(floor, DEPTH_DAMAGE_PER_ZONE) * champion)),
  };
}

/**
 * What one enemy of a tier costs against a floor's budget. Placing is a
 * spend rather than a head count, so a floor can hold many weak enemies or a
 * few strong ones without the total threat jumping.
 */
const TIER_COST: Record<ActorTier, number> = { 1: 1, 2: 1.5, 3: 2.2, 4: 3, 5: 4 };

export function enemyCost(profile: ActorProfile, elite = false): number {
  return TIER_COST[profile.tier] * (elite ? 2 : 1);
}

/**
 * How much enemy a floor is allowed to hold. Matches the old fixed count for
 * the first six floors, then keeps creeping up instead of flattening.
 */
export function encounterBudget(floor: number): number {
  return 7 + difficultyZone(floor) * 2;
}

/** Legacy per-actor numbers, kept working for actors not yet given a tier. */
export interface LegacyEnemyStats {
  baseHp: number;
  hpPerFloor: number;
  damage: number;
}

export function legacyEnemyStatsAt(stats: LegacyEnemyStats, floor: number): EnemyStats {
  return { maxHp: Math.max(1, stats.baseHp + floor * stats.hpPerFloor), damage: Math.max(1, stats.damage) };
}
