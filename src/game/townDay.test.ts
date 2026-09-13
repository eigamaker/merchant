import { describe, expect, it } from "vitest";
import { beginExpedition, createItem, createNewGame } from "./engine";
import { restUntilMorning } from "./merchantSystems";
import { FLOOR_ADVENTURER_MAX, MEDICINE_SAVE_BAND, announceSingularFind, delveDeathChance, noteSeenOnFloor, preferredDelveFloor, resolveDelveOutcome, simulateTownDay } from "./townDay";
import { adventurerStanding } from "./adventurerRanking";
import { knowsNpcDeath } from "./playerKnowledge";
import { ensureGuardProfile } from "./guardProfiles";
import { ADVENTURER_ROSTER_TARGET } from "./npcRoster";
import { backExpedition, createExpedition, expeditionDueDay, expeditionReportId, isExpeditionOverdue, quoteBacking } from "./expeditions";
import { escortFeeForNpc } from "./merchantEconomy";
import { ADVENTURER_RANKS } from "./merchantContent";
import { DUNGEON_MAX_FLOOR } from "./dungeonDifficulty";
import type { GameState, NpcRecord, NpcStatus } from "./types";

/** 夜まで進めてから寝る。町の一日が回る唯一の入口。 */
function sleepUntilNextMorning(state: GameState): void {
  state.timeSlot = "evening";
  restUntilMorning(state);
}

describe("delve outcomes", () => {
  const base = { rank: "C" as const, floor: 12, hpRatio: 1, courage: 50, discipline: 50, roll: 0.06 };

  it("gets deadlier the further past the recommended depth they go", () => {
    // 同じ出目でも、深くなるほど悪い結末へ倒れる。
    expect(resolveDelveOutcome({ ...base, floor: 12 })).toBe("returned");
    expect(resolveDelveOutcome({ ...base, floor: 14 })).not.toBe("returned");
    expect(resolveDelveOutcome({ ...base, floor: 16, roll: 0.2 })).toBe("died");
  });

  it("rewards courage and discipline with survival", () => {
    const reckless = { ...base, floor: 16, courage: 10, discipline: 10, roll: 0.28 };
    expect(resolveDelveOutcome(reckless)).toBe("died");
    expect(resolveDelveOutcome({ ...reckless, courage: 95, discipline: 95 })).not.toBe("died");
  });

  it("makes a wounded delver likelier to die", () => {
    const wounded = { ...base, hpRatio: 0.2, roll: 0.06 };
    expect(resolveDelveOutcome(wounded)).toBe("died");
    expect(resolveDelveOutcome({ ...wounded, hpRatio: 1 })).not.toBe("died");
  });

  it("sends braver adventurers deeper than their rank suggests", () => {
    const state = createNewGame();
    const npc = state.npcs.find((entry) => entry.adventurer)!;
    npc.rank = "C";
    const profile = ensureGuardProfile(state, npc);
    profile.personality.courage = 95;
    const bold = preferredDelveFloor(npc, profile, 0.5);
    profile.personality.courage = 5;
    const timid = preferredDelveFloor(npc, profile, 0.5);
    expect(bold).toBeGreaterThan(timid);
    expect(preferredDelveFloor(npc, profile, 0)).toBeGreaterThanOrEqual(1);
    expect(preferredDelveFloor(npc, profile, 1)).toBeLessThanOrEqual(DUNGEON_MAX_FLOOR);
  });

  it("keeps even A-rank adventurers near their limit at the bottom", () => {
    expect(ADVENTURER_RANKS.A.recommendedFloor).toBeLessThan(DUNGEON_MAX_FLOOR);
    const result = resolveDelveOutcome({
      rank: "A",
      floor: DUNGEON_MAX_FLOOR,
      hpRatio: 1,
      courage: 75,
      discipline: 75,
      gearPower: 6,
      roll: 0.2,
    });
    expect(result).not.toBe("returned");
  });
});

