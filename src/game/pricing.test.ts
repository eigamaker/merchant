import { describe, expect, it } from "vitest";
import { createItem, createNewGame } from "./engine";
import { DUNGEON_PRICE_CEILING, GOUGE_THRESHOLD, dungeonVerdict, gougeSentiment, marketPrice, shopVerdict } from "./pricing";
import type { GuardPersonality, NpcRecord } from "./types";

const personality = (over: Partial<GuardPersonality>): GuardPersonality => ({
  archetype: "steadfast", courage: 50, discipline: 50, empathy: 50, integrity: 50, greed: 50, ...over,
});

const buyer = (state: ReturnType<typeof createNewGame>): NpcRecord => state.npcs.find((npc) => npc.id === "godwin")!;

describe("店の値付け", () => {
  it("上限の内なら買い、少し超えれば値切り、大きく超えればよそへ行く", () => {
    const state = createNewGame();
    const npc = buyer(state);
    expect(shopVerdict(npc, 100, 120).reaction).toBe("buy");
    expect(shopVerdict(npc, 120, 120).reaction).toBe("buy");
    expect(shopVerdict(npc, 130, 120).reaction).toBe("haggle");
    expect(shopVerdict(npc, 200, 120).reaction).toBe("refuse");
  });

  it("値切りの言い値は客の上限より下になる", () => {
    const state = createNewGame();
    const verdict = shopVerdict(buyer(state), 130, 120);
    // 上限ちょうどではなく、その下を言ってくる。吹っかけが得にならないための一手。
    expect(verdict.price).toBe(102);
    expect(verdict.line).toContain("102G");
  });

  it("相場は品の由来ぶんだけ上がる", () => {
    const state = createNewGame();
    const plain = createItem(state, "iron-sword", 1);
    const storied = createItem(state, "iron-sword", 1);
    storied.historyV2 = [
      { day: 1, type: "named", npcId: "x", name: "冬雷", detail: "" },
      { day: 2, type: "ownerDied", npcId: "x", detail: "" },
      { day: 3, type: "lootedFromCorpse", npcId: "x", detail: "" },
    ];
    storied.deeds = { deepestFloor: 8, kills: 30, returns: 4, ownersLost: 1, stage: 3 };
    expect(marketPrice(storied)).toBeGreaterThan(marketPrice(plain));
  });
});

describe("迷宮の値付け", () => {
  it("困っている相手には定価の何倍でも通る", () => {
    const state = createNewGame();
    const npc = buyer(state);
    const desperate = dungeonVerdict(npc, 100 * DUNGEON_PRICE_CEILING, 100, 9999, true, personality({}));
    expect(desperate.reaction).toBe("buy");
  });

  it("困っていない相手は上乗せに付き合わない", () => {
    const state = createNewGame();
    const npc = buyer(state);
    expect(dungeonVerdict(npc, 500, 100, 9999, false, personality({})).reaction).toBe("refuse");
    expect(dungeonVerdict(npc, 100, 100, 9999, false, personality({})).reaction).toBe("buy");
  });

  it("手持ちを超える額は誰も払えない", () => {
    const state = createNewGame();
    expect(dungeonVerdict(buyer(state), 500, 100, 300, true, personality({})).reaction).toBe("refuse");
  });

  it("足元を見た商いの受け取り方は性格で変わる", () => {
    const markup = GOUGE_THRESHOLD + 1;
    // 命の重さを知っている冒険者は、高値を当然として受け取る。
    expect(gougeSentiment(personality({ discipline: 80, integrity: 80 }), markup, true)).toBe("grateful");
    // 自分が強欲な者は、出し抜かれたと感じる。
    expect(gougeSentiment(personality({ greed: 80, discipline: 30, integrity: 30 }), markup, true)).toBe("resented");
    // どちらでもない者は、払って忘れる。
    expect(gougeSentiment(personality({ discipline: 40, integrity: 45, greed: 40 }), markup, true)).toBe("indifferent");
    // 上乗せが小さければ、そもそも足元を見たことにならない。
    expect(gougeSentiment(personality({ greed: 90 }), 1.2, true)).toBe("fair");
  });

  it("恨まれる相手に売ると、その一件が縁として残る", () => {
    const state = createNewGame();
    const npc = buyer(state);
    const verdict = dungeonVerdict(npc, 500, 100, 9999, true, personality({ greed: 80, discipline: 30, integrity: 30 }));
    expect(verdict.reaction).toBe("buy");
    expect(verdict.sentiment).toBe("resented");
  });
});
