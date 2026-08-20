// IndexedDB implementation of the SaveStore seam.
//
// Chosen over localStorage because saves are written during play: localStorage
// is synchronous and would stall the frame on every autosave, and its ~5MB cap
// is a wall a growing world would eventually hit. IndexedDB is async and roomy.
//
// Deliberately hand-rolled rather than pulling in a wrapper library — this is
// one object store with get/put/delete, and the whole surface is below.

import type { SaveStore, SavedFarm } from "@pollen/shared";

const DB_NAME = "pollen";
const DB_VERSION = 1;
const STORE = "saves";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("could not open IndexedDB"));
  });
}

function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
        tx.oncomplete = () => db.close();
      }),
  );
}

export class IndexedDbSaveStore implements SaveStore {
  async load(slot: string): Promise<SavedFarm | null> {
    const value = await run<SavedFarm | undefined>("readonly", (s) => s.get(slot));
    return value ?? null;
  }

  async save(slot: string, data: SavedFarm): Promise<void> {
    // structuredClone-able by construction: the save is plain objects only.
    await run("readwrite", (s) => s.put(data, slot));
  }

  async remove(slot: string): Promise<void> {
    await run("readwrite", (s) => s.delete(slot));
  }

  async list(): Promise<string[]> {
    const keys = await run<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
    return keys.map(String);
  }
}

/**
 * IndexedDB is unavailable in some private-browsing modes and blocked when
 * site data is disabled. Callers fall back to an in-memory store so the game
 * still runs — it just won't persist.
 */
export async function isAvailable(): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  try {
    (await open()).close();
    return true;
  } catch {
    return false;
  }
}
