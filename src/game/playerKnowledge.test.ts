import { describe, expect, it } from "vitest";
import { beginExpedition, createNewGame, returnHome } from "./engine";
import { advanceTime, consumeDungeonTime, restUntilMorning } from "./merchantSystems";
import {
  KNOWLEDGE_LOG_LIMIT,
  deliverReports,
  journalEntries,
  journalLine,
  knowsNpcDeath,
  markJournalRead,
  queueReport,
  unreadReportCount,
  witnessNpcDeath,
} from "./playerKnowledge";
import { adventurerStanding, rankAdventurers } from "./adventurerRanking";
import type { GameState } from "./types";

const firstAdventurer = (state: GameState) => state.npcs.find((npc) => npc.adventurer)!;

describe("報せの到達", () => {
  it("地下にいるあいだ町の報せは一つも届かない", () => {
    const state = createNewGame();
    expect(beginExpedition(state)).toBe(true);
    queueReport(state, { id: "news-1", occurredDay: state.day, text: "町で騒ぎがあった。" });

    expect(deliverReports(state)).toHaveLength(0);
    expect(state.knowledge.pending).toHaveLength(1);
    expect(state.knowledge.received).toHaveLength(0);
  });

  it("帰還した日に、待っていた報せがまとめて届く", () => {
    const state = createNewGame();
    beginExpedition(state);
    queueReport(state, { id: "news-1", occurredDay: state.day, text: "町で騒ぎがあった。" });
    queueReport(state, { id: "news-2", occurredDay: state.day, text: "旅商人が着いた。" });
    // 地下で日をまたいでも、町の報せは積まれるだけで渡らない。
    consumeDungeonTime(state, 200);
    expect(state.knowledge.received).toHaveLength(0);

    returnHome(state);
    expect(state.knowledge.received.map((entry) => entry.id)).toEqual(["news-1", "news-2"]);
    expect(state.knowledge.pending).toHaveLength(0);
  });

  it("起きた日と知った日の両方が残る", () => {
    const state = createNewGame();
    beginExpedition(state);
    const occurredDay = state.day;
    queueReport(state, { id: "news-1", occurredDay, text: "顔なじみが地下へ向かった。" });
    consumeDungeonTime(state, 200);
    returnHome(state);

    const entry = state.knowledge.received[0]!;
    expect(entry.occurredDay).toBe(occurredDay);
    expect(entry.learnedDay).toBeGreaterThan(occurredDay);
    expect(journalLine(entry)).toContain(`第${occurredDay}日（第${entry.learnedDay}日に聞いた）`);
  });

  it("町にいるなら、その日のうちに届く", () => {
    const state = createNewGame();
    queueReport(state, { id: "news-1", occurredDay: state.day, text: "店先に張り紙があった。" });
    const [delivered] = deliverReports(state);
    expect(delivered?.occurredDay).toBe(delivered?.learnedDay);
  });

  it("噂が伝わるまでの間は availableDay で置ける", () => {
    const state = createNewGame();
    queueReport(state, { id: "news-1", occurredDay: state.day, availableDay: state.day + 2, text: "遠い町の話。" });
    expect(deliverReports(state)).toHaveLength(0);
    state.day += 2;
    expect(deliverReports(state)).toHaveLength(1);
  });
});

describe("世界の変化は待たない", () => {
  it("主人公が地下にいても、町への到着はその日に起きる", () => {
    const state = createNewGame();
    const newcomer = state.npcs.find((npc) => npc.status === "traveling")
      ?? (() => { const npc = firstAdventurer(state); npc.status = "traveling"; return npc; })();
    state.events.push({
      id: `arrival-${newcomer.id}`,
      dueDay: state.day + 1,
      text: `${newcomer.name}が町へ着いた。`,
      effect: { kind: "arrival", npcId: newcomer.id },
    });
    beginExpedition(state);
    consumeDungeonTime(state, 200);

    // 世界では着いている。しかし商人はまだ知らない。
    expect(state.npcs.find((npc) => npc.id === newcomer.id)!.status).toBe("inTown");
    expect(state.knowledge.received).toHaveLength(0);
    expect(state.knowledge.pending.some((report) => report.id === `arrival-${newcomer.id}`)).toBe(true);
  });
});

