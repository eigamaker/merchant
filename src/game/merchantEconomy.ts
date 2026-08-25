import { ADVENTURER_RANKS, LEGENDARY_NAME_PREFIXES, MERCHANT_ITEM_DEFINITIONS, NPC_SEEDS, adventurerRankForFloor, createInitialNpcs, GENERATED_ADVENTURER_NAMES } from "./merchantContent";
import type { AdventurerRank, GameState, ItemInstance, NpcProfession, NpcRecord } from "./types";

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}

export function initializeMerchantWorld(state: GameState): void {
  state.npcs = createInitialNpcs();
  state.itemsById = {};
  state.nextNpcId = 1;
  state.singularItemIds = [];
  state.visitorNpcIds = [];
}

const TOWN_NPC_IDS: ReadonlySet<string> = new Set(NPC_SEEDS.map((seed) => seed.id));

/**
 * 探索を終えるたびに、もう誰も参照しない記録を捨てる。
 *
 * 階を1つ作るたびに床の品と通りすがりの冒険者が `itemsById` / `npcs` へ登録されるが、
 * 帰還すればその階は消える。拾わなかった品と、一度も取引しなかった冒険者を残すと
 * セーブが探索回数に比例して膨らみ、1手ごとの自動保存が重くなる。
 *
 * 残すのは 鞄・保管庫・店頭・売却済み・装備中の品と、それらが名前を記録している人物、
 * そして町の常連15人。遺体から回収した品は履歴に持ち主を残すので、故人の記録も一緒に残る。
 */
export function pruneCampaignRecords(state: GameState): void {
  const liveItemIds = new Set<string>();
  for (const item of [...state.inventory, ...state.store, ...state.archive]) liveItemIds.add(item.uuid);
  for (const id of state.display) liveItemIds.add(id);
  for (const id of [state.equipment.weaponItemId, state.equipment.armorItemId]) if (id) liveItemIds.add(id);
  if (state.shopSession.requestedItemId) liveItemIds.add(state.shopSession.requestedItemId);
  // 町にいる常連の持ち物は世界の一部として残す。故人の未回収分は階と一緒に消える。
  for (const npc of state.npcs) {
    if (!TOWN_NPC_IDS.has(npc.id) || npc.status === "dead") continue;
    for (const id of npc.inventoryIds) liveItemIds.add(id);
  }

  const keptItems: Record<string, ItemInstance> = {};
  const namedNpcIds = new Set<string>();
  for (const id of liveItemIds) {
    const item = state.itemsById[id];
    if (!item) continue;
    keptItems[id] = item;
    if (item.owner && !["player", "store", "ground"].includes(item.owner)) namedNpcIds.add(item.owner);
    if (item.namedByNpcId) namedNpcIds.add(item.namedByNpcId);
    for (const event of item.historyV2 ?? []) if ("npcId" in event) namedNpcIds.add(event.npcId);
  }
  state.itemsById = keptItems;

  for (const id of [state.hiredGuardId, state.escortCommission?.npcId, state.shopSession.currentNpcId]) if (id) namedNpcIds.add(id);
  for (const id of [...state.visitorNpcIds, ...state.shopSession.queueNpcIds, ...state.shopSession.servedNpcIds]) namedNpcIds.add(id);

  state.npcs = state.npcs.filter((npc) => TOWN_NPC_IDS.has(npc.id) || namedNpcIds.has(npc.id));
  for (const npc of state.npcs) npc.inventoryIds = npc.inventoryIds.filter((id) => id in keptItems);
}

