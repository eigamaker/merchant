import type { DungeonCorpse, GameState } from "./types";

/**
 * 迷宮に残された遺体の台帳。
 *
 * 階は探索のたびに作り直されるので、遺体を階に置いたままにはできない。キャンペーン側で
 * 「誰が、どの階で、いつ死に、何が残っているか」だけを持ち、置き場所は毎回決め直す。
 * これがないと、画面外で死んだ顔なじみに二度と行き当たれない。
 */

/** 遺体が見つかる日数。これを過ぎると迷宮に呑まれたものとして台帳から落ちる。 */
export const CORPSE_PERSIST_DAYS = 5;

/** 台帳に残す最大件数。古いものから落ちる。 */
export const CORPSE_LEDGER_LIMIT = 12;

/** 銘や功績を負った品が残っている遺体は、長く待ってくれる。 */
export const KEEPSAKE_PERSIST_DAYS = 14;

/** 物語を背負った品を抱えているか。抱えていれば、迷宮はすぐには呑まない。 */
function holdsKeepsake(state: GameState, lootIds: readonly string[]): boolean {
  return lootIds.some((id) => {
    const item = state.itemsById[id];
    return Boolean(item && (item.currentName || item.deeds));
  });
}

export function persistDaysFor(corpse: DungeonCorpse): number {
  return corpse.keepsake ? KEEPSAKE_PERSIST_DAYS : CORPSE_PERSIST_DAYS;
}

export function recordCorpse(
  state: GameState,
  npcId: string,
  floor: number,
  lootIds: readonly string[],
  stocked: boolean,
): DungeonCorpse {
  const keepsake = holdsKeepsake(state, lootIds);
  const existing = state.dungeonCorpses.find((corpse) => corpse.npcId === npcId);
  if (existing) {
    existing.floor = floor;
    existing.diedDay = state.day;
    existing.lootIds = [...lootIds];
    existing.stocked = stocked;
    if (keepsake) existing.keepsake = true;
    return existing;
  }
  const corpse: DungeonCorpse = { npcId, floor, diedDay: state.day, lootIds: [...lootIds], inspected: false, stocked, ...(keepsake ? { keepsake: true as const } : {}) };
  state.dungeonCorpses.push(corpse);
  return corpse;
}

/** その階でいま見つかる遺体。 */
export function corpsesOnFloor(state: GameState, floor: number): DungeonCorpse[] {
  return state.dungeonCorpses.filter((corpse) => corpse.floor === floor && state.day - corpse.diedDay <= persistDaysFor(corpse));
}

/** 回収された遺品を台帳から外す。空になった遺体は次の剪定で落ちる。 */
export function removeCorpseLoot(state: GameState, npcId: string, itemId: string): void {
  const corpse = state.dungeonCorpses.find((entry) => entry.npcId === npcId);
  if (corpse) corpse.lootIds = corpse.lootIds.filter((id) => id !== itemId);
}

export function markCorpseInspected(state: GameState, npcId: string): void {
  const corpse = state.dungeonCorpses.find((entry) => entry.npcId === npcId);
  if (corpse) corpse.inspected = true;
}

/** まだ回収されていない遺品。剪定がこれを生存扱いにしないと、遺体が空になる。 */
export function corpseLootIds(state: GameState): Set<string> {
  return new Set(state.dungeonCorpses.flatMap((corpse) => corpse.lootIds));
}

/**
 * 台帳を刈る。
 *
 * 日が経ちすぎた遺体、遺品を取り尽くされた遺体、そして上限を超えた古い遺体を落とす。
 * 一度も見つけられなかった遺体も、いずれ迷宮に呑まれる。
 */
export function pruneCorpses(state: GameState): void {
  const alive = state.dungeonCorpses.filter((corpse) => {
    if (state.day - corpse.diedDay > persistDaysFor(corpse)) return false;
    // まだ品を用意していない遺体は、中身が空でも残す（初回の実体化で詰められる）。
    return !corpse.stocked || corpse.lootIds.length > 0;
  });
  // 形見を抱えた遺体は、上限で押し出す最後の候補にする。
  alive.sort((a, b) => Number(Boolean(b.keepsake)) - Number(Boolean(a.keepsake)) || b.diedDay - a.diedDay || a.npcId.localeCompare(b.npcId));
  state.dungeonCorpses = alive.slice(0, CORPSE_LEDGER_LIMIT);
}
