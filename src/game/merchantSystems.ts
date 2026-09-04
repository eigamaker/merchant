import { FALLBACK_BAG_CAPACITY, MERCHANT_ITEM_DEFINITIONS, bagCapacityOf } from "./merchantContent";
import { canSellInHomeShop, isAvailableInTown, prepareCustomerPurchaseRequest, pruneCampaignRecords } from "./merchantEconomy";
import { npcBonds } from "./npcBonds";
import { adjustGuardProfile, ensureGuardProfile, recordGuardEvent } from "./guardProfiles";
import { simulateTownDay } from "./townDay";
import { refreshBulkOffer, settleOverdueBulkOrders } from "./bulkOrders";
import { createHomeMap } from "./homeMap";
import { loadTrialMapPack } from "./mapDocument";
import type { GameState, ItemInstance, SupplyKind, TimeSlot } from "./types";

export const SUPPLY_RULES = {
  smokeBombs: { label: "煙玉", supplier: "薬師ネヴァ", price: 50, dailyStock: 2, purchasable: true },
  returnStones: { label: "帰還石", supplier: "―", price: 0, dailyStock: 0, purchasable: false },
  provisions: { label: "携行食料", supplier: "食品商", price: 15, dailyStock: null, purchasable: true },
} satisfies Record<SupplyKind, { label: string; supplier: string; price: number; dailyStock: number | null; purchasable: boolean }>;

export const SHOP_CUSTOMER_MIN = 3;
export const SHOP_CUSTOMER_MAX = 6;
/**
 * 顔なじみが店に来やすくなる強さ（0で完全に平等）。
 *
 * 名簿が30人に増えると、1日3〜6人の抽選では特定の相手がまず再登場しない。
 * 「昨日薬を買っていった相手が今日また来る」が届くかどうかは、この一箇所で決まる。
 */
export const SHOP_FAMILIARITY_WEIGHT = 0.45;
export const DUNGEON_ACTIONS_PER_MEAL = 40;
/** 携行食料は束ねて運ぶ。端数も一束として1枠を使う。 */
export const PROVISIONS_PER_SLOT = 25;

const TIME_ORDER: TimeSlot[] = ["morning", "afternoon", "evening", "night"];

/** その日に届いた報せを返す。呼び出し側が本文へ混ぜられるようにするため。 */
export function processDayEvents(state: GameState): string | undefined {
  const due = state.events.filter((event) => event.dueDay <= state.day);
  state.events = state.events.filter((event) => event.dueDay > state.day);
  if (!due.length) return undefined;
  for (const event of due) {
    if (event.effect?.kind !== "arrival") continue;
    // 噂が立った時点で人物は作られている。到着の日に、ようやく町の一員になる。
    const arriving = state.npcs.find((npc) => npc.id === event.effect?.npcId);
    if (arriving && arriving.status === "traveling") arriving.status = "inTown";
  }
  state.message = due.map((event) => event.text).join(" ");
  return state.message;
}

function definition(item: ItemInstance) {
  return MERCHANT_ITEM_DEFINITIONS[item.definitionId];
}

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}

export function provisionSlotCount(provisions: number): number {
  return Math.ceil(Math.max(0, Math.floor(provisions)) / PROVISIONS_PER_SLOT);
}

export function inventoryItemCount(state: GameState): number {
  return state.inventory.length + provisionSlotCount(state.provisions);
}

/**
 * いま背負っている道具袋が抱えられる枠数。
 *
 * 商人は武器も防具も持たない。身に着けるのは袋ひとつで、それが持ち帰れる量そのもの、
 * つまり一日の稼ぎの上限になる。袋は金では買えず、迷宮の底からしか出てこない。
 */
export function bagCapacity(state: GameState): number {
  const item = state.equipment.bagItemId ? state.itemsById[state.equipment.bagItemId] : undefined;
  return item ? bagCapacityOf(item.definitionId) : FALLBACK_BAG_CAPACITY;
}

/** 現在の品物を残したまま、追加で積める食料の個数。 */
export function provisionCapacityRemaining(state: GameState): number {
  const slotsForProvisions = Math.max(0, bagCapacity(state) - state.inventory.length);
  return Math.max(0, slotsForProvisions * PROVISIONS_PER_SLOT - state.provisions);
}

export function equippedBag(state: GameState): ItemInstance | undefined {
  return state.equipment.bagItemId ? state.itemsById[state.equipment.bagItemId] : undefined;
}

/**
 * 見つけた袋へ荷を移す。いま使っている袋は鞄の中へ戻るので、売り物にできる。
 *
 * 差し引きの枠は0だが、小さい袋へ替えると溢れる。溢れる持ち替えは断る。
 */