describe("the town turns on its own", () => {
  it("starts each floor with half as many adventurers as before", () => {
    expect(FLOOR_ADVENTURER_MAX).toBe(1);
  });

  it("runs a given day exactly once", () => {
    const state = createNewGame();
    state.day += 1;
    simulateTownDay(state);
    const after = JSON.stringify(state.npcs);
    simulateTownDay(state);
    expect(JSON.stringify(state.npcs)).toBe(after);
  });

  it("reproduces the same day from the same save", () => {
    const first = createNewGame();
    const second = JSON.parse(JSON.stringify(first)) as GameState;
    first.day += 1;
    second.day += 1;
    simulateTownDay(first);
    simulateTownDay(second);
    expect(JSON.stringify(second.npcs)).toBe(JSON.stringify(first.npcs));
  });

  it("never resolves someone standing beside the merchant", () => {
    const state = createNewGame();
    expect(beginExpedition(state)).toBe(true);
    const run = state.run!;
    const beside = run.adventurers.map((entry) => entry.npcId);
    const guardId = run.guard?.guardId;
    const before = new Map(state.npcs.map((npc) => [npc.id, npc.status]));

    state.day += 1;
    simulateTownDay(state);

    for (const npcId of [...beside, ...(guardId ? [guardId] : [])]) {
      expect(state.npcs.find((npc) => npc.id === npcId)?.status).toBe(before.get(npcId));
    }
  });

  it("leaves nobody stuck past the plan they declared", () => {
    const state = createNewGame();
    for (let night = 0; night < 6; night += 1) sleepUntilNextMorning(state);
    // 自発的な潜行はすべて予定日数1なので、予定日を越えて潜りっぱなしの者は出ない。
    const stale = state.npcs.filter((npc) => npc.status === "delving"
      && (npc.expedition === undefined || state.day > expeditionDueDay(npc.expedition)));
    expect(stale).toEqual([]);
    expect(state.npcs.every((npc) => npc.status !== "delving" || npc.expedition !== undefined)).toBe(true);
  });

  it("keeps people moving between the town and the dungeon", () => {
    const state = createNewGame();
    for (let night = 0; night < 8; night += 1) sleepUntilNextMorning(state);
    const statuses = new Set(state.npcs.filter((npc) => npc.adventurer).map((npc) => npc.status));
    // 町が空にも満員にもならず、潜っている者と町にいる者が同時にいる。
    expect(statuses.has("delving")).toBe(true);
    expect(statuses.has("inTown")).toBe(true);
    const inTown = state.npcs.filter((npc) => npc.adventurer && npc.status === "inTown").length;
    expect(inTown).toBeGreaterThanOrEqual(5);
  });
});

describe("newcomers arrive to fill the gaps", () => {
  it("never invites more people than the roster is short of", () => {
    const state = createNewGame();
    for (let night = 0; night < 20; night += 1) {
      sleepUntilNextMorning(state);
      // 道中の新人を含めても、名簿は目標人数を超えない。満員の町へ新人は来ない。
      const committed = state.npcs.filter((npc) => npc.adventurer && npc.status !== "dead").length;
      expect(committed).toBeLessThanOrEqual(ADVENTURER_ROSTER_TARGET);
    }
  });

  it("announces a newcomer before they walk in", () => {
    const state = createNewGame();
    // 名簿を大きく削り、補充が必ず起きる状態にする。
    for (const npc of state.npcs.filter((entry) => entry.adventurer).slice(0, 14)) npc.status = "dead";

    let arrival: { npcId: string } | undefined;
    for (let night = 0; night < 12 && !arrival; night += 1) {
      sleepUntilNextMorning(state);
      const event = state.events.find((entry) => entry.effect?.kind === "arrival");
      if (event?.effect?.kind === "arrival") arrival = event.effect;
    }
    expect(arrival).toBeDefined();

    // 到着日までは町の一員ではない。護衛候補にも客にも出てこない。
    const traveller = state.npcs.find((npc) => npc.id === arrival!.npcId)!;
    expect(traveller.status).toBe("traveling");

    for (let night = 0; night < 6 && traveller.status === "traveling"; night += 1) sleepUntilNextMorning(state);
    expect(traveller.status).toBe("inTown");
  });

  it("keeps a long campaign staffed", () => {
    const state = createNewGame("long-campaign");
    for (let night = 0; night < 60; night += 1) sleepUntilNextMorning(state);
    const living = state.npcs.filter((npc) => npc.adventurer && npc.status !== "dead").length;
    expect(living).toBeGreaterThanOrEqual(20);
    expect(living).toBeLessThanOrEqual(40);
    expect(JSON.stringify(state).length).toBeLessThan(60_000);
  });
});

