import { describe, expect, it } from "vitest";
import {
  acceptQuest,
  beginExpedition,
  createNewGame,
  descend,
  generateDungeon,
  initialOffer,
  returnToTown,
  sellItem,
  useSmokeBomb,
} from "./engine";

function reachableTiles(map: ReturnType<typeof generateDungeon>): Set<string> {
  const visited = new Set<string>();
  const queue = [map.entrance];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const key = `${current.x},${current.y}`;
    if (visited.has(key)) continue;
    visited.add(key);
    for (const direction of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
      const next = { x: current.x + direction.x, y: current.y + direction.y };
      if (next.x >= 0 && next.y >= 0 && next.x < map.width && next.y < map.height && map.tiles[next.y]![next.x] === 0) queue.push(next);
    }
  }
  return visited;
}

describe("dungeon generator", () => {
  it("keeps the entrance and stairs connected across representative seeds", () => {
    for (let seed = 1; seed <= 120; seed += 1) {
      const map = generateDungeon(seed, (seed % 8) + 1, seed % 3 === 0);
      const reachable = reachableTiles(map);
      expect(reachable.has(`${map.stairs.x},${map.stairs.y}`)).toBe(true);
      if (map.specialRoom) expect(reachable.has(`${map.specialRoom.x},${map.specialRoom.y}`)).toBe(true);
    }
  });
});

describe("merchant story loop", () => {
  it("schedules the black sword incident after selling to the duke", () => {
    const state = createNewGame();
    acceptQuest(state, "black-sword");
    beginExpedition(state);
    descend(state);
    descend(state);
    const sword = state.run?.items.find((entry) => entry.item.definitionId === "black-sword")?.item;
    const duke = state.customers.find((customer) => customer.id === "duke");

    expect(sword).toBeDefined();
    expect(duke).toBeDefined();
    if (!sword || !duke) throw new Error("test setup failed");
    state.inventory.push(sword);
    state.story.blackSword = "found";
    expect(initialOffer(state, sword, duke)).toBeGreaterThan(0);

    const result = sellItem(state, sword, "duke");
    expect(result).toContain("売却した");
    expect(state.archive).toContain(sword);
    expect(state.events.some((event) => event.id === "black-sword-incident")).toBe(true);

    returnToTown(state, false);
    expect(state.story.blackSword).toBe("incident");
    expect(state.quests.find((quest) => quest.id === "black-tomb")?.status).toBe("active");
  });

  it("does not lose unique or active-quest items during a rescue", () => {
    const state = createNewGame();
    acceptQuest(state, "black-sword");
    beginExpedition(state);
    descend(state);
    descend(state);
    const runItems = state.run?.items.map((entry) => entry.item) ?? [];
    const sword = runItems.find((item) => item.definitionId === "black-sword");
    const ordinary = runItems.find((item) => item.definitionId !== "black-sword");
    if (!sword || !ordinary) throw new Error("test setup failed");
    state.inventory.push(sword, ordinary);

    returnToTown(state, true);

    expect(state.inventory).toContain(sword);
    expect(state.inventory).not.toContain(ordinary);
  });
});

describe("escape tools", () => {
  it("breaks pursuit with a smoke bomb", () => {
    const state = createNewGame();
    beginExpedition(state);
    const enemy = state.run?.enemies[0];
    if (!enemy || !state.run) throw new Error("test setup failed");
    enemy.pos = { x: state.run.player.x + 1, y: state.run.player.y };
    enemy.state = "chase";

    useSmokeBomb(state);

    expect(state.smokeBombs).toBe(1);
    expect(enemy.state).toBe("patrol");
  });
});