export function equipBag(state: GameState, itemId: string): boolean {
  if (!canReorganizeHomeInventory(state)) {
    state.message = "営業中は在庫整理できない。";
    return false;
  }
  const incoming = state.inventory.find((entry) => entry.uuid === itemId);
  const incomingDefinition = incoming ? definition(incoming) : undefined;
  if (!incoming || incomingDefinition?.category !== "bag") return false;
  const previous = equippedBag(state);
  const nextCapacity = incomingDefinition.capacity ?? FALLBACK_BAG_CAPACITY;
  const carried = state.inventory.length - 1 + (previous ? 1 : 0) + provisionSlotCount(state.provisions);
  if (carried > nextCapacity) {
    state.message = `${incomingDefinition.trueName}は${nextCapacity}枠しかない。先に荷を減らそう。`;
    return false;
  }
  state.inventory = state.inventory.filter((entry) => entry.uuid !== incoming.uuid);
  incoming.owner = "player";
  incoming.location = { kind: "equipped" };
  state.equipment.bagItemId = incoming.uuid;
  if (previous) {
    previous.location = { kind: "playerBag" };
    state.inventory.push(previous);
  }
  state.message = `${incomingDefinition.trueName}へ荷を移した。${nextCapacity}枠になった。`;
  return true;
}

/** 品が手を離れるとき、それが背負っている袋なら外す。 */
export function unequipIfNeeded(state: GameState, itemId: string): void {
  if (state.equipment.bagItemId === itemId) state.equipment.bagItemId = undefined;
}

export function resetDailySystems(state: GameState): void {
  // 期日を落とした約束は、朝いちばんに清算される。
  settleOverdueBulkOrders(state);
  refreshBulkOffer(state);
  for (const npc of state.npcs) if (npc.status === "visiting") npc.status = "inTown";
  state.visitorNpcIds = [];
  state.shopSession = { day: state.day, status: "closed", queueNpcIds: [], servedNpcIds: [] };
  state.dailySupplyStock = {
    day: state.day,
    smokeBombs: SUPPLY_RULES.smokeBombs.dailyStock,
    returnStones: SUPPLY_RULES.returnStones.dailyStock,
    // セーブ互換用の欄。食料は常時仕入れられるので、在庫数としては使わない。
    provisions: 0,
  };
  // 町で身体を休めている者だけ消耗が抜ける。療養中はより早く。
  for (const npc of state.npcs) {
    if (!npc.adventurer) continue;
    const resting = npc.status === "inTown" || npc.status === "contracted" ? -12 : npc.status === "recovering" ? -18 : 0;
    if (resting === 0) continue;
    adjustGuardProfile(ensureGuardProfile(state, npc), 0, resting);
  }
}

export function advanceTime(state: GameState, bands = 1): void {
  for (let index = 0; index < bands; index += 1) {
    const current = TIME_ORDER.indexOf(state.timeSlot);
    if (current >= TIME_ORDER.length - 1) {
      state.day += 1;
      state.timeSlot = "morning";
      resetDailySystems(state);
      simulateTownDay(state);
      processDayEvents(state);
    } else state.timeSlot = TIME_ORDER[current + 1]!;
  }
}

export function restUntilMorning(state: GameState): boolean {
  if (state.location !== "home") return false;
  state.day += 1;
  state.timeSlot = "morning";
  state.hp = state.maxHp;
  resetDailySystems(state);
  simulateTownDay(state);
  // 報せを朝の定型文で塗り潰さない。訃報も到着も、寝て起きた朝に届く。
  const news = processDayEvents(state);
  state.message = news
    ? `${state.day}日目の朝。${news}`
    : `${state.day}日目の朝。十分に休み、体力が回復した。`;
  return true;
}

export function buySupply(state: GameState, kind: SupplyKind, amount = 1): boolean {
  const quantity = Math.max(1, Math.floor(amount));
  const rule = SUPPLY_RULES[kind];
  const limitedStock = rule.dailyStock !== null;
  const available = state.dailySupplyStock[kind];
  const price = rule.price * quantity;
  if (state.location !== "home") return false;
  if (!rule.purchasable) {
    state.message = "帰還石は町では手に入らない。地下13階以深の宝箱を探そう。";
    return false;
  }
  if (limitedStock && available < quantity) { state.message = `${rule.label}は本日分が売り切れている。`; return false; }
  if (state.gold < price) { state.message = `${price}Gを支払えない。`; return false; }
  if (kind === "provisions" && quantity > provisionCapacityRemaining(state)) {
    state.message = `鞄に食料${quantity}個を積む空きがない。食料は${PROVISIONS_PER_SLOT}個ごとに1枠使う。`;
    return false;
  }
  state.gold -= price;
  if (limitedStock) state.dailySupplyStock[kind] -= quantity;
  state[kind] += quantity;
  state.message = `${rule.supplier}から${rule.label}を${quantity}個、${price}Gで仕入れた。`;
  return true;
}

