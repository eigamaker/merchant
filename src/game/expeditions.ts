import { ADVENTURER_RANKS } from "./merchantContent";
import { ensureGuardProfile } from "./guardProfiles";
import { recordBond } from "./npcBonds";
import { gearPower } from "./npcGear";
import { DUNGEON_MAX_FLOOR } from "./dungeonDifficulty";
import { isAvailableInTown } from "./merchantEconomy";
import { SUPPLY_RULES } from "./merchantSystems";
import type { Expedition, GameState, NpcRecord } from "./types";

/**
 * 冒険者の遠征。
 *
 * 自分の判断で出ていく日々の潜行と、商人が支援して送り出す数日がかりの遠征を、
 * **一つの型で扱う。** 前者は `plannedDays: 1` にすぎない。
 *
 * ここに置くのは「計画を立てる」側だけである。日ごとに進めて決着させるのは
 * 町の一日の仕事なので [townDay.ts](./townDay.ts) にある。
 */

/** 支援して延ばせる日数の上限。長いほど深くを狙えるが、そのぶん帰らない。 */
export const MAX_PLANNED_DAYS = 4;

/** 一日ぶんの食料として持たせる数。`SUPPLY_RULES.provisions.price` で値段が付く。 */
export const PROVISIONS_PER_EXPEDITION_DAY = 2;

/** 支援を断る危険度の境目。`assessGuardDescent` と同じ考え方で測る。 */
export const BACKING_REFUSAL_RISK = 50;

/**
 * 推奨階を1つ超えるごとに増える危険度。
 *
 * 推奨+2なら誰でも頷き、推奨+4は**信頼を積んだ相手しか受けない**。この幅が
 * 出るように選んだ数字である —— 急すぎると深い選択肢が誰にも押せない飾りになり、
 * 緩すぎると顔も知らない相手が最深部へ歩いていく。
 */
export const BACKING_RISK_PER_FLOOR = 16;

/** 帰還予定日。この日に決着し、過ぎても報せが無ければ掲示は「帰還遅延」と言う。 */
export function expeditionDueDay(expedition: Expedition): number {
  return expedition.departedDay + expedition.plannedDays;
}

/** まだ出ている遠征か。決着した記録は残り続けるので、状態ではなくこれで判定する。 */
export function isExpeditionActive(expedition: Expedition | undefined): expedition is Expedition {
  return expedition !== undefined && expedition.outcome === undefined;
}

/** 帰還予定日を過ぎているか。予定は商人自身が出発時に知っているので、知識の有無を問わない。 */
export function isExpeditionOverdue(state: GameState, expedition: Expedition | undefined): boolean {
  return expedition !== undefined && state.day > expeditionDueDay(expedition);
}

/**
 * 遠征を1件作る。
 *
 * `reachedFloor` は出発時点では目標と同じにしておく。実際にどこまで行ったかは、
 * 画面上で行き合ったときに上書きされる（[townDay.ts](./townDay.ts) の同期）。
 */
export function createExpedition(
  _npc: NpcRecord,
  departedDay: number,
  declaredFloor: number,
  plannedDays: number,
  backing?: Expedition["backing"],
): Expedition {
  return {
    departedDay,
    declaredFloor,
    plannedDays: Math.max(1, Math.floor(plannedDays)),
    ...(backing ? { backing } : {}),
  };
}

/** 実際に到達した階。告げた目標から動いていなければ、目標がそのまま答えになる。 */
export function reachedFloorOf(expedition: Expedition): number {
  return Math.max(expedition.reachedFloor ?? 0, expedition.declaredFloor);
}

/**
 * 報告に使うID。
 *
 * 一人が同時に一件しか遠征を持たないので、人物と出発日で一意になる。
 * 保存せずここで組む —— 名簿の全員がこの欄を毎回抱えるには長すぎる。
 */
export function expeditionReportId(npc: NpcRecord, expedition: Expedition): string {
  return `expedition-${npc.id}-${expedition.departedDay}`;
}

/**
 * その階を狙うのに要る日数。
 *
 * 推奨階の内側なら日帰りで足りる。超えるほど、潜って戻るだけで日が要る。
 */
export function plannedDaysFor(npc: NpcRecord, declaredFloor: number): number {
  const recommended = ADVENTURER_RANKS[npc.rank ?? "E"].recommendedFloor;
  const excess = Math.max(0, declaredFloor - recommended);
  return Math.min(MAX_PLANNED_DAYS, 1 + Math.ceil(excess / 2));
}

