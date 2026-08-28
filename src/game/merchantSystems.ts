import { MERCHANT_ITEM_DEFINITIONS } from "./merchantContent";
import { isAvailableInTown, prepareCustomerPurchaseRequest } from "./merchantEconomy";
import { npcBonds } from "./npcBonds";
import { adjustGuardProfile, ensureGuardProfile, recordGuardEvent } from "./guardProfiles";
import { simulateTownDay } from "./townDay";
import type { GameState, ItemInstance, SupplyKind, TimeSlot } from "./types";

export const SUPPLY_RULES: Record<SupplyKind, { label: string; supplier: string; price: number; dailyStock: number }> = {
  smokeBombs: { label: "煙玉", supplier: "薬師ネヴァ", price: 50, dailyStock: 2 },
  returnStones: { label: "帰還石", supplier: "冒険者ギルド", price: 150, dailyStock: 1 },
  provisions: { label: "携行食料", supplier: "食品商", price: 15, dailyStock: 6 },
};

export const SHOP_CUSTOMER_MIN = 3;
export const SHOP_CUSTOMER_MAX = 6;
/**
 * 顔なじみが店に来やすくなる強さ（0で完全に平等）。
 *
 * 名簿が30人に増えると、1日3〜6人の抽選では特定の相手がまず再登場しない。
 * 「昨日薬を買っていった相手が今日また来る」が届くかどうかは、この一箇所で決まる。
 */
export const SHOP_FAMILIARITY_WEIGHT = 0.45;
export const DUNGEON_ACTIONS_PER_MEAL = 30;

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

export function inventoryItemCount(state: GameState): number {
  return state.inventory.length;
}

export function playerAttackPower(state: GameState): number {
  const item = state.inventory.find((entry) => entry.uuid === state.equipment.weaponItemId);
  return Math.max(1, item ? definition(item)?.attack ?? 1 : 1);
}

export function playerDefensePower(state: GameState): number {
  const item = state.inventory.find((entry) => entry.uuid === state.equipment.armorItemId);
  return Math.max(0, item ? definition(item)?.defense ?? 0 : 0);
}

export function equipItem(state: GameState, itemId: string): boolean {
  if (!canReorganizeHomeInventory(state)) {
    state.message = "営業中は在庫整理できない。";
    return false;
  }
  const item = state.inventory.find((entry) => entry.uuid === itemId);
  const itemDefinition = item ? definition(item) : undefined;
  if (!item || !itemDefinition) return false;
  if (itemDefinition.category === "weapon") state.equipment.weaponItemId = item.uuid;
  else if (itemDefinition.category === "armor") state.equipment.armorItemId = item.uuid;
  else return false;
  state.message = `${itemDefinition.trueName}を装備した。`;
  return true;
}

export function unequipItem(state: GameState, slot: "weapon" | "armor"): void {
  if (!canReorganizeHomeInventory(state)) {
    state.message = "営業中は在庫整理できない。";
    return;
  }
  if (slot === "weapon") state.equipment.weaponItemId = undefined;
  else state.equipment.armorItemId = undefined;
  state.message = "装備を外した。";
}

export function unequipIfNeeded(state: GameState, itemId: string): void {
  if (state.equipment.weaponItemId === itemId) state.equipment.weaponItemId = undefined;
  if (state.equipment.armorItemId === itemId) state.equipment.armorItemId = undefined;
}

export function resetDailySystems(state: GameState): void {
  for (const npc of state.npcs) if (npc.status === "visiting") npc.status = "inTown";
  state.visitorNpcIds = [];
  state.shopSession = { day: state.day, status: "closed", queueNpcIds: [], servedNpcIds: [] };
  state.dailySupplyStock = {
    day: state.day,
    smokeBombs: SUPPLY_RULES.smokeBombs.dailyStock,
    returnStones: SUPPLY_RULES.returnStones.dailyStock,
    provisions: SUPPLY_RULES.provisions.dailyStock,
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
  if (state.location !== "home" || (state.timeSlot !== "evening" && state.timeSlot !== "night")) return false;
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
  const available = state.dailySupplyStock[kind];
  const price = rule.price * quantity;
  if (state.location !== "home") return false;
  if (available < quantity) { state.message = `${rule.label}は本日分が売り切れている。`; return false; }
  if (state.gold < price) { state.message = `${price}Gを支払えない。`; return false; }
  state.gold -= price;
  state.dailySupplyStock[kind] -= quantity;
  state[kind] += quantity;
  state.message = `${rule.supplier}から${rule.label}を${quantity}個、${price}Gで仕入れた。`;
  return true;
}

export function canOpenShop(state: GameState): boolean {
  return state.location === "home"
    && (state.timeSlot === "morning" || state.timeSlot === "afternoon")
    && state.shopSession.day === state.day
    && state.shopSession.status === "closed"
    && state.display.some((id) => state.itemsById[id]?.location?.kind === "shopStock");
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
  while (run.settledTimeBands < dueBands && state.status !== "gameOver") {
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
        state.hp = 0;
        state.status = "gameOver";
        state.message = "食料が尽き、ダンジョンで力尽きた。商人の物語はここで終わった。";
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
