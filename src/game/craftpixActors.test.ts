import { describe, expect, it } from "vitest";
import { CRAFTPIX_ACTORS, CRAFTPIX_ENEMY_ACTORS, CRAFTPIX_ENEMY_POOLS, CRAFTPIX_NPC_ACTORS, actorFrame } from "./craftpixActors";
import { ACTOR_CATALOG, actorDefinition, actorSupportsDirectionalMovement, enemyActorIds, playerActor } from "./actorCatalog";
import { HUMAN_DIRECTION_ROWS, MONSTER_DIRECTION_ROWS } from "./craftpixActors";
import fs from "node:fs";
import { PNG } from "pngjs";

describe("Craftpix actor catalog", () => {
  it("ships no protagonist of its own and all supplied enemy variants", () => {
    // The player sheet is chosen in the character settings, so the built-in
    // table carries only the cast that comes with the packs.
    expect(Object.keys(CRAFTPIX_ACTORS)).not.toContain("player");
    expect(Object.keys(CRAFTPIX_ACTORS)).not.toContain("merchant-protagonist");
    expect(Object.keys(CRAFTPIX_NPC_ACTORS)).toEqual(["swordsman_lvl1", "swordsman_lvl2", "swordsman_lvl3"]);
    expect(CRAFTPIX_NPC_ACTORS.swordsman_lvl3.clips.walk?.path).toContain("Swordsman_lvl3");
    expect(CRAFTPIX_NPC_ACTORS.swordsman_lvl2.clips.runAttack?.path).toContain("Run_Attack");
    expect(Object.keys(CRAFTPIX_ENEMY_ACTORS)).toHaveLength(12);
    expect(CRAFTPIX_ENEMY_POOLS.deep).toContain("vampire3");
    expect([CRAFTPIX_ENEMY_ACTORS.vampire1.id, CRAFTPIX_ENEMY_ACTORS.vampire2.id, CRAFTPIX_ENEMY_ACTORS.vampire3.id]).toEqual(["vampire1", "vampire2", "vampire3"]);
    expect(new Set([CRAFTPIX_ENEMY_ACTORS.vampire1.clips.idle?.path, CRAFTPIX_ENEMY_ACTORS.vampire2.clips.idle?.path, CRAFTPIX_ENEMY_ACTORS.vampire3.clips.idle?.path]).size).toBe(3);
  });

  it("takes the protagonist from whichever sheet is marked as the player", () => {
    const chosen = playerActor();
    expect(chosen).toBeDefined();
    expect(chosen!.roles).toContain("player");
    // One sheet should claim the role. More than one and the first by id wins,
    // which is a silent choice rather than an authored one.
    expect(Object.values(ACTOR_CATALOG).filter((actor) => actor.roles?.includes("player")).map((actor) => actor.id)).toEqual([chosen!.id]);
  });

  it("maps four directional rows without guessing at runtime", () => {
    // The packs disagree about row order, so each family is pinned separately.
    const monster = CRAFTPIX_ENEMY_ACTORS.orc1.clips.walk!;
    expect(monster.directions).toEqual(MONSTER_DIRECTION_ROWS);
    expect(actorFrame(monster, "down", 0)).toBe(0);
    expect(actorFrame(monster, "up", 0)).toBe(monster.columns);
    expect(actorFrame(monster, "left", 0)).toBe(monster.columns * 2);
    expect(actorFrame(monster, "right", monster.columns - 1)).toBe(monster.columns * 4 - 1);

    const human = CRAFTPIX_NPC_ACTORS.swordsman_lvl1.clips.walk!;
    expect(human.directions).toEqual(HUMAN_DIRECTION_ROWS);
    expect(actorFrame(human, "down", 0)).toBe(0);
    expect(actorFrame(human, "left", 0)).toBe(human.columns);
    expect(actorFrame(human, "right", 0)).toBe(human.columns * 2);
    expect(actorFrame(human, "up", human.columns - 1)).toBe(human.columns * 4 - 1);
  });

  it("declares the row order the art actually uses", () => {
    // A sheet's two side rows are near-exact horizontal mirrors of each other,
    // which is what identifies them. Reading the declared order back onto the
    // pixels is the check that would have caught the sides being taken for the
    // back: it fails the moment a sheet is replaced with a differently ordered one.
    const mirrorScore = (png: PNG, size: number, a: number, b: number): number => {
      let same = 0;
      for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
        const p = ((a * size + y) * png.width + x) * 4;
        const q = ((b * size + y) * png.width + (size - 1 - x)) * 4;
        if (Math.abs(png.data[p + 3]! - png.data[q + 3]!) > 40) continue;
        if (png.data[p + 3]! <= 40) { same += 1; continue; }
        const delta = Math.abs(png.data[p]! - png.data[q]!) + Math.abs(png.data[p + 1]! - png.data[q + 1]!) + Math.abs(png.data[p + 2]! - png.data[q + 2]!);
        if (delta <= 90) same += 1;
      }
      return same / (size * size);
    };
    for (const actor of [CRAFTPIX_ENEMY_ACTORS.orc1, CRAFTPIX_NPC_ACTORS.swordsman_lvl1]) {
      const idle = actor.clips.idle!;
      const png = PNG.sync.read(fs.readFileSync(`public/${idle.path}`));
      const rowOf = (direction: "down" | "up" | "left" | "right") => idle.directions.indexOf(direction);
      const sides = mirrorScore(png, idle.frameHeight, rowOf("left"), rowOf("right"));
      const frontBack = mirrorScore(png, idle.frameHeight, rowOf("down"), rowOf("up"));
      expect(sides).toBeGreaterThan(frontBack);
      expect(sides).toBeGreaterThan(0.9);
    }
  });

  it("does not expose action-only mannequin sheets as moving dungeon enemies", () => {
    expect(actorSupportsDirectionalMovement(actorDefinition("characters-attacked"))).toBe(false);
    expect(enemyActorIds()).not.toContain("characters-attacked");
    expect(enemyActorIds()).toContain("orc1");
  });

});
