import type { DungeonBody, DungeonChest, DungeonHeight, DungeonMap, Enemy, GameState, ItemInstance, LegacyDungeonMap, Vec } from "./types";
import { HOME_SPAWN, createHomeMap } from "./homeMap";
import { loadTrialMapPack, type MapDocument } from "./mapDocument";
import { isMapPositionWalkable } from "./mapTiles";
import { initializeMerchantWorld, pruneCampaignRecords } from "./merchantEconomy";
import { createInitialNpcs } from "./merchantContent";
/** v1-v3 saves always used the fixed 32x20, 16px home. */
const HOME_SPAWN_PIXEL = { x: HOME_SPAWN.x * 16 + 8, y: HOME_SPAWN.y * 16 + 8 };

export type SaveSlot = "autosave" | "manual-1" | "manual-2" | "manual-3";

interface StoredSave {
  slot: SaveSlot;
  savedAt: string;
  state: GameState | LegacyGameState | VersionTwoGameState;
}

type LegacyGameState = Omit<GameState, "version" | "run"> & {
  version: 1;
  run?: Omit<NonNullable<GameState["run"]>, "chests" | "bodies" | "guard" | "shoveCooldown" | "highestFloor"> & {
    chests: Vec[];
    bodies: Vec[];
    enemies: Array<Omit<Enemy, "staggerTurns">>;
  };
};

/** Version 2 used the same campaign fields but did not persist dungeon
 * traversal semantics.  Preserve its active map rather than regenerating it. */
type VersionTwoGameState = Omit<GameState, "version"> & { version: 2 };

const DATABASE_NAME = "dungeon-curio-merchant";
const STORE_NAME = "campaigns";
const DEAD_CAMPAIGNS_KEY = "dungeon-curio-merchant-dead-campaigns";

function deadCampaigns(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try { return new Set(JSON.parse(localStorage.getItem(DEAD_CAMPAIGNS_KEY) ?? "[]") as string[]); }
  catch { return new Set(); }
}

export function markCampaignDead(campaignId: string): void {
  if (typeof localStorage === "undefined") return;
  const dead = deadCampaigns();
  dead.add(campaignId);
  localStorage.setItem(DEAD_CAMPAIGNS_KEY, JSON.stringify([...dead]));
}

export function isCampaignDead(campaignId: string): boolean {
  return deadCampaigns().has(campaignId);
}

function activeHomeMapForSave(): MapDocument {
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("autostart") === "world") return loadTrialMapPack()?.home ?? createHomeMap();
  return createHomeMap();
}

function markerPixel(map: MapDocument): Vec {
  const marker = map.markers.find((candidate) => candidate.kind === "homeSpawn") ?? HOME_SPAWN;
  return { x: marker.x * map.tileSize + map.tileSize / 2, y: marker.y * map.tileSize + map.tileSize / 2 };
}

/** Re-centres a current save on the active home grid, including 32px trial homes. */
export function normalizeHomePositionForMap(map: MapDocument, position?: Vec): Vec {
  if (!position) return markerPixel(map);
  const x = Math.max(0, Math.min(map.width - 1, Math.floor(position.x / map.tileSize)));
  const y = Math.max(0, Math.min(map.height - 1, Math.floor(position.y / map.tileSize)));
  const centered = { x: x * map.tileSize + map.tileSize / 2, y: y * map.tileSize + map.tileSize / 2 };
  return isMapPositionWalkable(map, centered, 5 * (map.tileSize / 16)) ? centered : markerPixel(map);
}

function migrationItem(state: LegacyGameState, definitionId: string, floor: number): ItemInstance {
  return {
    uuid: `item-${state.nextItemId++}`,
    definitionId,
    discoveredDay: state.day,
    discoveredFloor: floor,
    knowledge: "unknown",
    clues: [],
    owner: "player",
    history: [{ day: state.day, type: "found", detail: `地下${floor}階の旧セーブから復元` }],
  };
}