describe("famous newcomers", () => {
  it("lets a rumour reach town before the person does", () => {
    // 有名枠は低確率なので、キャンペーンを振り直して一件見つける。
    let found: { state: GameState; npcId: string } | undefined;
    for (let attempt = 0; attempt < 40 && !found; attempt += 1) {
      const state = createNewGame();
      state.campaignId = `famous-${attempt}`;
      for (const npc of state.npcs.filter((entry) => entry.adventurer).slice(0, 16)) npc.status = "dead";
      for (let night = 0; night < 20 && !found; night += 1) {
        sleepUntilNextMorning(state);
        const famous = state.npcs.find((npc) => npc.famous);
        if (famous) found = { state, npcId: famous.id };
      }
    }
    expect(found).toBeDefined();

    const { state, npcId } = found!;
    const newcomer = state.npcs.find((npc) => npc.id === npcId)!;
    // 噂が先に立っている：雇う前から実績があり、その分だけ護衛料が高い。
    expect(["A", "B"]).toContain(newcomer.rank);
    expect(newcomer.guardProfile!.career.successfulReturns).toBeGreaterThan(0);
    expect(newcomer.guardProfile!.career.deepestFloor).toBeGreaterThanOrEqual(6);
    // 評判はあっても面識はない。観察記録は雇うまで開かない。
    expect(newcomer.guardProfile!.career.hireCount).toBe(0);
    expect(escortFeeForNpc(state, newcomer)).toBeGreaterThan(ADVENTURER_RANKS[newcomer.rank!].escortFee);
  });
});

describe("一品物の噂", () => {
  it("初めて持ち帰った日に噂が立ち、蒐集家が町へ向かう", () => {
    const state = createNewGame();
    const blade = createItem(state, "nameless-black-blade", 7);

    expect(announceSingularFind(state, blade)).toBe(true);
    const collector = state.npcs.find((npc) => npc.profession === "collector");
    expect(collector).toBeDefined();
    // 噂が本人より先に届く。訪ねてくるのは数日後。
    expect(collector!.status).toBe("traveling");
    expect(state.events.some((event) => event.id.startsWith("singular-rumour-"))).toBe(true);
    const arrival = state.events.find((event) => event.effect?.kind === "arrival" && event.effect.npcId === collector!.id);
    expect(arrival?.dueDay).toBeGreaterThan(state.day);

    // 二人目は来ない。一品物が客層を開くのは、その一度だけである。
    expect(announceSingularFind(state, blade)).toBe(false);
    expect(state.npcs.filter((npc) => npc.profession === "collector")).toHaveLength(1);
  });

  it("ありふれた品では誰も動かない", () => {
    const state = createNewGame();
    const sword = createItem(state, "iron-sword", 3);
    expect(announceSingularFind(state, sword)).toBe(false);
    expect(state.npcs.some((npc) => npc.profession === "collector")).toBe(false);
  });
});

