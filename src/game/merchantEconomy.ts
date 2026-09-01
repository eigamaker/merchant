import { ADVENTURER_RANKS, MERCHANT_ITEM_DEFINITIONS, NPC_SEEDS, createInitialNpcs } from "./merchantContent";
import { ensureGuardProfile, initializeGuardProfiles } from "./guardProfiles";
import { hasBond, recordBond, retainedNpcIds } from "./npcBonds";
import { ensureRosterPopulation, seedOpeningRosterActivity } from "./npcRoster";
import { corpseLootIds } from "./dungeonCorpses";
import { gearSlots, isRetained, RETAINER_FEE_RATE } from "./npcGear";
import { assignCounterName } from "./itemLegend";
import { marketPrice, shopVerdict, type ShopReaction } from "./pricing";
import type { GameState, ItemInstance, NpcRecord } from "./types";

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
  initializeGuardProfiles(state);
  ensureRosterPopulation(state);
  seedOpeningRosterActivity(state);
}

/** 台本のある15人。名簿が増えても、この人たちだけは必ず残す。 */
export const SEED_NPC_IDS: ReadonlySet<string> = new Set(NPC_SEEDS.map((seed) => seed.id));

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
/**
 * 一点物の台帳を、実在するインスタンスと突き合わせる。
 *
 * 台帳は追記専用だったため、黒剣を床に置き捨てて剪定されると、品は消えたのに
 * 台帳には残り、`createItem` が以後キャンペーン中ずっと throw していた。
 * 生き残りの無い項目を落として、もう一度深層で見つかる余地を残す。
 */
export function reconcileSingularLedger(state: GameState): void {
  const alive = new Set(Object.values(state.itemsById).map((item) => item.definitionId));
  state.singularItemIds = state.singularItemIds.filter((id) => alive.has(id));
}

