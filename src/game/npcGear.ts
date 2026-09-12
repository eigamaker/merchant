import { MERCHANT_ITEM_DEFINITIONS, itemCharges } from "./merchantContent";
import { adjustGuardProfile, ensureGuardProfile } from "./guardProfiles";
import { recordBond } from "./npcBonds";
import { itemDeeds, refreshItemLegend } from "./itemLegend";
import type { GameState, ItemInstance, NpcGearSlot, NpcRecord } from "./types";

/**
 * 商人が冒険者へ預けた装備。
 *
 * 装備は `npc.gear` が持つが、品そのものは `npc.inventoryIds` の中にある。
 * 参照であって別の置き場ではない —— こうしておくと、護衛の死も単独潜行者の死も
 * 既に `inventoryIds` から遺品を組んでいるので、預けた装備は一行も足さずに遺体へ載る。
 *
 * 逆に戦闘値の計算（`npcCombatStats`）は `gear` だけを読み、`inventoryIds` は読まない。
 * 台本の冒険者は初期装備を鞄に持っているので、そこまで数えると能力値が勝手に変わる。
 */

/** 同時に装備を預けられる人数。容量の話であり、「お気に入り」を強いる設計でもある。 */
export const ENTRUSTED_NPC_LIMIT = 5;

export type GearSlotName = "weapon" | "armor";

export interface NpcCombatStats {
  maxHp: number;
  damage: number;
  defense: number;
}

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

export function gearSlots(npc: NpcRecord): NpcGearSlot[] {
  return [npc.gear?.weapon, npc.gear?.armor].filter((slot): slot is NpcGearSlot => Boolean(slot));
}

/**
 * 託した装備の枠だけ。
 *
 * 枠には売った品も入る —— 買った剣はその人の得物なので、担いで潜るのが当たり前である。
 * だが**関係の重みを測る側は託したものだけを見る。** 代金を受け取った品は、もう商人のものではない。
 */
export function entrustedSlots(state: GameState, npc: NpcRecord): NpcGearSlot[] {
  return gearSlots(npc).filter((slot) => state.itemsById[slot.itemId]?.merchantOrigin === "entrusted");
}

export function hasEntrustedGear(state: GameState, npc: NpcRecord): boolean {
  return entrustedSlots(state, npc).length > 0;
}

/**
 * 商人の手を離れた品に、出どころを刻む。
 *
 * 売った武器・防具は、枠が空いていればそのまま装備になる。買った剣を鞄で腐らせる冒険者は
 * いないからで、**これで `npcCombatStats` も `gearPower` も遺体処理も、読み取り側は一行も
 * 変えずに効く。** 台本の冒険者の初期装備は枠に入らないので、彼らの能力値は動かない。
 *
 * 埋まっている枠は奪わない。託した槍を持っている相手が剣を買っても、槍のままである。
 */
export function markMerchantGoods(
  state: GameState,
  npc: NpcRecord,
  item: ItemInstance,
  origin: "sold" | "entrusted",
): void {
  item.merchantOrigin = origin;
  item.merchantDay = state.day;
  // 託した品の枠は entrustGear が自分で決める。
  if (origin === "entrusted") return;
  // 転売商も蒐集家も、買った剣を振らない。
  if (!npc.adventurer) return;
  const slot = gearSlotFor(item);
  if (!slot || npc.gear?.[slot]) return;
  npc.gear ??= {};
  npc.gear[slot] = { itemId: item.uuid, since: state.day };
}

/**
 * その人が商人から受け取り、まだ残量のある薬のうち一本。
 *
 * 薬は装備枠に入らないので、`inventoryIds` から直に拾う。**商人が渡したものだけ** ——
 * `buildRun` が撒いた小回復薬で「あなたの薬が命を拾った」と言っては嘘になる。
 *
 * 残量の多い順に選ぶ。剪定の whitelist（`merchantTraces`）も同じ規則で選ぶので、
 * 使われる予定の一本が先に忘れられることはない。
 */
export function merchantMedicine(state: GameState, npc: NpcRecord): ItemInstance | undefined {
  return npc.inventoryIds
    .map((id) => state.itemsById[id])
    .filter((item): item is ItemInstance => Boolean(item)
      && item!.merchantOrigin !== undefined
      && (MERCHANT_ITEM_DEFINITIONS[item!.definitionId]?.healing ?? 0) > 0
      && itemCharges(item!) > 0)
    .sort((a, b) => itemCharges(b) - itemCharges(a) || a.uuid.localeCompare(b.uuid))[0];
}

/** 預かっている品の実体。必ず `itemsById` を通す —— 保存と復元で参照は割れる。 */
export function carriedGearItems(state: GameState, npc: NpcRecord): ItemInstance[] {
  return gearSlots(npc)
    .map((slot) => state.itemsById[slot.itemId])
    .filter((item): item is ItemInstance => Boolean(item));
}

export function entrustedNpcCount(state: GameState): number {
  return state.npcs.filter((npc) => hasEntrustedGear(state, npc)).length;
}