describe("the merchant's medicine, out of sight", () => {
  /** 商人が渡した薬を一本持たせる。 */
  function handMedicine(state: GameState, npc: NpcRecord, definitionId = "field-flask"): void {
    const medicine = createItem(state, definitionId);
    medicine.owner = npc.id;
    medicine.location = { kind: "npcInventory", npcId: npc.id };
    medicine.merchantOrigin = "sold";
    medicine.merchantDay = state.day;
    npc.inventoryIds.push(medicine.uuid);
  }

  /** その日その人を、危うい深さへ潜らせて決着させる。乱数は日付とIDから決まる。 */
  function runDelve(base: GameState, npcId: string, day: number, hand?: (state: GameState, npc: NpcRecord) => void): { status: NpcStatus; state: GameState } {
    const state = structuredClone(base);
    state.day = day;
    state.lastSimulatedDay = day - 1;
    const npc = state.npcs.find((entry) => entry.id === npcId)!;
    npc.status = "delving";
    npc.expedition = createExpedition(npc, day - 1, DUNGEON_MAX_FLOOR, 1);
    npc.conditionHp = 1;
    hand?.(state, npc);
    simulateTownDay(state);
    return { status: state.npcs.find((entry) => entry.id === npcId)!.status, state };
  }

  /** 素手なら死ぬ日を探す。薬を持たせたときにどうなるかで、帯の内か外かが分かる。 */
  function findDeadlyDay(base: GameState, npcId: string, savedByMedicine: boolean): number {
    for (let day = base.day + 1; day < base.day + 300; day += 1) {
      if (runDelve(base, npcId, day).status !== "dead") continue;
      const rescued = runDelve(base, npcId, day, (state, npc) => handMedicine(state, npc)).status !== "dead";
      if (rescued === savedByMedicine) return day;
    }
    throw new Error("該当する日が見つからなかった");
  }

  function victim(state: GameState): NpcRecord {
    return state.npcs.filter((npc) => npc.adventurer && npc.id.startsWith("adventurer-"))[0]!;
  }

  it("spends a charge of the merchant's medicine instead of dying", () => {
    const base = createNewGame();
    const npc = victim(base);
    const day = findDeadlyDay(base, npc.id, true);

    const { status, state } = runDelve(base, npc.id, day, (inner, entry) => handMedicine(inner, entry));

    expect(status).toBe("recovering");
    const flask = Object.values(state.itemsById).find((item) => item.definitionId === "field-flask")!;
    // 携行薬瓶は5回ぶん。一口だけ減り、まだ手元にある。
    expect(flask.chargesLeft).toBe(4);
    expect(state.events.some((event) => event.id.startsWith(`medicine-${npc.id}-`))).toBe(true);
  });

  it("does not spend a potion the merchant never sold", () => {
    const base = createNewGame();
    const npc = victim(base);
    const day = findDeadlyDay(base, npc.id, true);

    // 同じ日、同じ薬。ただし出どころが無い —— 迷宮で自分が拾った一本である。
    const { status } = runDelve(base, npc.id, day, (state, entry) => {
      const potion = createItem(state, "field-flask");
      potion.owner = entry.id;
      potion.location = { kind: "npcInventory", npcId: entry.id };
      entry.inventoryIds.push(potion.uuid);
    });

    expect(status).toBe("dead");
  });

  it("cannot buy back a death that was never close", () => {
    const base = createNewGame();
    const npc = victim(base);
    // 帯の外で死ぬ日。薬を持たせても覆らない。
    const day = findDeadlyDay(base, npc.id, false);

    const { status, state } = runDelve(base, npc.id, day, (inner, entry) => handMedicine(inner, entry));

    expect(status).toBe("dead");
    // 覆らなかったのだから、薬も減らない。
    const flask = Object.values(state.itemsById).find((item) => item.definitionId === "field-flask")!;
    expect(flask.chargesLeft).toBeUndefined();
  });

  it("keeps delveDeathChance and resolveDelveOutcome in agreement", () => {
    for (const rank of ["E", "C", "A"] as const) {
      for (const floor of [1, 8, 20]) {
        for (const hpRatio of [0.2, 1]) {
          const input = { rank, floor, hpRatio, courage: 50, discipline: 50, gearPower: 4 };
          const death = delveDeathChance(input);
          expect(resolveDelveOutcome({ ...input, roll: death - 0.0001 })).toBe("died");
          expect(resolveDelveOutcome({ ...input, roll: death })).not.toBe("died");
          // 帯の下half は薬でも覆せない領域である。
          expect(death * MEDICINE_SAVE_BAND).toBeLessThan(death);
        }
      }
    }
  });
});

