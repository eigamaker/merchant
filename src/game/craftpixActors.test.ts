import { describe, expect, it } from "vitest";
import { CRAFTPIX_ENEMY_ACTORS, CRAFTPIX_ENEMY_POOLS, CRAFTPIX_NPC_ACTORS, CRAFTPIX_PLAYER_ACTOR, actorFrame } from "./craftpixActors";

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
  });

  it("maps four directional rows without guessing at runtime", () => {
    const walk = CRAFTPIX_PLAYER_ACTOR.clips.walk!;
    expect(actorFrame(walk, "down", 0)).toBe(0);
    expect(actorFrame(walk, "left", 0)).toBe(walk.columns);
    expect(actorFrame(walk, "up", walk.columns - 1)).toBe(walk.columns * 4 - 1);
  });

});