function canUseVault(state: GameState): boolean {
  return state.location === "home" && state.status === "active" && !isShopSessionActive(state);
}

/** 自宅の金庫へ所持金を移す。預金は探索中の死亡では失われない。 */
export function depositGold(state: GameState, requested = state.gold): boolean {
  if (!canUseVault(state)) {
    state.message = state.location === "home" ? "営業中は金庫を開けない。" : "金庫は自宅にある。";
    return false;
  }
  const amount = Math.min(state.gold, Math.max(0, Math.floor(requested)));
  if (amount <= 0) { state.message = "預けられる所持金がない。"; return false; }
  state.gold -= amount;
  state.vaultGold += amount;
  state.message = `${amount}Gを金庫へ預けた。預金は${state.vaultGold}G。`;
  return true;
}

/** 自宅の金庫から、使える所持金へ戻す。 */
export function withdrawGold(state: GameState, requested = state.vaultGold): boolean {
  if (!canUseVault(state)) {
    state.message = state.location === "home" ? "営業中は金庫を開けない。" : "金庫は自宅にある。";
    return false;
  }
  const amount = Math.min(state.vaultGold, Math.max(0, Math.floor(requested)));
  if (amount <= 0) { state.message = "金庫に引き出せる預金がない。"; return false; }
  state.vaultGold -= amount;
  state.gold += amount;
  state.message = `${amount}Gを金庫から引き出した。預金は${state.vaultGold}G。`;
  return true;
}

/**
 * 主人公が倒れた探索を精算する。
 * 鞄・装備・探索用品・所持金は失うが、自宅の在庫、預金、NPCへ預けた品は残る。
 */
export function recoverMerchantAfterDeath(state: GameState, cause: string): void {
  const lostGold = state.gold;
  const lostItems = state.inventory.length;
  const guardId = state.run?.guard?.guardId ?? state.hiredGuardId;
  if (guardId) {
    const guard = state.npcs.find((npc) => npc.id === guardId);
    if (guard && guard.status !== "dead") guard.status = "inTown";
  }

  state.gold = 0;
  state.inventory = [];
  state.provisions = 0;
  state.smokeBombs = 0;
  state.returnStones = 0;
  state.run = undefined;
  state.hiredGuardId = undefined;
  state.hiredGuardFee = undefined;
  state.escortCommission = undefined;
  state.location = "home";
  state.status = "active";
  state.hp = state.maxHp;
  state.timeSlot = "night";
  state.lastExpeditionDay = Math.max(state.lastExpeditionDay, state.day);

  const home = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("autostart") === "world"
    ? loadTrialMapPack()?.home ?? createHomeMap()
    : createHomeMap();
  const marker = home.markers.find((entry) => entry.kind === "homeSpawn") ?? home.markers[0];
  if (marker) state.homePos = { x: marker.x * home.tileSize + home.tileSize / 2, y: marker.y * home.tileSize + home.tileSize / 2 };

  pruneCampaignRecords(state);
  state.message = `${cause} 自宅へ運び戻されたが、所持金${lostGold}Gと鞄の品${lostItems}個、探索用品をすべて失った。金庫の預金と自宅の在庫は無事だ。`;
}

export function canOpenShop(state: GameState): boolean {
  return state.location === "home"
    && (state.timeSlot === "morning" || state.timeSlot === "afternoon")
    && state.shopSession.day === state.day
    && state.shopSession.status === "closed"
    && state.display.some((id) => {
      const item = state.itemsById[id];
      return item?.location?.kind === "shopStock" && canSellInHomeShop(item);
    });
}

export function isShopSessionActive(state: GameState): boolean {
  return state.shopSession.status === "movingToCounter"
    || state.shopSession.status === "waiting"
    || state.shopSession.status === "serving";
}

/** Home stock and equipment stay fixed from opening preparation through close. */
export function canReorganizeHomeInventory(state: GameState): boolean {
  return state.location !== "home" || !isShopSessionActive(state);
}

export function startShopSession(state: GameState): boolean {
  if (!canOpenShop(state)) {
    state.message = state.timeSlot === "evening" || state.timeSlot === "night"
      ? "今日はもう開店できない。翌朝を待とう。"
      : "販売品を店頭へ出してから開店しよう。";
    return false;
  }
  const candidates = state.npcs.filter((npc) => isAvailableInTown(npc) && npc.id !== state.escortCommission?.npcId);
  const ordered = candidates
    .map((npc) => {
      const familiarity = Math.min(1, npc.relation / 20 + npcBonds(npc).length / 6);
      const draw = hash(`${state.campaignId}:${state.day}:shop:${npc.id}`) / 0x100000000;
      return { npc, order: draw - familiarity * SHOP_FAMILIARITY_WEIGHT };
    })
    .sort((a, b) => a.order - b.order || a.npc.id.localeCompare(b.npc.id));
  const countRange = SHOP_CUSTOMER_MAX - SHOP_CUSTOMER_MIN + 1;
  const count = Math.min(ordered.length, SHOP_CUSTOMER_MIN + hash(`${state.campaignId}:${state.day}:shop-count`) % countRange);
  state.shopSession = {
    day: state.day,
    status: "movingToCounter",
    queueNpcIds: ordered.slice(0, count).map(({ npc }) => npc.id),
    servedNpcIds: [],
  };
  state.visitorNpcIds = [];
  state.message = `開店準備を始めた。本日の来客予定は${count}人。カウンターへ向かう。`;
  return true;
}