describe("backing a multi-day expedition", () => {
  /** 町にいて、まだ遠征に出ていない冒険者。 */
  function candidate(state: GameState): NpcRecord {
    return state.npcs.find((npc) => npc.adventurer && npc.status === "inTown")!;
  }

  it("sends them out on a declared plan and takes the food money once", () => {
    const state = createNewGame();
    const npc = candidate(state);
    const recommended = ADVENTURER_RANKS[npc.rank ?? "E"].recommendedFloor;
    const quote = quoteBacking(state, npc, recommended);
    const purse = state.gold;

    expect(backExpedition(state, npc, recommended).ok).toBe(true);

    expect(state.gold).toBe(purse - quote.cost);
    expect(npc.status).toBe("delving");
    expect(npc.expedition).toMatchObject({ declaredFloor: recommended, departedDay: state.day });
    expect(npc.expedition!.backing?.paidGold).toBe(quote.cost);
    // 二重には送り出せない。
    expect(backExpedition(state, npc, recommended).ok).toBe(false);
  });

  it("refuses a depth that is out of the question, and charges nothing for asking", () => {
    const state = createNewGame();
    const npc = candidate(state);
    const profile = ensureGuardProfile(state, npc);
    Object.assign(profile.personality, { courage: 0 });
    profile.stress = 100;
    const purse = state.gold;

    const result = backExpedition(state, npc, DUNGEON_MAX_FLOOR);

    expect(result.ok).toBe(false);
    expect(state.gold).toBe(purse);
    expect(npc.expedition).toBeUndefined();
    expect(npc.status).toBe("inTown");
  });

  it("stays underground until the declared day, then settles once", () => {
    const state = createNewGame();
    const npc = candidate(state);
    // 予定日数が2日以上になる深さを選ぶ。
    const deep = ADVENTURER_RANKS[npc.rank ?? "E"].recommendedFloor + 2;
    const quote = quoteBacking(state, npc, deep);
    expect(quote.plannedDays).toBeGreaterThan(1);
    Object.assign(ensureGuardProfile(state, npc).personality, { courage: 100 });
    ensureGuardProfile(state, npc).trust = 100;
    expect(backExpedition(state, npc, deep).ok).toBe(true);
    const due = expeditionDueDay(npc.expedition!);

    // 予定日の前日までは、まだ地下にいる。
    while (state.day < due) {
      sleepUntilNextMorning(state);
      if (state.day < due) expect(npc.status).toBe("delving");
    }

    // 予定日の朝に一度だけ決着する。
    expect(npc.status).not.toBe("delving");
    expect(npc.expedition?.outcome ?? "returned").not.toBe(undefined);
  });

  it("says the return is overdue once the promised day has passed", () => {
    const state = createNewGame();
    const npc = candidate(state);
    npc.expedition = createExpedition(npc, state.day - 3, 5, 1);
    npc.status = "delving";

    // 予定日を過ぎている。掲示は、実際の居場所ではなく予定の超過を言う。
    expect(isExpeditionOverdue(state, npc.expedition)).toBe(true);
    expect(adventurerStanding(state, npc).status).toContain("帰還予定日を過ぎている");
  });

  it("does not leak where they actually are while they are still out", () => {
    const state = createNewGame();
    const npc = candidate(state);
    npc.expedition = createExpedition(npc, state.day, 4, 3);
    npc.status = "delving";
    // 実際には深くまで行っている。掲示が読むのは告げられた目標だけ。
    npc.expedition.reachedFloor = 19;

    expect(adventurerStanding(state, npc).status).toContain("地下4階");
    expect(adventurerStanding(state, npc).status).not.toContain("19");
  });

  it("keeps the promised day readable after a death nobody has heard about", () => {
    const state = createNewGame();
    const npc = candidate(state);
    npc.expedition = createExpedition(npc, state.day - 5, 8, 1);
    npc.expedition.outcome = "died";
    npc.status = "dead";

    // 訃報は届いていない。それでも「戻る予定だった日」は商人が出発時に聞いている。
    expect(knowsNpcDeath(state, npc.id)).toBe(false);
    expect(adventurerStanding(state, npc).status).toContain("戻る予定だった");
  });

  it("reports a backed return, and stays quiet about the ordinary ones", () => {
    // 生還は確率なので、生きて帰るキャンペーンを一つ探してから確かめる。
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const state = createNewGame();
      state.campaignId = `backed-${attempt}`;
      const npc = candidate(state);
      const recommended = ADVENTURER_RANKS[npc.rank ?? "E"].recommendedFloor;
      Object.assign(ensureGuardProfile(state, npc).personality, { courage: 100, discipline: 100 });
      expect(backExpedition(state, npc, recommended).ok).toBe(true);
      const expeditionId = expeditionReportId(npc, npc.expedition!);

      for (let night = 0; night < 6 && npc.status === "delving"; night += 1) sleepUntilNextMorning(state);
      if (npc.status !== "inTown") continue;

      // 支援した相手の生還は、必ず一行返ってくる。これが無いと支援に手応えが無い。
      const told = state.knowledge.received.some((entry) => entry.id === `${expeditionId}-returned`)
        || state.knowledge.pending.some((entry) => entry.id === `${expeditionId}-returned`);
      expect(told).toBe(true);
      return;
    }
    throw new Error("生還するキャンペーンが見つからなかった");
  });

  it("says nothing when an unbacked delver walks home", () => {
    const state = createNewGame();
    for (let night = 0; night < 6; night += 1) sleepUntilNextMorning(state);
    // 自分の判断で出た潜行は、帰っても報せにならない。毎日何人も決着するので、
    // 全部届けば日誌が埋まる。
    const chatter = [...state.knowledge.received, ...state.knowledge.pending]
      .filter((entry) => entry.id.endsWith("-returned"));
    expect(chatter).toEqual([]);
  });

  it("remembers the floor where the merchant actually met them", () => {
    const state = createNewGame();
    const npc = candidate(state);
    npc.expedition = createExpedition(npc, state.day, 2, 1);
    npc.status = "delving";

    noteSeenOnFloor(npc, 9);

    expect(npc.expedition.reachedFloor).toBe(9);
    // 決着がこの階を読むように、告げた目標も引き上げる —— 出発時の古い2階ではない。
    expect(npc.expedition.declaredFloor).toBe(9);
  });

  it("forgets the plan of someone who walked back into town", () => {
    const state = createNewGame();
    const npc = candidate(state);
    const recommended = ADVENTURER_RANKS[npc.rank ?? "E"].recommendedFloor;
    Object.assign(ensureGuardProfile(state, npc).personality, { courage: 100, discipline: 100 });
    expect(backExpedition(state, npc, recommended).ok).toBe(true);

    for (let night = 0; night < 6 && npc.status === "delving"; night += 1) sleepUntilNextMorning(state);

    // 生きて戻った相手の予定表は、もう誰も読まない。死んだ場合だけ残す。
    if (npc.status !== "dead") expect(npc.expedition).toBeUndefined();
    else expect(npc.expedition?.outcome).toBe("died");
  });
});
