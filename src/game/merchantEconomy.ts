import { LEGENDARY_NAME_PREFIXES, MERCHANT_ITEM_DEFINITIONS, NPC_SEEDS, createInitialNpcs, GENERATED_ADVENTURER_NAMES } from "./merchantContent";
import type { GameState, ItemInstance, NpcProfession, NpcRecord } from "./types";

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}

export function initializeMerchantWorld(state: GameState): void {
  state.npcs = createInitialNpcs();
  state.itemsById = {};
  state.nextNpcId = 1;
  state.refusedOffers = {};
  state.singularItemIds = [];
  refreshDailyVisitors(state);
}

export function refreshDailyVisitors(state: GameState): void {
  // A visitor from the previous day returns to the general town pool before
  // today's deterministic draw is made.
  for (const npc of state.npcs) {
    if (npc.status === "visiting") npc.status = "inTown";
  }
  const candidates = state.npcs.filter((npc) => npc.status === "inTown");
  const ranked = candidates
    .map((npc) => ({ npc, order: hash(`${state.campaignId}:${state.day}:${npc.id}`) }))
    .sort((a, b) => a.order - b.order);
  state.visitorNpcIds = ranked.slice(0, 2).map(({ npc }) => npc.id);
  for (const npc of state.npcs) {
    if (state.visitorNpcIds.includes(npc.id) && npc.status === "inTown") npc.status = "visiting";
  }
}

export function registerWorldItem(state: GameState, instance: ItemInstance): ItemInstance {
  state.itemsById[instance.uuid] = instance;
  return instance;
}

export function merchantItemName(item: ItemInstance): string | undefined {
  if (item.currentName) return item.currentName;
  if (item.singular && !item.namedByNpcId) return "？？？の剣";
  return MERCHANT_ITEM_DEFINITIONS[item.definitionId]?.trueName;
}

export function postEscortCommission(state: GameState, offeredFee: number): NpcRecord | undefined {
  if (state.location !== "home" || state.status !== "active" || state.escortCommission?.status === "active") return undefined;
  const fee = Math.max(1, Math.floor(offeredFee));
  const eligible = state.npcs.filter((npc) => npc.adventurer
    && (npc.status === "inTown" || npc.status === "visiting")
    && (npc.baseFee ?? Number.POSITIVE_INFINITY) <= fee);
  if (!eligible.length || state.gold < fee) {
    state.escortCommission = { offeredFee: fee, status: "draft" };
    state.message = state.gold < fee ? `護衛料${fee}Gを支払えない。` : "その条件で受ける冒険者はいなかった。";
    return undefined;
  }
  const selected = [...eligible].sort((a, b) => {
    const relation = b.relation - a.relation;
    return relation || hash(`${state.campaignId}:${state.day}:${fee}:${a.id}`) - hash(`${state.campaignId}:${state.day}:${fee}:${b.id}`);
  })[0]!;
  state.gold -= fee;
  selected.status = "contracted";
  state.visitorNpcIds = state.visitorNpcIds.filter((id) => id !== selected.id);
  state.escortCommission = { offeredFee: fee, status: "accepted", npcId: selected.id };
  state.hiredGuardId = selected.id;
  state.hiredGuardFee = fee;
  state.message = `${selected.name}が護衛依頼を受け、店へやってきた。`;
  return selected;
}

export function cancelEscortCommission(state: GameState): void {
  const commission = state.escortCommission;
  if (!commission || commission.status === "active") return;
  if (commission.status === "accepted" && commission.npcId) {
    state.gold += commission.offeredFee;
    const npc = state.npcs.find((entry) => entry.id === commission.npcId);
    if (npc?.status === "contracted") npc.status = "inTown";
  }
  state.escortCommission = undefined;
  state.hiredGuardId = undefined;
  state.hiredGuardFee = undefined;
  state.message = "護衛募集を取り下げた。";
}

