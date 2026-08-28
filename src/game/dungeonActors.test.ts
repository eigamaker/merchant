import { describe, expect, it } from "vitest";
import { beginExpedition, createNewGame } from "./engine";
import { dungeonActorAppearance } from "./dungeonActors";
import { CRAFTPIX_ENEMY_ACTORS } from "./craftpixActors";

const enemyActorIds = new Set(Object.keys(CRAFTPIX_ENEMY_ACTORS));

describe("dungeonActorAppearance", () => {
  it("同行している冒険者を敵として引き当てない", () => {
    const state = createNewGame();
    beginExpedition(state);
    const adventurers = state.run?.adventurers ?? [];
    // 名簿の冒険者はいつ迷宮に出るか決まらないので、名簿側から直接確かめる。
    const roster = state.npcs.filter((npc) => npc.adventurer);
    expect(roster.length).toBeGreaterThan(0);
    for (const npc of [...roster, ...adventurers.map((entry) => state.npcs.find((n) => n.id === entry.npcId)!)]) {
      const appearance = dungeonActorAppearance(state, npc.id);
      expect(appearance).toBeDefined();
      // craftpix の定義を持たない旧来の見た目もあるが、敵に化けることだけは絶対に無い。
      expect(enemyActorIds.has(appearance!)).toBe(false);
    }
  });

  it("敵は自分のアクターに解決する", () => {
    const state = createNewGame();
    beginExpedition(state);
    const enemies = state.run?.enemies ?? [];
    expect(enemies.length).toBeGreaterThan(0);
    for (const enemy of enemies) expect(dungeonActorAppearance(state, enemy.id)).toBe(enemy.actorId);
  });

  it("主人公は主人公のまま、知らないIDには何も返さない", () => {
    const state = createNewGame();
    beginExpedition(state);
    expect(dungeonActorAppearance(state, "player")).toBe("player");
    expect(dungeonActorAppearance(state, "たった今倒された敵")).toBeUndefined();
  });
});