export function summonNextCustomer(state: GameState): string | undefined {
  if (state.shopSession.status !== "waiting" && state.shopSession.status !== "movingToCounter") return undefined;
  const npcId = state.shopSession.queueNpcIds.shift();
  if (!npcId) return undefined;
  const npc = state.npcs.find((entry) => entry.id === npcId && entry.status === "inTown");
  if (!npc) return summonNextCustomer(state);
  npc.status = "visiting";
  state.shopSession.currentNpcId = npc.id;
  state.shopSession.status = "serving";
  state.visitorNpcIds = [npc.id];
  prepareCustomerPurchaseRequest(state, npc.id);
  state.message = "扉が開いた。客が棚から商品を選び、カウンターへ向かっている。";
  return npc.id;
}

export function finishCurrentCustomer(state: GameState): void {
  const npcId = state.shopSession.currentNpcId;
  if (npcId) {
    const npc = state.npcs.find((entry) => entry.id === npcId);
    if (npc?.status === "visiting") npc.status = "inTown";
    state.shopSession.servedNpcIds.push(npcId);
  }
  state.shopSession.currentNpcId = undefined;
  state.shopSession.requestedItemId = undefined;
  state.shopSession.requestedPrice = undefined;
  state.visitorNpcIds = [];
  state.shopSession.status = "waiting";
  state.message = state.shopSession.queueNpcIds.length ? "客が帰った。次の客を待っている。" : "本日の来客はこれで終わりのようだ。";
}

export function closeShopSession(state: GameState): void {
  const current = state.shopSession.currentNpcId;
  if (current) {
    const npc = state.npcs.find((entry) => entry.id === current);
    if (npc?.status === "visiting") npc.status = "inTown";
  }
  state.shopSession.currentNpcId = undefined;
  state.shopSession.requestedItemId = undefined;
  state.shopSession.requestedPrice = undefined;
  state.shopSession.queueNpcIds = [];
  state.shopSession.status = "finished";
  state.visitorNpcIds = [];
  state.timeSlot = "night";
  state.message = "店を閉めた。今夜は在庫整理や仕入れをしてから休める。";
}

export function consumeDungeonTime(state: GameState, units: number): void {
  const run = state.run;
  if (!run || state.status === "gameOver") return;
  run.timeUnits += units;
  const dueBands = Math.floor(run.timeUnits / DUNGEON_ACTIONS_PER_MEAL);
  while (run.settledTimeBands < dueBands) {
    run.settledTimeBands += 1;
    advanceTime(state, 1);
    const required = dungeonMealProvisionCost(state);
    const consumed = Math.min(state.provisions, required);
    state.provisions -= consumed;
    if (consumed === required) {
      state.message = state.provisions > 0
        ? `一行で携行食料を${required}個食べた。残り${state.provisions}。`
        : `一行で携行食料を${required}個食べた。食料が尽きたため、次の消費時から空腹ダメージを受ける。`;
    }
    else {
      state.hp -= 2;
      const shortage = required - consumed;
      const guardNpc = state.run?.guard ? state.npcs.find((npc) => npc.id === state.run?.guard?.guardId) : undefined;
      if (guardNpc) {
        const profile = ensureGuardProfile(state, guardNpc);
        adjustGuardProfile(profile, -6, 15);
        recordGuardEvent(state, guardNpc, "starved", `地下${state.run!.floor}階で食料が不足した`, state.run!.floor);
      }
      state.message = `一行${required}人分の携行食料が${shortage}個不足し、空腹で2ダメージを受けた。`;
      if (state.hp <= 0) {
        recoverMerchantAfterDeath(state, "食料が尽き、ダンジョンで力尽きた。");
        return;
      }
    }
  }
}

export function dungeonTimeUntilNextMeal(state: GameState): number | undefined {
  const run = state.run;
  if (!run) return undefined;
  return Math.max(0, (run.settledTimeBands + 1) * DUNGEON_ACTIONS_PER_MEAL - run.timeUnits);
}

export function dungeonMealProvisionCost(state: GameState): number {
  return state.run?.guard ? 2 : 1;
}