/** 武器か防具か。それ以外は預けられない。 */
export function gearSlotFor(item: ItemInstance): GearSlotName | undefined {
  const category = MERCHANT_ITEM_DEFINITIONS[item.definitionId]?.category;
  if (category === "weapon") return "weapon";
  if (category === "armor") return "armor";
  return undefined;
}

/** 装備が足す分。装備が無ければすべて0で、既存の数値は1つも動かない。 */
export function gearAttackBonus(state: GameState, npc: NpcRecord): number {
  const item = npc.gear?.weapon ? state.itemsById[npc.gear.weapon.itemId] : undefined;
  return item ? MERCHANT_ITEM_DEFINITIONS[item.definitionId]?.attack ?? 0 : 0;
}

export function gearDefenseBonus(state: GameState, npc: NpcRecord): number {
  const item = npc.gear?.armor ? state.itemsById[npc.gear.armor.itemId] : undefined;
  return item ? MERCHANT_ITEM_DEFINITIONS[item.definitionId]?.defense ?? 0 : 0;
}

/**
 * 装備を載せた戦闘値。
 *
 * 防具はHPにも効かせる。二重の軽減にすると被弾がほぼ通らなくなり、HPゲージの意味が消える。
 */
export function npcCombatStats(state: GameState, npc: NpcRecord): NpcCombatStats {
  const defense = gearDefenseBonus(state, npc);
  return {
    maxHp: (npc.maxHp ?? 6) + defense * 3,
    damage: (npc.damage ?? 1) + gearAttackBonus(state, npc),
    defense,
  };
}

/** 画面外の生存判定に渡す装備の重み。生き延びるかどうかなので防御寄りに数える。 */
export function gearPower(state: GameState, npc: NpcRecord): number {
  return gearAttackBonus(state, npc) + gearDefenseBonus(state, npc) * 2;
}

export interface EntrustResult {
  ok: boolean;
  message: string;
}

/**
 * 装備を託す。
 *
 * 貸すか譲るかは選ばせない。商人が決めるのは**手放して、死ぬかもしれない誰かに
 * 持たせるかどうか**だけで、返ってくるかどうかは引き取りを申し出たときに相手が決める。
 */
export function entrustGear(state: GameState, npc: NpcRecord, itemId: string): EntrustResult {
  const item = state.itemsById[itemId];
  if (!item) return { ok: false, message: "その品は見つからない。" };
  const slot = gearSlotFor(item);
  if (!slot) return { ok: false, message: "武器か防具でなければ預けられない。" };
  if (npc.status === "dead") return { ok: false, message: `${npc.name}はもういない。` };
  const occupant = npc.gear?.[slot] ? state.itemsById[npc.gear[slot]!.itemId] : undefined;
  if (npc.gear?.[slot] && occupant?.merchantOrigin !== "sold") {
    return { ok: false, message: `${npc.name}には既に${slot === "weapon" ? "武器" : "防具"}を託している。` };
  }
  if (!hasEntrustedGear(state, npc) && entrustedNpcCount(state) >= ENTRUSTED_NPC_LIMIT) {
    return { ok: false, message: `同時に装備を預けられるのは${ENTRUSTED_NPC_LIMIT}人までだ。` };
  }

  state.inventory = state.inventory.filter((entry) => entry.uuid !== itemId);
  state.store = state.store.filter((entry) => entry.uuid !== itemId);
  state.display = state.display.filter((id) => id !== itemId);
  item.owner = npc.id;
  item.location = { kind: "npcInventory", npcId: npc.id };
  if (!npc.inventoryIds.includes(itemId)) npc.inventoryIds.push(itemId);
  npc.gear ??= {};
  npc.gear[slot] = { itemId, since: state.day };
  markMerchantGoods(state, npc, item, "entrusted");

  const profile = ensureGuardProfile(state, npc);
  adjustGuardProfile(profile, 15, 0);
  npc.relation = Math.min(100, npc.relation + 5);
  recordBond(state, npc, "entrusted", "武器防具を託した");
  return {
    ok: true,
    message: occupant
      ? `${npc.name}は買った${itemName(occupant)}を鞄へしまい、代わりに受け取った。`
      : `${npc.name}へ託した。`,
  };
}

/**
 * 引き取りを申し出る。
 *
 * 町にいる相手からしか引き取れない —— 迷宮から物が瞬間移動しては困る。そして
 * **頼んだからといって返るとは限らない。** 断られたことは記録に残り、お抱えの道が閉じる。
 */
