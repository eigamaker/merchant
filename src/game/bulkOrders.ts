import { MERCHANT_ITEM_DEFINITIONS } from "./merchantContent";
import { RESALE_RATE, demandFor } from "./npcDemand";
import { recordBond } from "./npcBonds";
import type { BulkOrder, GameState, ItemInstance, NpcRecord } from "./types";

/**
 * 商人からの大量発注。
 *
 * 商人は1点ずつ買わない。**種類と数量を指定して、期限付きで発注してくる。**
 *
 * > 「薬草を20束。ひとつ18G —— 相場の6割だ。5日でどうだ」
 *
 * 対象は素材だけである。霊薬も一品物も宝箱からしか出ないので、10個20個まとめて揃える
 * ことは原理的にできない。
 *
 * これが効くのは三つ。**棚は1日3〜6人・1人1点しか捌けない**ので、深層から抱えて帰った
 * 在庫をまとめて現金に変える出口になる。単価が安くても数がまとまるので、**浅層で素材を
 * 拾う遊びが金になる**。そして違約金は、この作品で商人が自分から負う唯一のマイナスである。
 */

/** 落としたときに払う割合。**重くする** —— 軽ければ受け得になって、判断が消える。 */
export const BULK_PENALTY_RATE = 0.3;
/** 同時に抱えられる発注。 */
export const BULK_ORDER_LIMIT = 2;
/** 提示される数量の幅。 */
export const BULK_QUANTITY_MIN = 10;
export const BULK_QUANTITY_MAX = 20;
/** 納期までの日数の幅。 */
export const BULK_DUE_MIN = 4;
export const BULK_DUE_MAX = 7;

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}

export function bulkOrders(state: GameState): BulkOrder[] {
  return state.bulkOrders ?? [];
}

/** 束ねている数。持っている総数を数えるのに使う。 */
const countOf = (item: ItemInstance): number => Math.max(1, Math.floor(item.count ?? 1));

/**
 * いま揃っている数。
 *
 * **鞄と保管庫の両方を数える。** 店頭に並べる必要はない —— まとめて卸す取引なので、
 * 棚に出ているかどうかは関係がない。
 */
export function stockedFor(state: GameState, definitionId: string): number {
  const held = [...state.inventory, ...state.store].filter((item) => item.definitionId === definitionId);
  return held.reduce((total, item) => total + countOf(item), 0);
}

/** その品を扱う商人。転売で生きている相手だけが大口を出す。 */
function resaleNpcs(state: GameState): NpcRecord[] {
  return state.npcs.filter((npc) => npc.status !== "dead" && demandFor(npc) === "resale");
}

/** 発注の対象になる品。素材で、商人がその日に見た（＝商人が扱う）ものに限る。 */
export function bulkOrderCandidates(): string[] {
  return Object.values(MERCHANT_ITEM_DEFINITIONS)
    .filter((definition) => definition.category === "material")
    .map((definition) => definition.id);
}

/**
 * その日の提示を作る。
 *
 * 一度受けた品はしばらく来ない、といった細工はしない。**商人は自分の都合で頼んでくる。**
 * 断っても何も起きないので、判断はこちらの側にある。
 */
export function rollBulkOffer(state: GameState): BulkOrder | undefined {
  const merchants = resaleNpcs(state);
  if (!merchants.length) return undefined;
  if (bulkOrders(state).length >= BULK_ORDER_LIMIT) return undefined;
  const seed = hash(`${state.campaignId}:${state.day}:bulk`);
  // 毎日は来ない。来ない日があるからこそ、来た日の判断に重みが出る。
  if (seed % 100 >= 45) return undefined;

  const candidates = bulkOrderCandidates();
  if (!candidates.length) return undefined;
  const definitionId = candidates[seed % candidates.length]!;
  const definition = MERCHANT_ITEM_DEFINITIONS[definitionId];
  if (!definition) return undefined;
  if (bulkOrders(state).some((order) => order.definitionId === definitionId)) return undefined;

  const npc = merchants[hash(`${state.campaignId}:${state.day}:bulk-npc`) % merchants.length]!;
  const span = BULK_QUANTITY_MAX - BULK_QUANTITY_MIN + 1;
  const quantity = BULK_QUANTITY_MIN + (hash(`${state.campaignId}:${state.day}:bulk-qty`) % span);
  const unitPrice = Math.max(1, Math.round(definition.baseValue * RESALE_RATE));
  const dueSpan = BULK_DUE_MAX - BULK_DUE_MIN + 1;
  const dueDay = state.day + BULK_DUE_MIN + (hash(`${state.campaignId}:${state.day}:bulk-due`) % dueSpan);
  const total = unitPrice * quantity;
  return {
    id: `bulk-${state.day}-${definitionId}`,
    npcId: npc.id,
    definitionId,
    quantity,
    unitPrice,
    dueDay,
    penalty: Math.max(1, Math.round(total * BULK_PENALTY_RATE)),
  };
}

