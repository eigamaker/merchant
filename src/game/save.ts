import { GUARD_DEFINITIONS, INITIAL_QUESTS } from "./content";
import type { DungeonBody, DungeonChest, DungeonHeight, DungeonMap, Enemy, GameState, ItemInstance, LegacyDungeonMap, Quest, Vec } from "./types";
import { HOME_SPAWN, createHomeMap } from "./homeMap";
import { loadTrialMapPack, type MapDocument } from "./mapDocument";
import { isMapPositionWalkable } from "./mapTiles";
import { initializeMerchantWorld } from "./merchantEconomy";
/** v1-v3 saves always used the fixed 32x20, 16px home. */
const HOME_SPAWN_PIXEL = { x: HOME_SPAWN.x * 16 + 8, y: HOME_SPAWN.y * 16 + 8 };

export type SaveSlot = "autosave" | "manual-1" | "manual-2" | "manual-3";

interface StoredSave {
  slot: SaveSlot;
  savedAt: string;
  state: GameState | LegacyGameState | VersionTwoGameState;
}

type LegacyGameState = Omit<GameState, "version" | "guildReputation" | "guards" | "story" | "quests" | "run"> & {
  version: 1;
  quests: Array<Omit<Quest, "status"> & { status: "available" | "active" | "complete" }>;
  story: { blackSword: GameState["story"]["blackSword"] };
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

export function migrateSaveState(raw: GameState | LegacyGameState | VersionTwoGameState): GameState {
  const sourceVersion = raw.version as number;
  const legacyVersion = sourceVersion === 1;
  const state = raw as unknown as GameState;
  const oldLocation = (state as unknown as { location?: string }).location;
  if (oldLocation === "town" || oldLocation === "interior") state.location = "home";
  state.version = 7;
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
  state.guildReputation ??= 0;
  state.guards ??= Object.keys(GUARD_DEFINITIONS).map((id) => ({ id, unlocked: false, relation: 0, experience: 0, level: 1 }));
  state.itemsById ??= {};
  state.npcs ??= [];
  state.visitorNpcIds ??= [];
  state.nextNpcId ??= 1;
  state.refusedOffers ??= {};
  state.singularItemIds ??= [];
  if (state.npcs.length === 0) initializeMerchantWorld(state);
  if (sourceVersion < 4) {
    // Only legacy fixed-home saves use the historical 16px constants.
    state.homePos = { ...HOME_SPAWN_PIXEL };
  } else {
    state.homePos = normalizeHomePositionForMap(activeHomeMapForSave(), state.homePos);
  }

  if (legacyVersion) {
    const legacy = raw as LegacyGameState;
    const existing = new Map(legacy.quests.map((quest) => [quest.id, quest]));
    const completed = (id: string): boolean => existing.get(id)?.status === "complete";
    const stage: GameState["story"]["early"]["stage"] = completed("old-ring")
      ? "complete"
      : completed("missing") ? "ring" : completed("lost-sword") ? "missing" : completed("herb") ? "lostSword" : "herb";
    state.quests = structuredClone(INITIAL_QUESTS).map((template) => {
      const old = existing.get(template.id);
      if (old?.status === "complete" || old?.status === "active") return { ...template, status: old.status };
      return template;
    });
    const earlyStatus = (id: string, requiredStage: typeof stage): void => {
      const quest = state.quests.find((entry) => entry.id === id);
      if (!quest || quest.status === "active" || quest.status === "complete") return;
      quest.status = stage === requiredStage ? "available" : "locked";
    };
    earlyStatus("lost-sword", "lostSword");
    earlyStatus("missing", "missing");
    const ringQuest = state.quests.find((quest) => quest.id === "old-ring");
    if (ringQuest && stage === "ring" && ringQuest.status !== "complete") ringQuest.status = "active";
    if (stage === "complete") {
      const blackSword = state.quests.find((quest) => quest.id === "black-sword");
      if (blackSword?.status === "locked") blackSword.status = "available";
    }
    const guardHiringUnlocked = completed("lost-sword") || completed("missing") || completed("old-ring");
    state.guards.forEach((guard) => { guard.unlocked = guardHiringUnlocked; });
    state.story = {
      blackSword: legacy.story.blackSword,
      early: {
        stage,
        guardHiringUnlocked,
        missingBodyInspected: completed("missing") || completed("old-ring"),
        ringConsulted: completed("old-ring") ? ["scholar", "jeweler", "duke"] : [],
        ringResolution: completed("old-ring") ? "family" : undefined,
        shoveTutorialSeen: false,
      },
    };
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
    state.story.early ??= {
      stage: "herb",
      guardHiringUnlocked: false,
      missingBodyInspected: false,
      ringConsulted: [],
      shoveTutorialSeen: false,
    };
    if (state.run) {
      state.run.enemies.forEach((enemy) => { enemy.staggerTurns ??= 0; });
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
  (state as { version: number }).version = 7;
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
    if (version !== 5 && version !== 6) return undefined;
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