function migrateDungeonMap(map: DungeonMap | LegacyDungeonMap): void {
  // v5 map documents compile canonical up/down stairs. Old saves only carried
  // entrance/stairs/returnStairs, so derive the new fields without discarding
  // the original payload.
  const legacy = map as LegacyDungeonMap;
  map.stairsUp ??= { ...(legacy.returnStairs ?? legacy.entrance ?? legacy.stairs ?? { x: 1, y: 1 }) };
  map.stairsDown ??= legacy.stairs ? { ...legacy.stairs } : undefined;
  map.formatVersion ??= 2;
  map.heights ??= Array.from({ length: map.height }, () => Array<DungeonHeight>(map.width).fill(0));
  map.hardEdges ??= [];
  map.ledgeEdges ??= [];
  map.traversalLinks ??= [];
}

/** v8 で撤去した旧クエスト・旧護衛・罠の残骸を、読み込んだ時点で捨てる。 */
function stripRetiredFields(state: GameState): void {
  const legacy = state as unknown as Record<string, unknown>;
  for (const key of ["quests", "customers", "guards", "story", "refusedOffers", "guildReputation"]) delete legacy[key];
  const runs = [state.run, ...Object.values(state.run?.floorStates ?? {})];
  for (const run of runs) {
    if (!run) continue;
    delete (run as unknown as Record<string, unknown>).traps;
    delete (run.map as unknown as Record<string, unknown>).specialRoom;
  }
  for (const npc of state.npcs ?? []) delete (npc as unknown as Record<string, unknown>).trait;
}

