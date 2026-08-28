import type { BondKind, GameState, NpcBond, NpcRecord } from "./types";

/** 1人あたりに残す縁の件数。古いものから落ちる。 */
export const BOND_MEMORY_PER_NPC = 8;

/**
 * 名簿を離れた人物を覚えていられる人数。
 *
 * 生きている冒険者は全員が名簿に残るので、ここで数えるのは主に故人。
 * 縁が新しい順に残し、古い縁から忘れていく。
 */
export const REMEMBERED_ABSENT_LIMIT = 12;

/**
 * 語るべき縁の強さ。同じ相手に複数の縁があるとき、どれを見出しにするかを決める。
 * 生死に関わるものが先、商いだけの関係が後。
 */
const BOND_WEIGHT: Record<BondKind, number> = {
  lost: 5,
  gouged: 4,
  foughtTogether: 4,
  entrusted: 3,
  aided: 3,
  looted: 2,
  traded: 1,
  served: 0,
};

export function npcBonds(npc: NpcRecord): readonly NpcBond[] {
  return npc.bonds ?? [];
}

export function hasBond(npc: NpcRecord): boolean {
  return (npc.bonds?.length ?? 0) > 0;
}

/** 最後に縁が生まれた日。まだ縁がなければ undefined。 */
export function latestBondDay(npc: NpcRecord): number | undefined {
  const bonds = npcBonds(npc);
  return bonds.length ? Math.max(...bonds.map((bond) => bond.day)) : undefined;
}

export function recordBond(
  state: GameState,
  npc: NpcRecord,
  kind: BondKind,
  detail: string,
  floor?: number,
): NpcBond {
  const bond: NpcBond = { day: state.day, kind, detail, ...(floor === undefined ? {} : { floor }) };
  npc.bonds ??= [];
  npc.bonds.push(bond);
  if (npc.bonds.length > BOND_MEMORY_PER_NPC) {
    npc.bonds.splice(0, npc.bonds.length - BOND_MEMORY_PER_NPC);
  }
  return bond;
}

/** 見出しに使う一件。重みが同じなら新しい方を採る。 */
export function principalBond(npc: NpcRecord): NpcBond | undefined {
  return npcBonds(npc).reduce<NpcBond | undefined>((best, bond) => {
    if (!best) return bond;
    const weight = BOND_WEIGHT[bond.kind] - BOND_WEIGHT[best.kind];
    if (weight > 0) return bond;
    if (weight === 0 && bond.day >= best.day) return bond;
    return best;
  }, undefined);
}

function headline(bond: NpcBond): string {
  const where = bond.floor ? `地下${bond.floor}階で` : "";
  switch (bond.kind) {
    case "lost": return "護衛の最中に亡くした相手";
    case "foughtTogether": return `${where}背中を預けた相手`;
    case "entrusted": return "武器防具を預けた相手";
    case "aided": return `${where}薬を譲った相手`;
    case "looted": return "遺体から遺品を引き取った相手";
    case "gouged": return `${where}足元を見られた相手`;
    case "traded": return `${where}取引した相手`;
    case "served": return "店で品を買ってくれた客";
  }
}

/** 契約画面や取引画面に一行で出す縁。まだ何もなければ undefined。 */
export function bondSummary(npc: NpcRecord): string | undefined {
  const principal = principalBond(npc);
  if (!principal) return undefined;
  const total = npcBonds(npc).length;
  return total > 1 ? `${headline(principal)}（縁 ${total}件）` : headline(principal);
}

/**
 * 忘れずにおく人物を選ぶ。
 *
 * 縁が新しい順。同じ日ならIDの昇順で、同じ状態からは必ず同じ結果になる。
 */
export function retainedNpcIds(
  candidates: readonly NpcRecord[],
  limit = REMEMBERED_ABSENT_LIMIT,
): Set<string> {
  return new Set(
    [...candidates]
      .sort((a, b) => (latestBondDay(b) ?? 0) - (latestBondDay(a) ?? 0) || a.id.localeCompare(b.id))
      .slice(0, Math.max(0, limit))
      .map((npc) => npc.id),
  );
}
