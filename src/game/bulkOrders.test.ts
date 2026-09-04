import { describe, expect, it } from "vitest";
import { createItem, createNewGame } from "./engine";
import {
  BULK_PENALTY_RATE,
  acceptBulkOffer,
  bulkOrders,
  canDeliverBulkOrder,
  declineBulkOffer,
  deliverBulkOrder,
  refreshBulkOffer,
  settleOverdueBulkOrders,
  stockedFor,
} from "./bulkOrders";
import { MATERIAL_STACK_SIZE } from "./merchantContent";
import type { BulkOrder, GameState } from "./types";

/** その日に必ず話が来る campaign を探す。抽選は campaignId と日付から決まる。 */
function campaignWithOffer(): { state: GameState; offer: BulkOrder } {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const state = createNewGame();
    state.campaignId = `bulk-${attempt}`;
    const offer = refreshBulkOffer(state);
    if (offer) return { state, offer };
  }
  throw new Error("大量発注の話が来るキャンペーンが見つからない");
}

/** 鞄と保管庫に、束に分けて素材を置く。 */
function stock(state: GameState, definitionId: string, total: number): void {
  let left = total;
  while (left > 0) {
    const size = Math.min(MATERIAL_STACK_SIZE, left);
    left -= size;
    const item = createItem(state, definitionId);
    item.count = size;
    // 半分は保管庫へ。**棚に並べる必要はない**ことを確かめるため。
    if (left % 2 === 0) state.inventory.push(item);
    else { item.location = { kind: "homeStorage" }; state.store.push(item); }
  }
}

describe("大量発注", () => {
  it("素材だけを、期限と違約金つきで頼んでくる", () => {
    const { offer } = campaignWithOffer();
    expect(offer.quantity).toBeGreaterThanOrEqual(10);
    expect(offer.penalty).toBe(Math.round(offer.unitPrice * offer.quantity * BULK_PENALTY_RATE));
    expect(offer.dueDay).toBeGreaterThan(1);
  });

  it("鞄と保管庫の合計で数える。店頭に並べる必要はない", () => {
    const { state, offer } = campaignWithOffer();
    acceptBulkOffer(state);
    expect(bulkOrders(state)).toHaveLength(1);

    stock(state, offer.definitionId, offer.quantity - 1);
    expect(stockedFor(state, offer.definitionId)).toBe(offer.quantity - 1);
    expect(canDeliverBulkOrder(state, offer.id)).toBe(false);
    expect(state.display).toHaveLength(0);

    stock(state, offer.definitionId, 1);
    expect(canDeliverBulkOrder(state, offer.id)).toBe(true);

    const gold = state.gold;
    expect(deliverBulkOrder(state, offer.id)).toBe(true);
    expect(state.gold).toBe(gold + offer.unitPrice * offer.quantity);
    expect(bulkOrders(state)).toHaveLength(0);
    // ちょうど納めたぶんだけ減る。端数の束が残るなら、その分だけ残る。
    expect(stockedFor(state, offer.definitionId)).toBe(0);
  });

  it("多く持っていれば、頼まれた数だけ納めて残りは手元に残る", () => {
    const { state, offer } = campaignWithOffer();
    acceptBulkOffer(state);
    stock(state, offer.definitionId, offer.quantity + 3);

    expect(deliverBulkOrder(state, offer.id)).toBe(true);
    expect(stockedFor(state, offer.definitionId)).toBe(3);
  });

  it("期日を落とせば違約金を取られ、縁が下がる", () => {
    const { state, offer } = campaignWithOffer();
    acceptBulkOffer(state);
    const npc = state.npcs.find((entry) => entry.id === offer.npcId)!;
    const relation = npc.relation;
    state.gold = offer.penalty + 100;

    state.day = offer.dueDay + 1;
    settleOverdueBulkOrders(state);

    expect(state.gold).toBe(100);
    expect(bulkOrders(state)).toHaveLength(0);
    expect(npc.relation).toBeLessThan(relation);
    expect(state.events.some((event) => event.id.startsWith("bulk-failed-"))).toBe(true);
  });

  it("所持金で足りなければ金庫から引く。借金にはならない", () => {
    const { state, offer } = campaignWithOffer();
    acceptBulkOffer(state);
    state.gold = 10;
    state.vaultGold = offer.penalty;

    state.day = offer.dueDay + 1;
    settleOverdueBulkOrders(state);

    // 手持ち10Gを先に出し、足りない分を金庫が埋める。合わせて違約金ちょうど。
    expect(state.gold).toBe(0);
    expect(state.vaultGold).toBe(10);
  });

  it("断れば何も起きない。受けなければ失うものもない", () => {
    const { state } = campaignWithOffer();
    const gold = state.gold;
    declineBulkOffer(state);
    expect(state.bulkOffer).toBeUndefined();
    expect(bulkOrders(state)).toHaveLength(0);
    expect(state.gold).toBe(gold);
  });
});
