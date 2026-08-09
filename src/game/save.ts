import type { GameState } from "./types";

export type SaveSlot = "autosave" | "manual-1" | "manual-2" | "manual-3";

interface StoredSave {
  slot: SaveSlot;
  savedAt: string;
  state: GameState;
}

const DATABASE_NAME = "dungeon-curio-merchant";
const STORE_NAME = "campaigns";

function migrate(state: GameState): GameState {
  // 追加した任意項目を補い、既存のブラウザ保存を壊さない。
  state.returnStones ??= 1;
  state.smokeBombs ??= 2;
  state.archive ??= [];
  state.townPos ??= { x: 9, y: 6 };
  // 旧セーブはタイル座標、現在は町だけピクセル座標で保存する。
  if (state.townPos.x <= 21 && state.townPos.y <= 12) {
    state.townPos = { x: state.townPos.x * 24 + 12, y: state.townPos.y * 24 + 12 };
  }
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

  async load(slot: SaveSlot): Promise<StoredSave | undefined> {
    const database = await openDatabase();
    const result = await new Promise<StoredSave | undefined>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(slot);
      request.onsuccess = () => resolve(request.result as StoredSave | undefined);
      request.onerror = () => reject(request.error);
    });
    database.close();
    if (!result || result.state.version !== 1) return undefined;
    result.state = migrate(result.state);
    return result;
  }

  async availableSlots(): Promise<SaveSlot[]> {
    const slots: SaveSlot[] = ["autosave", "manual-1", "manual-2", "manual-3"];
    const saved = await Promise.all(slots.map(async (slot) => ({ slot, data: await this.load(slot) })));
    return saved.filter((entry) => entry.data !== undefined).map((entry) => entry.slot);
  }
}
