import type { GameState, InformationReport, KnownReport, PlayerKnowledge, ReportSubject } from "./types";

/**
 * 世界で起きたことと、主人公が知っていることを分ける。
 *
 * 町の一日は主人公の都合と無関係に進む —— それは止めない。止めるのは**報せのほう**である。
 * 地下15階にいる商人へ、町のギルドの掲示が届く道理はない。出来事は起き、報告は積まれ、
 * 主人公が町へ戻ったときに初めて知識になる。
 *
 * だから記録は二重になる。`occurredDay` は起きた日、`learnedDay` は知った日で、
 * この二つが食い違っていることそのものが、この作品の時間の形である。
 */

/** 受け取った報告を残す件数。古いものから落ちる。 */
export const KNOWLEDGE_LOG_LIMIT = 40;

/** 配信待ちで抱える上限。溢れた古い報せは、伝わらないまま流れたものとする。 */
export const PENDING_REPORT_LIMIT = 60;

export function emptyKnowledge(): PlayerKnowledge {
  return { pending: [], received: [], unread: [], deaths: {} };
}

export function ensureKnowledge(state: GameState): PlayerKnowledge {
  state.knowledge ??= emptyKnowledge();
  const knowledge = state.knowledge;
  knowledge.pending ??= [];
  knowledge.received ??= [];
  knowledge.unread ??= [];
  knowledge.deaths ??= {};
  return knowledge;
}

/**
 * 報せが主人公へ届く場所にいるか。
 *
 * 迷宮の底には掲示も酒場も旅商人もいない。届くのは自分が目にしたものだけである。
 */
export function reportsReachNow(state: GameState): boolean {
  return state.location !== "dungeon";
}

/** 報告を配信待ちへ積む。ここではまだ主人公は何も知らない。 */
export function queueReport(
  state: GameState,
  report: Omit<InformationReport, "availableDay" | "reach"> & Partial<Pick<InformationReport, "availableDay" | "reach">>,
): void {
  const knowledge = ensureKnowledge(state);
  const entry: InformationReport = {
    id: report.id,
    occurredDay: report.occurredDay,
    availableDay: report.availableDay ?? report.occurredDay,
    reach: report.reach ?? "town",
    text: report.text,
    ...(report.subject ? { subject: report.subject } : {}),
  };
  // 同じ報せを二度積まない。日をまたいで同じIDが来たら、新しいほうで置き換える。
  const existing = knowledge.pending.findIndex((pending) => pending.id === entry.id);
  if (existing >= 0) knowledge.pending[existing] = entry;
  else knowledge.pending.push(entry);
  if (knowledge.pending.length > PENDING_REPORT_LIMIT) {
    knowledge.pending.splice(0, knowledge.pending.length - PENDING_REPORT_LIMIT);
  }
}

/** 報告が伝えた事実を、機能が読める形で書き留める。 */
function absorbSubject(knowledge: PlayerKnowledge, subject: ReportSubject | undefined, learnedDay: number): void {
  if (subject?.kind !== "npcDeath") return;
  const known = knowledge.deaths[subject.npcId];
  // 一度知った死は上書きしない。最初に聞いた日がその人を失った日である。
  if (known) return;
  knowledge.deaths[subject.npcId] = { learnedDay, ...(subject.floor !== undefined ? { floor: subject.floor } : {}) };
}

function receive(state: GameState, report: InformationReport): KnownReport {
  const knowledge = ensureKnowledge(state);
  const known: KnownReport = {
    id: report.id,
    occurredDay: report.occurredDay,
    learnedDay: state.day,
    text: report.text,
  };
  knowledge.received = knowledge.received.filter((entry) => entry.id !== known.id);
  knowledge.received.push(known);
  knowledge.unread = knowledge.unread.filter((id) => id !== known.id);
  knowledge.unread.push(known.id);
  absorbSubject(knowledge, report.subject, state.day);
  if (knowledge.received.length > KNOWLEDGE_LOG_LIMIT) {
    const dropped = knowledge.received.splice(0, knowledge.received.length - KNOWLEDGE_LOG_LIMIT);
    const droppedIds = new Set(dropped.map((entry) => entry.id));
    knowledge.unread = knowledge.unread.filter((id) => !droppedIds.has(id));
  }
  return known;
}

