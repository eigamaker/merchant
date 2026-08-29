import { describe, expect, it } from "vitest";
import { CRAFTPIX_ENEMY_ACTORS, CRAFTPIX_ENEMY_POOLS, CRAFTPIX_NPC_ACTORS, CRAFTPIX_PLAYER_ACTOR, actorFrame } from "./craftpixActors";
import { actorDefinition, actorSupportsDirectionalMovement, enemyActorIds } from "./actorCatalog";

describe("Craftpix actor catalog", () => {
  it("defines the supplied 32px directional player and all supplied enemy variants", () => {
    expect(CRAFTPIX_PLAYER_ACTOR.clips.walk?.frameWidth).toBe(32);
    expect(CRAFTPIX_PLAYER_ACTOR.id).toBe("merchant-protagonist");
    expect(CRAFTPIX_PLAYER_ACTOR.clips.walk?.columns).toBe(3);
    expect(CRAFTPIX_PLAYER_ACTOR.scale).toBe(1);
    expect(CRAFTPIX_PLAYER_ACTOR.origin).toEqual({ x: 0.5, y: 0.72 });
    expect(Object.keys(CRAFTPIX_NPC_ACTORS)).toEqual(["swordsman_lvl1", "swordsman_lvl2", "swordsman_lvl3"]);
    expect(CRAFTPIX_NPC_ACTORS.swordsman_lvl3.clips.walk?.path).toContain("Swordsman_lvl3");
    expect(CRAFTPIX_NPC_ACTORS.swordsman_lvl2.clips.runAttack?.path).toContain("Run_Attack");
    expect(Object.keys(CRAFTPIX_ENEMY_ACTORS)).toHaveLength(12);
    expect(CRAFTPIX_ENEMY_POOLS.deep).toContain("vampire3");
    expect([CRAFTPIX_ENEMY_ACTORS.vampire1.id, CRAFTPIX_ENEMY_ACTORS.vampire2.id, CRAFTPIX_ENEMY_ACTORS.vampire3.id]).toEqual(["vampire1", "vampire2", "vampire3"]);
    expect(new Set([CRAFTPIX_ENEMY_ACTORS.vampire1.clips.idle?.path, CRAFTPIX_ENEMY_ACTORS.vampire2.clips.idle?.path, CRAFTPIX_ENEMY_ACTORS.vampire3.clips.idle?.path]).size).toBe(3);
  });

  it("maps four directional rows without guessing at runtime", () => {
    const walk = CRAFTPIX_PLAYER_ACTOR.clips.walk!;
    expect(actorFrame(walk, "down", 0)).toBe(0);
    expect(actorFrame(walk, "up", 0)).toBe(walk.columns);
    expect(actorFrame(walk, "left", 0)).toBe(walk.columns * 2);
    expect(actorFrame(walk, "right", walk.columns - 1)).toBe(walk.columns * 4 - 1);
  });

  it("does not expose action-only mannequin sheets as moving dungeon enemies", () => {
    expect(actorSupportsDirectionalMovement(actorDefinition("characters-attacked"))).toBe(false);
    expect(enemyActorIds()).not.toContain("characters-attacked");
    expect(enemyActorIds()).toContain("orc1");
  });

});