export function refreshDailyVisitors(state: GameState): void {
  for (const npc of state.npcs) {
    if (npc.status === "visiting") npc.status = "inTown";
  }
  // Visitors are intentionally unknown until an opened shop summons them.
  state.visitorNpcIds = [];
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

export function escortFeeForNpc(_state: GameState, npc: NpcRecord): number {
  const baseFee = ADVENTURER_RANKS[npc.rank ?? "E"].escortFee;
  const relationDiscount = Math.min(0.2, npc.relation * 0.02);
  return Math.max(1, Math.floor(baseFee * (1 - relationDiscount)));
}

export function postEscortCommission(state: GameState, npcId: string): NpcRecord | undefined {
  if (state.location !== "home" || state.status !== "active" || state.escortCommission?.status === "active") return undefined;
  const selected = state.npcs.find((npc) => npc.id === npcId && npc.adventurer);
  if (!selected || (selected.status !== "inTown" && selected.status !== "visiting")) {
    state.message = "その冒険者は今は護衛を引き受けられない。";
    return undefined;
  }
  const fee = escortFeeForNpc(state, selected);
  if (state.gold < fee) {
    state.message = `${selected.rank ?? "E"}ランクの${selected.name}を雇うには${fee}G必要だ。`;
    return undefined;
  }
  state.gold -= fee;
  selected.status = "contracted";
  state.visitorNpcIds = state.visitorNpcIds.filter((id) => id !== selected.id);
  state.escortCommission = { offeredFee: fee, status: "accepted", npcId: selected.id, rank: selected.rank ?? "E" };
  state.hiredGuardId = selected.id;
  state.hiredGuardFee = fee;
  state.message = `${selected.rank ?? "E"}ランクの${selected.name}を${fee}Gで護衛に指定した。`;
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

export interface CustomerPurchaseRequest {
  itemId: string;
  price: number;
}

/**
 * Lets the current customer choose one displayed item and name the amount they
 * are willing to pay. The persisted request makes reopening a save or menu
 * unable to reroll either the item or its price.
 */
export function prepareCustomerPurchaseRequest(state: GameState, npcId: string): CustomerPurchaseRequest | undefined {
  const npc = state.npcs.find((entry) => entry.id === npcId);
  const session = state.shopSession;
  if (!npc || session.status !== "serving" || session.currentNpcId !== npcId) return undefined;

  const existing = session.requestedItemId ? state.itemsById[session.requestedItemId] : undefined;
  if (existing?.location?.kind === "shopStock" && session.requestedPrice !== undefined) {
    return { itemId: existing.uuid, price: session.requestedPrice };
  }

  session.requestedItemId = undefined;
  session.requestedPrice = undefined;
  const stock = session.status === "serving"
    ? state.display
      .map((id) => state.itemsById[id])
      .filter((item): item is ItemInstance => Boolean(item) && item.location?.kind === "shopStock")
    : [];
  const selected = stock
    .map((item) => {
      const itemDefinition = MERCHANT_ITEM_DEFINITIONS[item.definitionId];
      const interested = itemDefinition && npc.interests.includes(itemDefinition.category) ? 1 : 0;
      return { item, interested, order: hash(`${state.campaignId}:${state.day}:purchase:${npc.id}:${item.uuid}`) };
    })
    .sort((a, b) => b.interested - a.interested || a.order - b.order)[0]?.item;
  if (!selected) return undefined;

  const willingness = 80 + hash(`${state.campaignId}:${state.day}:price:${npc.id}:${selected.uuid}`) % 21;
  const price = Math.max(1, Math.floor(saleLimit(npc, selected) * willingness / 100));
  session.requestedItemId = selected.uuid;
  session.requestedPrice = price;
  return { itemId: selected.uuid, price };
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

export function acceptCustomerPurchaseRequest(state: GameState): { accepted: boolean; message: string } {
  const { currentNpcId: npcId, requestedItemId: itemId, requestedPrice: price } = state.shopSession;
  const item = itemId ? state.itemsById[itemId] : undefined;
  const npc = npcId ? state.npcs.find((entry) => entry.id === npcId) : undefined;
  const isCurrentRequest = state.shopSession.status === "serving"
    && npcId !== undefined
    && itemId !== undefined
    && price !== undefined;
  if (!isCurrentRequest || !item || !npc || item.location?.kind !== "shopStock" || !state.display.includes(item.uuid)) {
    return { accepted: false, message: "その取引はできない。" };
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
  return { accepted: true, message: `${npc.name}の希望を受け、${merchantItemName(item) ?? item.definitionId}を${price}Gで売却した。` };
}

export function createGeneratedDeadAdventurer(state: GameState, floor: number): NpcRecord {
  const npc = createGeneratedAdventurer(state, floor);
  npc.status = "dead";
  return npc;
}

export function createGeneratedAdventurer(state: GameState, floor: number): NpcRecord {
  const serial = state.nextNpcId++;
  const usedNames = new Set(state.npcs.map((npc) => npc.name));
  const baseIndex = hash(`${state.campaignId}:${floor}:${serial}`) % GENERATED_ADVENTURER_NAMES.length;
  let name: string = GENERATED_ADVENTURER_NAMES[baseIndex]!;
  if (usedNames.has(name)) name = `${name} ${serial}`;
  const professions: NpcProfession[] = ["swordsman", "scout", "mercenary"];
  const profession = professions[hash(`${name}:${floor}`) % professions.length]!;
  const template = NPC_SEEDS.find((npc) => npc.profession === profession)!;
  const rank: AdventurerRank = adventurerRankForFloor(floor);
  const rankStats = ADVENTURER_RANKS[rank];
  const variation = hash(`${state.campaignId}:${name}:${floor}:stats`);
  const npc: NpcRecord = {
    ...template,
    id: `generated-adventurer-${serial}`,
    name,
    rank,
    baseFee: rankStats.escortFee,
    maxHp: rankStats.baseHp + variation % 4,
    damage: rankStats.baseDamage + Math.floor(variation / 7) % 2,
    retreatHpRatio: profession === "scout" ? 0.45 : 0.25 + (variation % 2) * 0.05,
    budget: rankStats.escortFee * 2 + variation % 151,
    status: "dungeon",
    relation: 0,
    interests: [...template.interests],
    inventoryIds: [],
  };
  state.npcs.push(npc);
  return npc;
}
