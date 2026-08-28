import { persistDaysFor } from "./dungeonCorpses";
import { ADVENTURER_RANKS, ADVENTURER_RANK_ORDER } from "./merchantContent";
import { isRetained } from "./npcGear";
import type { AdventurerRank, GameState, NpcRecord } from "./types";

/**
 * ギルドの序列表。
 *
 * 町の冒険者を等級と実績で並べ、いま誰がどこにいるかを一枚に収める。
 * 死んだ者は「消息不明」として、遺体がまだ迷宮にあるあいだだけ残る ——
 * 掲示を見て取りに行ける相手だけが載る、という約束である。
 */

export const RANKING_BOARD_SIZE = 8;

/** 掲示に名が残る日数。遺体が迷宮に呑まれても、町はしばらく覚えている。 */
export const MEMORIAL_DAYS = 30;

export type AdventurerStanding = "town" | "away" | "missing" | "lost";

export interface RankedAdventurer {
  npcId: string;
  name: string;
  rank: AdventurerRank;
  /** 到達した最も深い階。護衛としても、自分の潜行でも数える。 */
  deepestFloor: number;
  /** 生きて帰った回数。 */
  survivals: number;
  standing: AdventurerStanding;
  /** 掲示に書かれる短い状態。 */
  status: string;
  /** 商人が縁を持つ相手。掲示では印を付ける。 */
  acquainted: boolean;
  /** 亡くなった日。生きている者には無い。 */
  diedDay?: number;
}

function deedsOf(npc: NpcRecord): { deepestFloor: number; survivals: number } {
  const career = npc.guardProfile?.career;
  if (!career) return { deepestFloor: 0, survivals: 0 };
  return {
    deepestFloor: Math.max(career.deepestFloor, career.soloDeepest, career.deathFloor ?? 0),
    survivals: career.successfulReturns + career.soloDelves,
  };
}

/** その遺体がまだ迷宮にあるか。掲示に「消息不明」で残せるのはこのあいだだけ。 */
function restingPlace(state: GameState, npcId: string): number | undefined {
  const corpse = state.dungeonCorpses.find((entry) => entry.npcId === npcId);
  if (!corpse) return undefined;
  return state.day - corpse.diedDay <= persistDaysFor(corpse) ? corpse.floor : undefined;
}

export function adventurerStanding(state: GameState, npc: NpcRecord): { standing: AdventurerStanding; status: string } {
  if (npc.status === "dead") {
    // 遺体がまだ迷宮にあるあいだは「消息不明」—— 取りに行けば連れ戻せる。
    const floor = restingPlace(state, npc.id);
    if (floor !== undefined) return { standing: "missing", status: `地下${floor}階で消息不明` };
    const career = npc.guardProfile?.career;
    const where = career?.deathFloor ? `地下${career.deathFloor}階で` : "";
    return { standing: "lost", status: career?.deathDay ? `第${career.deathDay}日 ${where}還らず` : `${where}還らず` };
  }
  if (npc.status === "escorting" || npc.status === "contracted") {
    return { standing: "away", status: isRetained(npc) ? "お抱え・同行中" : "あなたの護衛" };
  }
  if (isRetained(npc)) return { standing: "town", status: "お抱え" };
  if (npc.status === "delving" || npc.delve) {
    const floor = npc.delve?.floor ?? ADVENTURER_RANKS[npc.rank ?? "E"].recommendedFloor;
    return { standing: "away", status: `地下${floor}階へ潜行中` };
  }
  if (npc.status === "recovering") return { standing: "town", status: "療養中" };
  if (npc.status === "traveling") return { standing: "away", status: "町へ向かっている" };
  return { standing: "town", status: "町に滞在中" };
}

/** 序列表に載る資格。生きているか、まだ迷宮から連れ戻せるか。 */
function listed(state: GameState, npc: NpcRecord): boolean {
  if (!npc.adventurer) return false;
  return npc.status !== "dead" || restingPlace(state, npc.id) !== undefined;
}

/** 遺体はもう迷宮に無いが、町がまだ覚えている者。序列表ではなく弔いの欄に載る。 */
export function recentLosses(state: GameState, withinDays: number = MEMORIAL_DAYS): RankedAdventurer[] {
  return state.npcs
    .filter((npc) => npc.adventurer && npc.status === "dead" && restingPlace(state, npc.id) === undefined)
    .filter((npc) => {
      const died = npc.guardProfile?.career.deathDay;
      return died !== undefined && state.day - died <= withinDays;
    })
    .map((npc) => describe(state, npc))
    .sort((a, b) => (b.diedDay ?? 0) - (a.diedDay ?? 0) || a.name.localeCompare(b.name, "ja"));
}

function describe(state: GameState, npc: NpcRecord): RankedAdventurer {
  const deeds = deedsOf(npc);
  const { standing, status } = adventurerStanding(state, npc);
  return {
    npcId: npc.id,
    name: npc.name,
    rank: npc.rank ?? "E",
    deepestFloor: deeds.deepestFloor,
    survivals: deeds.survivals,
    standing,
    status,
    acquainted: (npc.bonds?.length ?? 0) > 0,
    diedDay: npc.guardProfile?.career.deathDay,
  } satisfies RankedAdventurer;
}

export function rankAdventurers(state: GameState, limit: number = RANKING_BOARD_SIZE): RankedAdventurer[] {
  const entries = state.npcs.filter((npc) => listed(state, npc)).map((npc) => describe(state, npc));
  // 等級が見出しで、その中では潜った深さと生還数がものを言う。同点は名前で固定する。
  entries.sort((a, b) =>
    ADVENTURER_RANK_ORDER.indexOf(b.rank) - ADVENTURER_RANK_ORDER.indexOf(a.rank)
    || b.deepestFloor - a.deepestFloor
    || b.survivals - a.survivals
    || a.name.localeCompare(b.name, "ja"));
  return entries.slice(0, Math.max(0, limit));
}

/** 掲示の一行。順位・名前・等級・実績・状態。 */
export function rankingLine(entry: RankedAdventurer, position: number): string {
  const deeds = entry.deepestFloor > 0 ? `最深${entry.deepestFloor}階 生還${entry.survivals}` : "記録なし";
  return `${String(position).padStart(2, " ")}位 ${entry.acquainted ? "◆" : "　"}${entry.name}（${entry.rank}）${deeds}　${entry.status}`;
}