/** 今日の提示を用意する。既に出してあればそのまま返す。 */
export function refreshBulkOffer(state: GameState): BulkOrder | undefined {
  if (state.bulkOffer && state.bulkOffer.id.startsWith(`bulk-${state.day}-`)) return state.bulkOffer;
  state.bulkOffer = rollBulkOffer(state);
  return state.bulkOffer;
}

export function acceptBulkOffer(state: GameState): boolean {
  const offer = state.bulkOffer;
  if (!offer || bulkOrders(state).length >= BULK_ORDER_LIMIT) return false;
  state.bulkOrders = [...bulkOrders(state), { ...offer, acceptedDay: state.day }];
  state.bulkOffer = undefined;
  const name = MERCHANT_ITEM_DEFINITIONS[offer.definitionId]?.trueName ?? offer.definitionId;
  state.message = `${name}を${offer.quantity}個、第${offer.dueDay}日までに納める約束をした。落とせば違約金${offer.penalty}Gだ。`;
  return true;
}

export function declineBulkOffer(state: GameState): void {
  state.bulkOffer = undefined;
  state.message = "大口の話は断った。受けなければ、失うものもない。";
}

/** 期日前でも、数が揃っていれば納められる。 */
export function canDeliverBulkOrder(state: GameState, orderId: string): boolean {
  const order = bulkOrders(state).find((entry) => entry.id === orderId);
  return Boolean(order && stockedFor(state, order.definitionId) >= order.quantity);
}

/**
 * 納める。
 *
 * 鞄と保管庫から、束の小さいものから順に引く。**大きい束を崩さない**ほうが、
 * 残りを次の商いに使いやすい。
 */
export function deliverBulkOrder(state: GameState, orderId: string): boolean {
  const order = bulkOrders(state).find((entry) => entry.id === orderId);
  if (!order || !canDeliverBulkOrder(state, orderId)) return false;

  let remaining = order.quantity;
  const held = [...state.inventory, ...state.store]
    .filter((item) => item.definitionId === order.definitionId)
    .sort((a, b) => countOf(a) - countOf(b));
  for (const item of held) {
    if (remaining <= 0) break;
    const taken = Math.min(countOf(item), remaining);
    remaining -= taken;
    const left = countOf(item) - taken;
    if (left > 0) item.count = left;
    else {
      state.inventory = state.inventory.filter((entry) => entry.uuid !== item.uuid);
      state.store = state.store.filter((entry) => entry.uuid !== item.uuid);
      state.display = state.display.filter((id) => id !== item.uuid);
      delete state.itemsById[item.uuid];
    }
  }

  const total = order.unitPrice * order.quantity;
  state.gold += total;
  state.bulkOrders = bulkOrders(state).filter((entry) => entry.id !== orderId);
  const npc = state.npcs.find((entry) => entry.id === order.npcId);
  const name = MERCHANT_ITEM_DEFINITIONS[order.definitionId]?.trueName ?? order.definitionId;
  if (npc) {
    npc.relation = Math.min(100, npc.relation + 4);
    recordBond(state, npc, "traded", `${name}を${order.quantity}個まとめて納めた`);
  }
  state.message = `${name}を${order.quantity}個納め、${total}Gを受け取った。`;
  return true;
}

/**
 * 期日を過ぎた発注を清算する。町の一日の入口で呼ぶ。
 *
 * 払えなければ金庫から引く。それでも足りなければ borrow せず、払える分だけ払って
 * 縁を失う —— この世界に借金は無い。
 */
export function settleOverdueBulkOrders(state: GameState): void {
  const overdue = bulkOrders(state).filter((order) => order.dueDay < state.day);
  if (!overdue.length) return;
  for (const order of overdue) {
    const owed = order.penalty;
    const fromPurse = Math.min(state.gold, owed);
    state.gold -= fromPurse;
    const fromVault = Math.min(state.vaultGold, owed - fromPurse);
    state.vaultGold -= fromVault;
    const npc = state.npcs.find((entry) => entry.id === order.npcId);
    const name = MERCHANT_ITEM_DEFINITIONS[order.definitionId]?.trueName ?? order.definitionId;
    if (npc) {
      npc.relation = Math.max(-100, npc.relation - 12);
      recordBond(state, npc, "gouged", `${name}の納期を落とし、違約金${owed}Gを払った`);
    }
    state.events.push({
      id: `bulk-failed-${order.id}`,
      dueDay: state.day,
      text: `${name}${order.quantity}個の納期を落とした。違約金${fromPurse + fromVault}Gを支払った。`,
    });
  }
  state.bulkOrders = bulkOrders(state).filter((order) => order.dueDay >= state.day);
}
