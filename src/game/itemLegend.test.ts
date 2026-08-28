import { describe, expect, it } from "vitest";
import { createItem, createNewGame } from "./engine";
import {
  DEPTH_EPITHETS,
  LEGEND_PREFIXES,
  emptyDeeds,
  itemDeeds,
  itemLegendLines,
  legendName,
  legendStage,
  legendStem,
  refreshItemLegend,
} from "./itemLegend";
import type { GameState, ItemInstance } from "./types";

function makeItem(state: GameState, definitionId: string): ItemInstance {
  return createItem(state, definitionId);
}

describe("legend stages", () => {
  it("opens at real depth or a real tally", () => {
    expect(legendStage({ ...emptyDeeds() })).toBe(0);
    expect(legendStage({ ...emptyDeeds(), deepestFloor: 2, kills: 7 })).toBe(0);
    expect(legendStage({ ...emptyDeeds(), deepestFloor: 3 })).toBe(1);
    expect(legendStage({ ...emptyDeeds(), kills: 8 })).toBe(1);
    expect(legendStage({ ...emptyDeeds(), deepestFloor: 6 })).toBe(2);
    expect(legendStage({ ...emptyDeeds(), kills: 25 })).toBe(2);
  });

  it("only calls it a keepsake if it had a name to lose", () => {
    // 無銘のまま誰かと共に失われた品は、遺品ではあっても形見ではない。
    expect(legendStage({ ...emptyDeeds(), ownersLost: 1 })).toBe(0);
    expect(legendStage({ ...emptyDeeds(), deepestFloor: 3, ownersLost: 1 })).toBe(3);
  });
});

describe("legend names", () => {
  it("gives a rare blade its own word at stage one", () => {
    const state = createNewGame();
    const blade = makeItem(state, "nameless-black-blade");
    const deeds = { ...emptyDeeds(), deepestFloor: 3 };
    const name = legendName(state.campaignId, blade, deeds, 1)!;
    expect(name).toMatch(/の剣$/);
    expect(LEGEND_PREFIXES.some((prefix) => name.startsWith(prefix))).toBe(true);
  });

  it("leaves an ordinary sword unnamed until it goes deep", () => {
    const state = createNewGame();
    const sword = makeItem(state, "iron-sword");
    // 段1の「鉄の剣」は定義名と同じ。ありふれた剣が銘を得るのは深さにおいてである。
    expect(legendName(state.campaignId, sword, { ...emptyDeeds(), deepestFloor: 3 }, 1)).toBeUndefined();
    const deep = legendName(state.campaignId, sword, { ...emptyDeeds(), deepestFloor: 8 }, 2)!;
    expect(deep).toMatch(/の鉄剣$/);
    expect(DEPTH_EPITHETS.some((epithet) => deep.startsWith(epithet))).toBe(true);
  });

  it("uses the right noun for a spear", () => {
    const state = createNewGame();
    const spear = makeItem(state, "bronze-spear");
    // 接尾辞を「の剣」に決め打ちしていた頃、銘入りの槍は「黒風の剣」と呼ばれていた。
    expect(legendName(state.campaignId, spear, { ...emptyDeeds(), deepestFloor: 8 }, 2)).toMatch(/の青銅槍$/);
  });

  it("keeps the same word through every stage", () => {
    const state = createNewGame();
    const blade = makeItem(state, "nameless-black-blade");
    const stem = legendStem(state.campaignId, blade);
    expect(legendName(state.campaignId, blade, { ...emptyDeeds(), deepestFloor: 3 }, 1)).toContain(stem);
    expect(legendName(state.campaignId, blade, { ...emptyDeeds(), deepestFloor: 8 }, 2)).toContain(stem);
    expect(legendName(state.campaignId, blade, { ...emptyDeeds(), deepestFloor: 8, ownersLost: 1 }, 3)).toContain(stem);
  });
});

describe("inscribing", () => {
  it("records one history entry per stage and never renames backwards", () => {
    const state = createNewGame();
    const blade = makeItem(state, "nameless-black-blade");

    itemDeeds(blade).deepestFloor = 3;
    expect(refreshItemLegend(state, blade)).toBe(true);
    const first = blade.currentName!;

    // 同じ功績で二度打ち直さない。
    expect(refreshItemLegend(state, blade)).toBe(false);
    expect(blade.currentName).toBe(first);

    itemDeeds(blade).deepestFloor = 8;
    expect(refreshItemLegend(state, blade)).toBe(true);
    const second = blade.currentName!;
    expect(second).not.toBe(first);

    itemDeeds(blade).ownersLost = 1;
    expect(refreshItemLegend(state, blade)).toBe(true);

    const named = (blade.historyV2 ?? []).filter((event) => event.type === "named");
    expect(named).toHaveLength(3);
    expect(named.map((event) => "name" in event && event.name)).toEqual([first, second, blade.currentName]);
    expect(blade.knowledge).toBe("identified");
  });

  it("reads the story back for the detail panel", () => {
    const state = createNewGame();
    const blade = makeItem(state, "nameless-black-blade");
    Object.assign(itemDeeds(blade), { deepestFloor: 8, kills: 37 });
    refreshItemLegend(state, blade);

    const lines = itemLegendLines(state, blade);
    expect(lines[0]).toContain("銘:");
    expect(lines[1]).toContain("地下8階まで担がれ");
    expect(lines[1]).toContain("37体を退けた");
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  it("says nothing about a sword that has done nothing", () => {
    const state = createNewGame();
    expect(itemLegendLines(state, makeItem(state, "iron-sword"))).toEqual([]);
  });
});