describe("死を知るということ", () => {
  it("訃報が届くまで、序列表は死んだ相手の階を漏らさない", () => {
    const state = createNewGame();
    const npc = firstAdventurer(state);
    npc.status = "dead";

    expect(knowsNpcDeath(state, npc.id)).toBe(false);
    expect(adventurerStanding(state, npc)).toEqual({ standing: "away", status: "消息を聞かない" });

    const listed = rankAdventurers(state, 30).find((entry) => entry.npcId === npc.id);
    expect(listed?.status).toBe("消息を聞かない");
    expect(listed?.diedDay).toBeUndefined();
  });

  it("遺体を見つければ、報せを待たずにその場で知る", () => {
    const state = createNewGame();
    const npc = firstAdventurer(state);
    npc.status = "dead";
    beginExpedition(state);

    witnessNpcDeath(state, npc.id, npc.name, 7);

    expect(knowsNpcDeath(state, npc.id)).toBe(true);
    expect(state.knowledge.deaths[npc.id]?.floor).toBe(7);
    expect(state.knowledge.received.at(-1)?.text).toContain("地下7階");
  });

  it("一度知った死は、後から来た報せで上書きされない", () => {
    const state = createNewGame();
    const npc = firstAdventurer(state);
    witnessNpcDeath(state, npc.id, npc.name, 7);
    const learnedDay = state.knowledge.deaths[npc.id]!.learnedDay;

    state.day += 5;
    queueReport(state, {
      id: `death-${npc.id}-late`,
      occurredDay: state.day,
      text: "ギルドに報せがあった。",
      subject: { kind: "npcDeath", npcId: npc.id, floor: 2 },
    });
    deliverReports(state);

    expect(state.knowledge.deaths[npc.id]).toEqual({ learnedDay, floor: 7 });
  });

  it("画面外で死んだ顔なじみの訃報は、帰った日に届いて掲示へ出る", () => {
    const state = createNewGame();
    const npc = firstAdventurer(state);
    npc.status = "dead";
    state.events.push({
      id: `death-${npc.id}`,
      dueDay: state.day,
      text: `${npc.name}が地下5階から戻らなかった。`,
      subject: { kind: "npcDeath", npcId: npc.id, floor: 5 },
    });
    state.dungeonCorpses.push({ npcId: npc.id, floor: 5, diedDay: state.day, lootIds: [], inspected: false, stocked: false });

    beginExpedition(state);
    consumeDungeonTime(state, 200);
    expect(adventurerStanding(state, npc).status).toBe("消息を聞かない");

    returnHome(state);
    expect(knowsNpcDeath(state, npc.id)).toBe(true);
    expect(adventurerStanding(state, npc)).toEqual({ standing: "missing", status: "地下5階で消息不明" });
  });
});

describe("日誌", () => {
  it("未読の件数が数えられ、読めば消える", () => {
    const state = createNewGame();
    queueReport(state, { id: "news-1", occurredDay: state.day, text: "一件目。" });
    queueReport(state, { id: "news-2", occurredDay: state.day, text: "二件目。" });
    deliverReports(state);

    expect(unreadReportCount(state)).toBe(2);
    markJournalRead(state);
    expect(unreadReportCount(state)).toBe(0);
    // 読んでも記録そのものは残る。
    expect(journalEntries(state)).toHaveLength(2);
  });

  it("新しい報せが先に並ぶ", () => {
    const state = createNewGame();
    queueReport(state, { id: "news-1", occurredDay: state.day, text: "古い話。" });
    deliverReports(state);
    state.day += 1;
    queueReport(state, { id: "news-2", occurredDay: state.day, text: "新しい話。" });
    deliverReports(state);

    expect(journalEntries(state).map((entry) => entry.id)).toEqual(["news-2", "news-1"]);
  });

  it("受け取った報せは上限を超えて溜まらない", () => {
    const state = createNewGame();
    for (let index = 0; index < KNOWLEDGE_LOG_LIMIT + 20; index += 1) {
      queueReport(state, { id: `news-${index}`, occurredDay: state.day, text: `${index}件目。` });
      deliverReports(state);
    }
    expect(state.knowledge.received).toHaveLength(KNOWLEDGE_LOG_LIMIT);
    expect(state.knowledge.unread.length).toBeLessThanOrEqual(KNOWLEDGE_LOG_LIMIT);
  });

  it("同じ報せを二度積んでも一度しか届かない", () => {
    const state = createNewGame();
    queueReport(state, { id: "news-1", occurredDay: state.day, text: "一度目。" });
    queueReport(state, { id: "news-1", occurredDay: state.day, text: "言い直し。" });
    expect(deliverReports(state)).toHaveLength(1);
    expect(state.knowledge.received).toHaveLength(1);
  });
});

describe("町での一日", () => {
  it("宿で朝を迎えれば、その朝までの報せが届く", () => {
    const state = createNewGame();
    queueReport(state, { id: "news-1", occurredDay: state.day, text: "夜のうちに報せがあった。" });
    restUntilMorning(state);
    expect(state.knowledge.received.some((entry) => entry.id === "news-1")).toBe(true);
    expect(state.message).toContain("夜のうちに報せがあった。");
  });

  it("町で日をまたぐと、その日の報せがその場で届く", () => {
    const state = createNewGame();
    queueReport(state, { id: "news-1", occurredDay: state.day, text: "店に張り紙が出た。" });
    advanceTime(state, 4);
    expect(state.knowledge.received.some((entry) => entry.id === "news-1")).toBe(true);
  });
});