export function reclaimGear(state: GameState, npc: NpcRecord, slot: GearSlotName): EntrustResult {
  const entry = npc.gear?.[slot];
  if (!entry) return { ok: false, message: "預けている品はない。" };
  if (npc.status === "delving" || npc.status === "escorting") {
    return { ok: false, message: `${npc.name}は今、迷宮にいる。` };
  }
  const item = state.itemsById[entry.itemId];
  // 代金を受け取った品は、もう相手のものである。断られるのではなく、頼むほうが筋違い。
  if (item?.merchantOrigin === "sold") {
    return { ok: false, message: `${itemName(item)}は、もう${npc.name}が買った品だ。` };
  }
  if (entry.withheld) return { ok: false, message: `${npc.name}は、もう返す気がない。` };
  if (refusesToReturnGear(state, npc, slot)) {
    entry.withheld = true;
    npc.relation = Math.max(-100, npc.relation - 8);
    const name = item ? itemName(item) : "預けた品";
    state.events.push({
      id: `withheld-${npc.id}-${slot}`,
      dueDay: state.day,
      text: `${npc.name}は、${name}を返してくれなかった。`,
    });
    return { ok: false, message: `${npc.name}は${name}を握ったまま、返そうとしない。` };
  }
  releaseSlot(npc, slot);
  if (item) {
    item.owner = "store";
    item.location = { kind: "homeStorage" };
    if (!state.store.some((stored) => stored.uuid === item.uuid)) state.store.push(item);
  }
  return { ok: true, message: `${npc.name}から${item ? "品を" : ""}引き取った。` };
}

/** 預かりの記録だけを外す。品の行き先は呼び出し側が決める。 */
export function releaseSlot(npc: NpcRecord, slot: GearSlotName): void {
  const entry = npc.gear?.[slot];
  if (!entry) return;
  npc.inventoryIds = npc.inventoryIds.filter((id) => id !== entry.itemId);
  delete npc.gear![slot];
  if (!npc.gear!.weapon && !npc.gear!.armor) delete npc.gear;
}

/**
 * 返してくれと言われて、返すかどうか。
 *
 * 誠実で信頼している相手はまず返す。強欲な傭兵はときどき手放さない。
 * **枠ごとに引く。** 剣を断った日に盾まで自動で断られては、返事が一つしか無いことになる。
 */
export function refusesToReturnGear(state: GameState, npc: NpcRecord, slot: GearSlotName): boolean {
  const profile = ensureGuardProfile(state, npc);
  const chance = clamp(
    0.30 - profile.personality.integrity / 250 - profile.trust / 300 + profile.personality.greed / 300,
    0.02,
    0.35,
  );
  return hash(`${state.campaignId}:${state.day}:${npc.id}:${slot}:reclaim`) / 0x100000000 < chance;
}

/** 表示に使う名。銘があればそちらが勝つ。 */
function itemName(item: ItemInstance): string {
  return item.currentName ?? MERCHANT_ITEM_DEFINITIONS[item.definitionId]?.trueName ?? "預けた品";
}

export interface GearDeed {
  /** 担がれて到達した階。 */
  floor?: number;
  kills?: number;
  returned?: boolean;
  died?: boolean;
}

/**
 * 預かった装備に功績を積む。
 *
 * 功績は人ではなく品に付く。地下8階を踏んだA級に剣を貸しても「深淵踏み」にはならない ——
 * 武器はその武器が担がれた深さと、その武器で退けた数だけを負う。
 *
 * 装備を預けていなければ即座に返るので、呼び出し側はどこでも1行で済む。
 */
export function recordGearDeed(state: GameState, npc: NpcRecord, deed: GearDeed): void {
  const carried = carriedGearItems(state, npc);
  if (!carried.length) return;
  for (const item of carried) {
    const deeds = itemDeeds(item);
    if (deed.floor !== undefined) deeds.deepestFloor = Math.max(deeds.deepestFloor, deed.floor);
    if (deed.kills) deeds.kills += deed.kills;
    if (deed.returned) deeds.returns += 1;
    if (deed.died) deeds.ownersLost += 1;
    refreshItemLegend(state, item, npc);
  }
}

/** お抱えに要る信頼と、贈り物を渡してからの生還数。 */
export const RETAINER_TRUST = 70;
export const RETAINER_SURVIVALS = 5;
/** お抱えの護衛料。固定の関係になった相手は、その都度の値切り交渉から外れる。 */
export const RETAINER_FEE_RATE = 0.4;

export function isRetained(npc: NpcRecord): boolean {
  return npc.retainedSince !== undefined && npc.status !== "dead";
}

/**
 * お抱えの条件。
 *
 * 託した装備がまだ相手の手にあり、深い信頼があり、生きて帰った実績があること。
 *
 * **返せと言わなかったことが信用になる。** 引き取ってしまえば条件は解け、
 * 引き取ろうとして断られた相手とは、この関係にはならない。
 */
export function retainerReady(state: GameState, npc: NpcRecord): boolean {
  if (isRetained(npc) || npc.status === "dead") return false;
  const slots = entrustedSlots(state, npc);
  if (!slots.length) return false;
  if (slots.some((slot) => slot.withheld)) return false;
  const profile = ensureGuardProfile(state, npc);
  const survivals = profile.career.successfulReturns + profile.career.soloDelves;
  return profile.trust >= RETAINER_TRUST && survivals >= RETAINER_SURVIVALS;
}

/** 条件が満たされた日に、お抱えになる。 */
export function updateRetainer(state: GameState, npc: NpcRecord): void {
  if (!retainerReady(state, npc)) return;
  npc.retainedSince = state.day;
  state.events.push({
    id: `retained-${npc.id}`,
    dueDay: state.day,
    text: `${npc.name}が、これからはあなたの店を第一に働くと申し出た。`,
  });
}