/** 支援に要る額。食料を日数ぶん持たせる、それだけの話である。 */
export function backingCost(plannedDays: number): number {
  return plannedDays * PROVISIONS_PER_EXPEDITION_DAY * SUPPLY_RULES.provisions.price;
}

/**
 * その頼みを引き受けるか。
 *
 * 推奨階をどれだけ超えるかが主で、勇気と信頼が背中を押し、消耗が引き止める。
 * **装備は数えない。** 良い装備を渡せば何階でも頷く相手になっては、深さが意味を失う
 * —— 装備が効くのは受けた後の生死のほうである。
 */
export function backingRisk(state: GameState, npc: NpcRecord, declaredFloor: number): number {
  const profile = ensureGuardProfile(state, npc);
  const recommended = ADVENTURER_RANKS[npc.rank ?? "E"].recommendedFloor;
  const excess = Math.max(0, declaredFloor - recommended);
  return excess * BACKING_RISK_PER_FLOOR
    + profile.stress * 0.2
    - profile.personality.courage * 0.2
    - profile.trust * 0.1;
}

export interface BackingQuote {
  declaredFloor: number;
  plannedDays: number;
  cost: number;
  /** 断られる見込みか。断られても損はしない。 */
  accepted: boolean;
  line: string;
}

/** 提示する前に、条件と返事を組み立てる。画面はこれを並べる。 */
export function quoteBacking(state: GameState, npc: NpcRecord, declaredFloor: number): BackingQuote {
  const floor = Math.max(1, Math.min(DUNGEON_MAX_FLOOR, Math.floor(declaredFloor)));
  const plannedDays = plannedDaysFor(npc, floor);
  const cost = backingCost(plannedDays);
  const accepted = backingRisk(state, npc, floor) < BACKING_REFUSAL_RISK;
  return {
    declaredFloor: floor,
    plannedDays,
    cost,
    accepted,
    line: accepted
      ? `地下${floor}階まで、${plannedDays}日で戻る。食料代${cost}Gを持たせる。`
      : `地下${floor}階は無理だ、と${npc.name}は言う。`,
  };
}

export interface BackingResult {
  ok: boolean;
  message: string;
}

/** その人物を遠征へ送り出せるか。護衛と二重には契約できない。 */
export function canBackExpedition(state: GameState, npc: NpcRecord): BackingResult {
  if (state.location !== "home") return { ok: false, message: "遠征の支援は自宅で話す。" };
  if (!npc.adventurer) return { ok: false, message: `${npc.name}は迷宮へ潜らない。` };
  if (!isAvailableInTown(npc)) return { ok: false, message: `${npc.name}は今、町にいない。` };
  if (isExpeditionActive(npc.expedition)) return { ok: false, message: `${npc.name}は既に遠征に出ている。` };
  if (state.escortCommission?.npcId === npc.id) return { ok: false, message: `${npc.name}はあなたの護衛を引き受けている。` };
  return { ok: true, message: "送り出せる。" };
}

/**
 * 支援して送り出す。
 *
 * 渡した食料代はその場で手を離れる。**戻ってこなくても取り立てはない** ——
 * この世界に借金は無く、支援が外れることまで含めて商人の判断である。
 */
export function backExpedition(state: GameState, npc: NpcRecord, declaredFloor: number): BackingResult {
  const allowed = canBackExpedition(state, npc);
  if (!allowed.ok) return allowed;

  const quote = quoteBacking(state, npc, declaredFloor);
  if (!quote.accepted) return { ok: false, message: quote.line };
  if (state.gold < quote.cost) return { ok: false, message: `食料代${quote.cost}Gを払えない。` };

  state.gold -= quote.cost;
  // 出発時点で商人由来の品を控えておく。未決着のあいだ、剪定がこれを忘れない。
  const suppliedItemIds = npc.inventoryIds.filter((id) => state.itemsById[id]?.merchantOrigin !== undefined);
  npc.expedition = createExpedition(npc, state.day, quote.declaredFloor, quote.plannedDays, {
    fundedDays: quote.plannedDays,
    paidGold: quote.cost,
    suppliedItemIds,
  });
  npc.status = "delving";

  recordBond(state, npc, "aided", `地下${quote.declaredFloor}階への遠征を支えた`);
  npc.relation = Math.min(100, npc.relation + 2);

  const carried = gearPower(state, npc) > 0 ? "託した装備を担いで、" : "";
  return {
    ok: true,
    message: `${carried}${npc.name}は地下${quote.declaredFloor}階へ発った。帰還予定は第${expeditionDueDay(npc.expedition)}日。`,
  };
}
