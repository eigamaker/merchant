import { describe, expect, it } from "vitest";
import { createNewGame } from "./engine";
import { RANKING_BOARD_SIZE, adventurerStanding, rankAdventurers, rankingLine } from "./adventurerRanking";
import { ensureGuardProfile } from "./guardProfiles";
import type { GameState, NpcRecord } from "./types";

const adventurers = (state: GameState): NpcRecord[] => state.npcs.filter((npc) => npc.adventurer);

describe("adventurerRanking", () => {
  it("等級が見出しになり、同じ等級では深さが上に来る", () => {
    const state = createNewGame();
    const [first, second] = adventurers(state);
    first!.rank = "C";
    second!.rank = "C";
    ensureGuardProfile(state, first!).career.soloDeepest = 3;
    ensureGuardProfile(state, second!).career.soloDeepest = 7;
    for (const npc of adventurers(state).slice(2)) npc.rank = "E";

    const board = rankAdventurers(state, 4);
    const top = board.findIndex((entry) => entry.npcId === second!.id);
    const below = board.findIndex((entry) => entry.npcId === first!.id);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThan(below);
    expect(board[top]!.deepestFloor).toBe(7);
  });

  it("掲示の人数は指定した数で頭打ちになる", () => {
    const state = createNewGame();
    expect(adventurers(state).length).toBeGreaterThan(RANKING_BOARD_SIZE);
    expect(rankAdventurers(state)).toHaveLength(RANKING_BOARD_SIZE);
    expect(rankAdventurers(state, 3)).toHaveLength(3);
  });

  it("死んだ者は遺体が迷宮にあるあいだだけ「消息不明」として残る", () => {
    const state = createNewGame();
    const npc = adventurers(state)[0]!;
    npc.rank = "A";
    npc.status = "dead";
    state.dungeonCorpses.push({ npcId: npc.id, floor: 6, diedDay: state.day, lootIds: [], inspected: false, stocked: false });

    const listedNow = rankAdventurers(state, 30).find((entry) => entry.npcId === npc.id);
    expect(listedNow?.status).toBe("地下6階で消息不明");
    expect(listedNow?.standing).toBe("missing");

    // 遺体が迷宮に呑まれれば掲示からも消える。
    state.day += 30;
    expect(rankAdventurers(state, 30).find((entry) => entry.npcId === npc.id)).toBeUndefined();
  });

  it("いま何をしているかが状態として出る", () => {
    const state = createNewGame();
    const npc = adventurers(state)[0]!;

    npc.status = "inTown";
    expect(adventurerStanding(state, npc).status).toBe("町に滞在中");

    npc.status = "delving";
    npc.delve = { floor: 4, departedDay: state.day };
    expect(adventurerStanding(state, npc)).toEqual({ standing: "away", status: "地下4階へ潜行中" });

    npc.delve = undefined;
    npc.status = "recovering";
    expect(adventurerStanding(state, npc).status).toBe("療養中");

    npc.status = "escorting";
    expect(adventurerStanding(state, npc).status).toBe("あなたの護衛");

    npc.status = "inTown";
    npc.retainedSince = state.day;
    expect(adventurerStanding(state, npc).status).toBe("お抱え");
  });

  it("掲示の一行に順位・名前・等級・状態が収まる", () => {
    const state = createNewGame();
    const entry = rankAdventurers(state, 1)[0]!;
    const line = rankingLine(entry, 1);
    expect(line).toContain(entry.name);
    expect(line).toContain(`（${entry.rank}）`);
    expect(line).toContain(entry.status);
    // 640x360 の窓に収まる長さであること。
    expect(line.length).toBeLessThanOrEqual(44);
  });
});

describe("recentLosses", () => {
  it("遺体が消えた者は弔いの欄へ移り、日が経てば掲示から消える", async () => {
    const { createNewGame } = await import("./engine");
    const { ensureGuardProfile } = await import("./guardProfiles");
    const { MEMORIAL_DAYS, recentLosses } = await import("./adventurerRanking");
    const state = createNewGame();
    const npc = state.npcs.find((entry) => entry.adventurer)!;
    npc.status = "dead";
    const career = ensureGuardProfile(state, npc).career;
    career.deathDay = state.day;
    career.deathFloor = 5;

    // 遺体が迷宮にあるあいだは序列表側（消息不明）に出るので、弔いの欄には出ない。
    state.dungeonCorpses.push({ npcId: npc.id, floor: 5, diedDay: state.day, lootIds: [], inspected: false, stocked: false });
    expect(recentLosses(state).some((entry) => entry.npcId === npc.id)).toBe(false);

    state.dungeonCorpses = [];
    const lost = recentLosses(state).find((entry) => entry.npcId === npc.id);
    expect(lost?.standing).toBe("lost");
    expect(lost?.status).toContain("地下5階で還らず");
    expect(rankAdventurers(state, 30).some((entry) => entry.npcId === npc.id)).toBe(false);

    state.day += MEMORIAL_DAYS + 1;
    expect(recentLosses(state).some((entry) => entry.npcId === npc.id)).toBe(false);
  });
});
