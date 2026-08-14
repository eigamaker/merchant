import { GUARD_DEFINITIONS, INITIAL_QUESTS } from "./content";
import type { DungeonBody, DungeonChest, DungeonHeight, DungeonMap, Enemy, GameState, ItemInstance, Quest, Vec } from "./types";
import { safeTownPosition, TOWN_SPAWN } from "./townMap";

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

function migrateDungeonMap(map: DungeonMap): void {
  map.formatVersion ??= 2;
  map.heights ??= Array.from({ length: map.height }, () => Array<DungeonHeight>(map.width).fill(0));
  map.hardEdges ??= [];
  map.ledgeEdges ??= [];
  map.traversalLinks ??= [];
}

export function migrateSaveState(raw: GameState | LegacyGameState | VersionTwoGameState): GameState {
  const legacyVersion = raw.version === 1;
  const state = raw as unknown as GameState;
  // 追加した任意項目を補い、既存のブラウザ保存を壊さない。
  state.returnStones ??= 1;
  state.smokeBombs ??= 2;
  state.archive ??= [];
  state.expeditionSerial ??= 0;
  state.guildReputation ??= 0;
  state.guards ??= Object.keys(GUARD_DEFINITIONS).map((id) => ({ id, unlocked: false, relation: 0, experience: 0, level: 1 }));
  state.townPos ??= { x: 9, y: 6 };
  state.worldMapId ??= "town-main";
  // 旧セーブはタイル座標、現在は町だけピクセル座標で保存する。
  if (state.townPos.x <= 21 && state.townPos.y <= 12) {
    state.townPos = { x: state.townPos.x * 24 + 12, y: state.townPos.y * 24 + 12 };
  }
  const legacy = state as GameState & { townMapRevision?: number };
  if ((legacy.townMapRevision ?? 0) < 3) {
    state.townPos = { ...TOWN_SPAWN };
    legacy.townMapRevision = 3;
  } else {
    state.townPos = safeTownPosition(state.townPos);
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
      state.run.shoveCooldown ??= 0;
      state.run.highestFloor ??= state.run.floor;
      migrateDungeonMap(state.run.map);
    }
  }
  if (state.run) migrateDungeonMap(state.run.map);
  (state as { version: number }).version = 3;
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
    if (!result || (result.state.version !== 1 && result.state.version !== 2 && result.state.version !== 3)) return undefined;
    result.state = migrateSaveState(result.state);
    return result as StoredSave & { state: GameState };
  }

  async availableSlots(): Promise<SaveSlot[]> {
    const slots: SaveSlot[] = ["autosave", "manual-1", "manual-2", "manual-3"];
    const saved = await Promise.all(slots.map(async (slot) => ({ slot, data: await this.load(slot) })));
    return saved.filter((entry) => entry.data !== undefined).map((entry) => entry.slot);
  }
}