export function pruneCampaignRecords(state: GameState): void {
  const liveItemIds = new Set<string>();
  for (const item of [...state.inventory, ...state.store, ...state.archive]) liveItemIds.add(item.uuid);
  for (const id of state.display) liveItemIds.add(id);
  if (state.equipment.bagItemId) liveItemIds.add(state.equipment.bagItemId);
  if (state.shopSession.requestedItemId) liveItemIds.add(state.shopSession.requestedItemId);
  // まだ迷宮に横たわっている遺品。これを外すと、遺体が空のまま残る。
  for (const id of corpseLootIds(state)) liveItemIds.add(id);
  for (const npc of state.npcs) {
    if (npc.status === "dead") continue;
    // 預けた装備は、相手が誰であれ、どこで拾った品であれ残す。
    // 故人のぶんは遺体台帳（corpseLootIds）が引き継ぐので、ここでは飛ばす。
    for (const slot of gearSlots(npc)) liveItemIds.add(slot.itemId);
    // 台本の15人が町で持っていた品だけが持ち物として残る。
    // 迷宮へ担いでいった在庫は階と一緒に消える。見分けは discoveredFloor。
    if (!SEED_NPC_IDS.has(npc.id)) continue;
    for (const id of npc.inventoryIds) {
      if (state.itemsById[id]?.discoveredFloor === undefined) liveItemIds.add(id);
    }
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

  // 名簿は世界そのものなので、生きている冒険者は全員残す。
  // 台本のある15人と、手元の品が名指ししている人物も同じく残す。
  const required = (npc: NpcRecord): boolean =>
    SEED_NPC_IDS.has(npc.id) || (npc.adventurer && npc.status !== "dead") || namedNpcIds.has(npc.id);
  // 故人は、縁がある間だけ覚えている。誰とも関わらなかった死者は名簿から落ちる。
  const absent = state.npcs.filter((npc) => !required(npc) && hasBond(npc));
  const remembered = retainedNpcIds(absent);

  state.npcs = state.npcs.filter((npc) => required(npc) || remembered.has(npc.id));
  for (const npc of state.npcs) {
    npc.inventoryIds = npc.inventoryIds.filter((id) => id in keptItems);
    // 剪定で消えた品を gear が指し続けないようにする。
    for (const slot of ["weapon", "armor"] as const) {
      if (npc.gear?.[slot] && !(npc.gear[slot]!.itemId in keptItems)) delete npc.gear[slot];
    }
    if (npc.gear && !npc.gear.weapon && !npc.gear.armor) delete npc.gear;
  }
  reconcileSingularLedger(state);
}

/**
 * 「今日この人は町にいるか」の唯一の判定。
 *
 * 店の客・護衛候補・剪定の三箇所が同じ問いを別々に書いていたので一本化する。
 * 接客中（visiting）も町にいる扱い。カウンター越しにそのまま契約できる。
 */
export const isAvailableInTown = (npc: NpcRecord): boolean => npc.status === "inTown" || npc.status === "visiting";

/** 今日この冒険者を護衛に指名できるか。 */
export const isHireable = (npc: NpcRecord): boolean => npc.adventurer && isAvailableInTown(npc);

export function registerWorldItem(state: GameState, instance: ItemInstance): ItemInstance {
  state.itemsById[instance.uuid] = instance;
  return instance;
}

export function merchantItemName(item: ItemInstance): string | undefined {
  if (item.currentName) return item.currentName;
  if (item.singular && !item.namedByNpcId) return "？？？の剣";
  return MERCHANT_ITEM_DEFINITIONS[item.definitionId]?.trueName;
}

/**
 * HPを回復する薬は町の薬屋が常備しているため、自宅の店では販売品にならない。
 * 迷宮内の直接取引や露店にはこの制限を掛けない。
 */
export function canSellInHomeShop(item: ItemInstance): boolean {
  return (MERCHANT_ITEM_DEFINITIONS[item.definitionId]?.healing ?? 0) <= 0;
}

export function escortFeeForNpc(state: GameState, npc: NpcRecord): number {
  const baseFee = ADVENTURER_RANKS[npc.rank ?? "E"].escortFee;
  const profile = ensureGuardProfile(state, npc);
  const personalityMultiplier = 0.9 + profile.personality.greed / 500;
  const reputationPremium = Math.min(0.25, profile.career.deepestFloor * 0.02 + profile.career.successfulReturns * 0.01);
  const trustDiscount = Math.min(0.2, profile.trust * 0.002);
  // お抱えは都度の護衛料ではなく、囲っている相手として安く付く。
  const retainer = isRetained(npc) ? RETAINER_FEE_RATE : 1;
  return Math.max(1, Math.floor(baseFee * personalityMultiplier * (1 + reputationPremium) * (1 - trustDiscount) * retainer));
}

export function postEscortCommission(state: GameState, npcId: string): NpcRecord | undefined {
  if (state.location !== "home" || state.status !== "active" || state.escortCommission?.status === "active") return undefined;
  const selected = state.npcs.find((npc) => npc.id === npcId && npc.adventurer);
  if (!selected || !isAvailableInTown(selected)) {
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
  const notable = (item.historyV2 ?? [])
    .filter((event) => event.type === "ownerDied" || event.type === "named" || event.type === "lootedFromCorpse").length;
  // 持ち主を看取った品は語れることが桁違いに多い。上限をそこだけ倍にする。
  const cap = (item.deeds?.ownersLost ?? 0) > 0 ? 1 : 0.5;
  const history = 1 + Math.min(cap, notable * 0.05);
  return Math.min(npc.budget, Math.max(1, Math.floor(definition.baseValue * interest * relation * history)));
}

export interface CustomerPurchaseRequest {
  itemId: string;
  /** 商人の付け値。 */
  asking: number;
  /** 実際に動く額。値切りに応じるならこちらが客の言い値。 */
  price: number;
  reaction: ShopReaction;
  line: string;
}

/** 棚に並んでいる値。付けていなければ相場で並ぶ。 */
export function askingPriceFor(item: ItemInstance): number {
  return item.askingPrice ?? marketPrice(item);
}

/**
 * 客が棚から一点選び、商人の付け値に返事をする。
 *
 * 選んだ品は保存され、開き直しても選び直されない。返事のほうは付け値から決まるので
 * 保存しない —— 同じ付け値には同じ返事が返る。
 *
 * 店で高値が通らないのはここである。客はよそでも買えるので、上限を大きく超えた品には
 * 値切りもせず「よそをあたる」と言って帰る。
 */
export function prepareCustomerPurchaseRequest(state: GameState, npcId: string): CustomerPurchaseRequest | undefined {
  const npc = state.npcs.find((entry) => entry.id === npcId);
  const session = state.shopSession;
  if (!npc || session.status !== "serving" || session.currentNpcId !== npcId) return undefined;

  const existing = session.requestedItemId ? state.itemsById[session.requestedItemId] : undefined;
  const stock = session.status === "serving"
    ? state.display
      .map((id) => state.itemsById[id])
      .filter((item): item is ItemInstance => Boolean(item) && item.location?.kind === "shopStock" && canSellInHomeShop(item))
    : [];
  const selected = existing?.location?.kind === "shopStock" && canSellInHomeShop(existing)
    ? existing
    : stock
      .map((item) => {
        const itemDefinition = MERCHANT_ITEM_DEFINITIONS[item.definitionId];
        const interested = itemDefinition && npc.interests.includes(itemDefinition.category) ? 1 : 0;
        return { item, interested, order: hash(`${state.campaignId}:${state.day}:purchase:${npc.id}:${item.uuid}`) };
      })
      .sort((a, b) => b.interested - a.interested || a.order - b.order)[0]?.item;
  if (!selected) {
    session.requestedItemId = undefined;
    session.requestedPrice = undefined;
    return undefined;
  }

  const asking = askingPriceFor(selected);
  const verdict = shopVerdict(npc, asking, saleLimit(npc, selected));
  session.requestedItemId = selected.uuid;
  session.requestedPrice = verdict.reaction === "refuse" ? undefined : verdict.price;
  return { itemId: selected.uuid, asking, price: verdict.price, reaction: verdict.reaction, line: verdict.line };
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
  // 命名は itemLegend が一手に引き受ける。接尾辞を「の剣」に決め打ちしていた不具合もここで消える。
  assignCounterName(state, item, npc);
  state.archive.push(item);
  npc.relation = Math.min(100, npc.relation + 1);
  recordBond(state, npc, "served", `${merchantItemName(item) ?? item.definitionId}を${price}Gで買っていった`);
  return { accepted: true, message: `${merchantItemName(item) ?? item.definitionId}を${npc.name}へ${price}Gで売却した。` };
}