function saleLimit(npc: NpcRecord, item: ItemInstance): number {
  const definition = MERCHANT_ITEM_DEFINITIONS[item.definitionId];
  if (!definition) return 0;
  const interest = npc.interests.includes(definition.category) ? 1.3 : 0.65;
  const relation = 1 + npc.relation / 200;
  const notable = (item.historyV2 ?? []).filter((event) => event.type === "ownerDied" || event.type === "named").length;
  const history = 1 + Math.min(0.5, notable * 0.05);
  return Math.min(npc.budget, Math.max(1, Math.floor(definition.baseValue * interest * relation * history)));
}

function assignLegendaryName(state: GameState, item: ItemInstance, npc: NpcRecord): void {
  if (!item.singular || item.currentName) return;
  const prefix = LEGENDARY_NAME_PREFIXES[hash(`${state.campaignId}:${item.uuid}:${npc.id}`) % LEGENDARY_NAME_PREFIXES.length]!;
  const name = `${prefix}の剣`;
  item.currentName = name;
  item.namedByNpcId = npc.id;
  item.historyV2 ??= [];
  item.historyV2.push({ day: state.day, type: "named", npcId: npc.id, name, detail: `${npc.name}が命名` });
}

export function offerShopItem(state: GameState, itemId: string, npcId: string, askingPrice: number): { accepted: boolean; message: string } {
  const item = state.itemsById[itemId];
  const npc = state.npcs.find((entry) => entry.id === npcId);
  const price = Math.max(1, Math.min(99_999, Math.floor(askingPrice)));
  const refusalKey = `${npcId}:${itemId}`;
  if (!item || !npc || item.location?.kind !== "shopStock" || !state.visitorNpcIds.includes(npcId)) return { accepted: false, message: "その取引はできない。" };
  if (state.refusedOffers[refusalKey] === state.day) return { accepted: false, message: `${npc.name}には明日まで同じ品を提示できない。` };
  if (price > saleLimit(npc, item)) {
    state.refusedOffers[refusalKey] = state.day;
    return { accepted: false, message: `${npc.name}「その値段では買えない」` };
  }
  state.gold += price;
  item.location = { kind: "npcInventory", npcId };
  item.owner = npc.id;
  item.history.push({ day: state.day, type: "sold", detail: `${npc.name}へ売却`, value: price });
  item.historyV2 ??= [];
  item.historyV2.push({ day: state.day, type: "sold", npcId, price, detail: `${npc.name}へ売却` });
  npc.inventoryIds.push(item.uuid);
  state.inventory = state.inventory.filter((entry) => entry.uuid !== item.uuid);
  state.store = state.store.filter((entry) => entry.uuid !== item.uuid);
  state.display = state.display.filter((id) => id !== item.uuid);
  assignLegendaryName(state, item, npc);
  state.archive.push(item);
  npc.relation = Math.min(100, npc.relation + 1);
  return { accepted: true, message: `${npc.name}へ${merchantItemName(item) ?? item.definitionId}を${price}Gで売却した。` };
}

export function createGeneratedDeadAdventurer(state: GameState, floor: number): NpcRecord {
  const serial = state.nextNpcId++;
  const usedNames = new Set(state.npcs.map((npc) => npc.name));
  const baseIndex = hash(`${state.campaignId}:${floor}:${serial}`) % GENERATED_ADVENTURER_NAMES.length;
  let name: string = GENERATED_ADVENTURER_NAMES[baseIndex]!;
  if (usedNames.has(name)) name = `${name} ${serial}`;
  const professions: NpcProfession[] = ["swordsman", "scout", "mercenary"];
  const profession = professions[hash(`${name}:${floor}`) % professions.length]!;
  const template = NPC_SEEDS.find((npc) => npc.profession === profession)!;
  const npc: NpcRecord = {
    ...template,
    id: `generated-adventurer-${serial}`,
    name,
    status: "dead",
    relation: 0,
    interests: [...template.interests],
    inventoryIds: [],
  };
  state.npcs.push(npc);
  return npc;
}
