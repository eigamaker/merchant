import { describe, expect, it } from "vitest";
import { actorEnemyCost, actorEnemyStatsAt, actorProfile, actorDefinition } from "./actorCatalog";
import { buildInitialEnemies } from "./engine";
import { generateDungeonFloor } from "./dungeonGenerator";
import { dungeonThemeEnemyRoster, dungeonThemeSpawns } from "./dungeonThemes";
import {
  DEPTH_BANDS,
  DIFFICULTY_ZONE_FLOORS,
  DUNGEON_MAX_FLOOR,
  ELITE_SCALE,
  depthBand,
  difficultyZone,
  encounterBudget,
  enemyCost,
  enemyStatsAt,
  legacyEnemyStatsAt,
} from "./dungeonDifficulty";

describe("difficulty curve", () => {
  it("grows both hit points and damage with depth", () => {
    const brute = { archetype: "brute", tier: 1 } as const;
    const shallow = enemyStatsAt(brute, 1);
    const deep = enemyStatsAt(brute, 10);
    expect(deep.maxHp).toBeGreaterThan(shallow.maxHp);
    // Damage used to be a flat number no matter how far down the player went.
    expect(deep.damage).toBeGreaterThan(shallow.damage);
    // Hit points climb faster than damage, so deep floors last longer without
    // turning one mistake into a death.
    expect(deep.maxHp / shallow.maxHp).toBeGreaterThan(deep.damage / shallow.damage);
  });

  it("makes a higher tier of the same kind strictly stronger", () => {
    for (const floor of [1, 5, 12]) {
      const low = enemyStatsAt({ archetype: "brute", tier: 1 }, floor);
      const high = enemyStatsAt({ archetype: "brute", tier: 3 }, floor);
      expect(high.maxHp).toBeGreaterThan(low.maxHp);
      expect(high.damage).toBeGreaterThanOrEqual(low.damage);
    }
  });

  it("never drops a stat below one", () => {
    const stats = enemyStatsAt({ archetype: "swarm", tier: 1 }, 1);
    expect(stats.maxHp).toBeGreaterThanOrEqual(1);
    expect(stats.damage).toBeGreaterThanOrEqual(1);
    expect(legacyEnemyStatsAt({ baseHp: 0, hpPerFloor: 0, damage: 0 }, 0)).toEqual({ maxHp: 1, damage: 1 });
  });

  it("scales an elite above its ordinary self and charges more for it", () => {
    const profile = { archetype: "caster", tier: 2 } as const;
    expect(enemyStatsAt(profile, 5, true).maxHp).toBeGreaterThan(enemyStatsAt(profile, 5).maxHp);
    expect(ELITE_SCALE).toBeGreaterThan(1);
    expect(enemyCost(profile, true)).toBeGreaterThan(enemyCost(profile));
  });

  it("has one definition of the depth bands", () => {
    expect(depthBand(1)).toBe("shallow");
    expect(depthBand(DEPTH_BANDS.middle - 1)).toBe("shallow");
    expect(depthBand(DEPTH_BANDS.middle)).toBe("middle");
    expect(depthBand(DEPTH_BANDS.deep - 1)).toBe("middle");
    expect(depthBand(DEPTH_BANDS.deep)).toBe("deep");
  });

  it("raises enemy strength and encounter budget every three floors", () => {
    const brute = { archetype: "brute", tier: 1 } as const;
    expect(DIFFICULTY_ZONE_FLOORS).toBe(3);
    expect(difficultyZone(1)).toBe(difficultyZone(3));
    expect(difficultyZone(4)).toBe(difficultyZone(6));
    expect(enemyStatsAt(brute, 1)).toEqual(enemyStatsAt(brute, 3));
    expect(enemyStatsAt(brute, 4).maxHp).toBeGreaterThan(enemyStatsAt(brute, 3).maxHp);
    expect(encounterBudget(1)).toBe(encounterBudget(3));
    expect(encounterBudget(4)).toBe(encounterBudget(6));
    const budgets = [1, 4, 7, 10, 19, 28].map(encounterBudget);
    for (let index = 1; index < budgets.length; index += 1) expect(budgets[index]!).toBeGreaterThan(budgets[index - 1]!);
  });
});