export function migrateSaveState(raw: GameState | LegacyGameState | VersionTwoGameState): GameState {
  const sourceVersion = raw.version as number;
  const legacyVersion = sourceVersion === 1;
  const state = raw as unknown as GameState;
  const oldLocation = (state as unknown as { location?: string }).location;
  if (oldLocation === "town" || oldLocation === "interior") state.location = "home";
  state.version = 8;
  state.campaignId ??= `legacy-${Date.now()}`;
  state.status ??= "active";
  // 追加した任意項目を補い、既存のブラウザ保存を壊さない。
  state.returnStones ??= 1;
  state.smokeBombs ??= 1;
  state.provisions ??= 3;
  state.timeSlot ??= "morning";
  state.equipment ??= {};
  state.shopSession ??= { day: state.day, status: "closed", queueNpcIds: [], servedNpcIds: [] };
  state.dailySupplyStock ??= { day: state.day, smokeBombs: 2, returnStones: 1, provisions: 6 };
  state.archive ??= [];
  state.expeditionSerial ??= 0;
  state.itemsById ??= {};
  state.npcs ??= [];
  state.visitorNpcIds ??= [];
  state.nextNpcId ??= 1;
  state.singularItemIds ??= [];
  if (state.npcs.length === 0) initializeMerchantWorld(state);
  else {
    for (const template of createInitialNpcs()) {
      const existing = state.npcs.find((npc) => npc.id === template.id);
      if (!existing) state.npcs.push(template);
      else if (template.adventurer) {
        existing.rank = template.rank;
        existing.baseFee = template.baseFee;
        existing.maxHp = template.maxHp;
        existing.damage = template.damage;
        existing.retreatHpRatio = template.retreatHpRatio;
      }
    }
  }
  for (const npc of state.npcs) if (npc.adventurer && !npc.rank) {
    npc.rank = (npc.baseFee ?? 0) >= 900 ? "A" : (npc.baseFee ?? 0) >= 550 ? "B" : (npc.baseFee ?? 0) >= 320 ? "C" : (npc.baseFee ?? 0) >= 180 ? "D" : "E";
  }
  if (state.escortCommission?.npcId && !state.escortCommission.rank) {
    state.escortCommission.rank = state.npcs.find((npc) => npc.id === state.escortCommission?.npcId)?.rank ?? "E";
  }
  if (sourceVersion < 4) {
    // Only legacy fixed-home saves use the historical 16px constants.
    state.homePos = { ...HOME_SPAWN_PIXEL };
  } else {
    state.homePos = normalizeHomePositionForMap(activeHomeMapForSave(), state.homePos);
  }

  if (legacyVersion) {
    const legacy = raw as LegacyGameState;
    if (legacy.run) {
      const floor = legacy.run.floor;
      const chests: DungeonChest[] = legacy.run.chests.map((pos, index) => ({
        id: `legacy-chest-${floor}-${index}`,
        pos: { ...pos },
        item: migrationItem(legacy, "moon-fungus", floor),
      }));
      const bodies: DungeonBody[] = legacy.run.bodies.map((pos, index) => ({
        id: `legacy-body-${floor}-${index}`,
        name: "名もなき冒険者",
        pos: { ...pos },
        loot: [],
        inspected: false,
      }));
      state.run = {
        ...legacy.run,
        enemies: legacy.run.enemies.map((enemy) => ({ ...enemy, staggerTurns: 0 })),
        chests,
        bodies,
        guard: undefined,
        shoveCooldown: 0,
        highestFloor: floor,
        floorStates: {},
      };
    }
    state.hiredGuardId = undefined;
    state.hiredGuardFee = undefined;
  } else {
    if (state.run) {
      state.run.enemies.forEach((enemy) => { enemy.staggerTurns ??= 0; });
      state.run.adventurers ??= [];
      if (state.run.guard) {
        state.run.guard.mode ??= "covering";
        state.run.guard.safeTurns ??= 0;
        state.run.guard.pos = { ...state.run.player };
      }
      state.run.shoveCooldown ??= 0;
      state.run.highestFloor ??= state.run.floor;
      state.run.floorStates ??= {};
      state.run.timeUnits ??= 0;
      state.run.settledTimeBands ??= 0;
      migrateDungeonMap(state.run.map);
    }
  }
  if (state.run) {
    state.run.adventurers ??= [];
    state.run.timeUnits ??= 0;
    state.run.settledTimeBands ??= 0;
    state.run.floorStates ??= {};
    migrateDungeonMap(state.run.map);
    if (state.run.guard) {
      state.run.guard.mode ??= "covering";
      state.run.guard.safeTurns ??= 0;
      state.run.guard.pos = { ...state.run.player };
    }
    for (const snapshot of Object.values(state.run.floorStates ?? {})) {
      snapshot.adventurers ??= [];
      migrateDungeonMap(snapshot.map);
      snapshot.shoveCooldown ??= 0;
      snapshot.turn ??= 0;
      if (snapshot.guard) {
        snapshot.guard.mode ??= "covering";
        snapshot.guard.safeTurns ??= 0;
        snapshot.guard.pos = { ...snapshot.player };
      }
    }
  }
  stripRetiredFields(state);
  // 探索中でなければ、旧セーブに溜まった床の品と通りすがりの記録もここで捨てる。
  if (!state.run) pruneCampaignRecords(state);
  (state as { version: number }).version = 8;
  return state;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: "slot" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class SaveRepository {
  async save(slot: SaveSlot, state: GameState): Promise<void> {
    if (state.status === "gameOver" || isCampaignDead(state.campaignId)) return;
    const database = await openDatabase();
    const payload: StoredSave = { slot, savedAt: new Date().toISOString(), state: structuredClone(state) };
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(payload);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }

  async load(slot: SaveSlot): Promise<(Omit<StoredSave, "state"> & { state: GameState }) | undefined> {
    const database = await openDatabase();
    const result = await new Promise<StoredSave | undefined>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(slot);
      request.onsuccess = () => resolve(request.result as StoredSave | undefined);
      request.onerror = () => reject(request.error);
    });
    database.close();
    if (!result) return undefined;
    const version = (result.state as { version?: number }).version;
    if (version !== 5 && version !== 6 && version !== 7) return undefined;
    result.state = migrateSaveState(result.state);
    if (isCampaignDead(result.state.campaignId) || result.state.status === "gameOver") return undefined;
    return result as StoredSave & { state: GameState };
  }

  async deleteCampaign(campaignId: string): Promise<void> {
    markCampaignDead(campaignId);
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const saved = cursor.value as StoredSave;
        if ((saved.state as GameState).campaignId === campaignId) cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }

  async availableSlots(): Promise<SaveSlot[]> {
    const slots: SaveSlot[] = ["autosave", "manual-1", "manual-2", "manual-3"];
    const saved = await Promise.all(slots.map(async (slot) => ({ slot, data: await this.load(slot) })));
    return saved.filter((entry) => entry.data !== undefined).map((entry) => entry.slot);
  }
}