/**
 * 届く条件を満たした報告を、主人公の知識にする。
 *
 * 地下にいるあいだは町の報せを一つも渡さない。積まれたまま待ち、帰った日にまとめて届く。
 */
export function deliverReports(state: GameState): KnownReport[] {
  const knowledge = ensureKnowledge(state);
  if (!knowledge.pending.length) return [];
  const reachable = reportsReachNow(state);
  const delivered: KnownReport[] = [];
  const held: InformationReport[] = [];
  for (const report of knowledge.pending) {
    if (report.availableDay > state.day) { held.push(report); continue; }
    if (report.reach === "town" && !reachable) { held.push(report); continue; }
    delivered.push(receive(state, report));
  }
  knowledge.pending = held;
  return delivered;
}

/**
 * その場で見たことを知識にする。
 *
 * 目撃は伝達を待たない。遺体を検めた、目の前で倒れた —— そういうものは即座に知る。
 */
export function learnDirectly(
  state: GameState,
  report: Omit<InformationReport, "availableDay" | "reach" | "occurredDay"> & Partial<Pick<InformationReport, "occurredDay">>,
): KnownReport {
  return receive(state, {
    id: report.id,
    occurredDay: report.occurredDay ?? state.day,
    availableDay: state.day,
    reach: "immediate",
    text: report.text,
    ...(report.subject ? { subject: report.subject } : {}),
  });
}

/** 目の前で確かめた死。遺体を検めた場面と、倒れるのを見た場面で使う。 */
export function witnessNpcDeath(state: GameState, npcId: string, name: string, floor: number): void {
  if (knowsNpcDeath(state, npcId)) return;
  learnDirectly(state, {
    id: `death-${npcId}`,
    text: `地下${floor}階で${name}の亡骸を見つけた。`,
    subject: { kind: "npcDeath", npcId, floor },
  });
}

export function knowsNpcDeath(state: GameState, npcId: string): boolean {
  return Boolean(state.knowledge?.deaths?.[npcId]);
}

export function knownDeathFloor(state: GameState, npcId: string): number | undefined {
  return state.knowledge?.deaths?.[npcId]?.floor;
}

export function unreadReportCount(state: GameState): number {
  return state.knowledge?.unread?.length ?? 0;
}

/** 日誌に並べる行。新しいものが先。 */
export function journalEntries(state: GameState, limit = KNOWLEDGE_LOG_LIMIT): KnownReport[] {
  const knowledge = ensureKnowledge(state);
  return [...knowledge.received].reverse().slice(0, Math.max(0, limit));
}

export function markJournalRead(state: GameState): void {
  ensureKnowledge(state).unread = [];
}

/**
 * 日誌の一行。
 *
 * 知った日が発生日より後なら、その隔たりを表に出す —— それが遅れて届いたということである。
 */
export function journalLine(entry: KnownReport): string {
  const delayed = entry.learnedDay > entry.occurredDay;
  const when = delayed
    ? `第${entry.occurredDay}日（第${entry.learnedDay}日に聞いた）`
    : `第${entry.occurredDay}日`;
  return `${when} ${entry.text}`;
}

/**
 * 名簿から消えた人物の死亡記憶を落とす。
 *
 * 剪定で世界から消えた相手をいつまでも覚えていても、もう誰も参照しない。
 */
export function pruneKnowledge(state: GameState, liveNpcIds: ReadonlySet<string>): void {
  const knowledge = ensureKnowledge(state);
  for (const npcId of Object.keys(knowledge.deaths)) {
    if (!liveNpcIds.has(npcId)) delete knowledge.deaths[npcId];
  }
}