describe("actor profiles", () => {
  it("derives the built-in enemies from their tier rather than stored numbers", () => {
    const orc1 = actorDefinition("orc1");
    const orc3 = actorDefinition("orc3");
    expect(actorProfile(orc1)).toEqual({ archetype: "brute", tier: 1 });
    // orc1 and orc3 used to carry identical numbers, so the tier meant nothing.
    expect(actorEnemyStatsAt(orc3, 5)!.maxHp).toBeGreaterThan(actorEnemyStatsAt(orc1, 5)!.maxHp);
    expect(actorEnemyCost(orc3)).toBeGreaterThan(actorEnemyCost(orc1));
  });

  it("still honours an actor that only has legacy numbers", () => {
    const legacy = { id: "x", label: "x", clips: {}, scale: 1, origin: { x: 0.5 as const, y: 0.7 }, enemyStats: { baseHp: 4, hpPerFloor: 1, damage: 2 } };
    expect(actorEnemyStatsAt(legacy, 3)).toEqual({ maxHp: 7, damage: 2 });
    expect(actorEnemyCost(legacy)).toBe(1);
    expect(actorEnemyStatsAt(undefined, 3)).toBeUndefined();
  });
});

describe("spawn tables", () => {
  it("offers only the entries whose depth range covers the floor", () => {
    const shallow = dungeonThemeSpawns("cave", 1).map((entry) => entry.actorId);
    const deep = dungeonThemeSpawns("cave", 12).map((entry) => entry.actorId);
    expect(shallow).toContain("slime1");
    expect(shallow).not.toContain("orc3");
    expect(deep).toContain("orc3");
    expect(deep).not.toContain("slime1");
    expect(dungeonThemeEnemyRoster("cave", 1)).toEqual([...new Set(shallow)]);
  });

  it("gives every floor down to the thirtieth something to meet", () => {
    expect(DUNGEON_MAX_FLOOR).toBe(30);
    for (const id of ["cave", "ruins", "lava"]) {
      for (let floor = 1; floor <= DUNGEON_MAX_FLOOR; floor += 1) expect(dungeonThemeSpawns(id, floor).length).toBeGreaterThan(0);
    }
  });

  it("spends a floor's budget instead of placing a fixed head count", () => {
    const shallow = generateDungeonFloor(4242, 1, "cave");
    const deep = generateDungeonFloor(4242, 12, "cave");
    const shallowEnemies = buildInitialEnemies(shallow.map, 1, 4242);
    const deepEnemies = buildInitialEnemies(deep.map, 12, 4242);
    expect(shallowEnemies.length).toBeGreaterThan(0);
    expect(deepEnemies.length).toBeGreaterThan(0);
    // Deep floors hold costlier enemies, so the count does not simply climb.
    const shallowHp = shallowEnemies.reduce((total, enemy) => total + enemy.maxHp, 0);
    const deepHp = deepEnemies.reduce((total, enemy) => total + enemy.maxHp, 0);
    expect(deepHp).toBeGreaterThan(shallowHp);
    expect(deepEnemies.every((enemy) => enemy.damage >= 1 && enemy.maxHp >= 1)).toBe(true);
  });

  it("respects a per-floor cap on a spawn line", () => {
    for (let floor = 10; floor <= 14; floor += 1) {
      const map = generateDungeonFloor(99, floor, "ruins").map;
      const enemies = buildInitialEnemies(map, floor, 99);
      const capped = dungeonThemeSpawns("ruins", floor).filter((entry) => entry.maxPerFloor !== undefined);
      for (const entry of capped) {
        expect(enemies.filter((enemy) => enemy.actorId === entry.actorId).length).toBeLessThanOrEqual(entry.maxPerFloor!);
      }
    }
  });

  it("is deterministic for a given seed and floor", () => {
    const map = generateDungeonFloor(777, 6, "lava").map;
    expect(buildInitialEnemies(map, 6, 777)).toEqual(buildInitialEnemies(map, 6, 777));
  });
});
