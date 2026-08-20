// The save seam.
//
// Same idea as the server's old PersistencePort, sized for single player: one
// atomic blob per slot rather than separate player/farm records, because a
// solo save has no reason to be split and a partial write is a corrupt farm.
//
// Game code depends on this interface, never on IndexedDB directly — which is
// what lets saves move to a server later without touching any rules.

import type { SavedFarm } from "./state.js";

export interface SaveStore {
  load(slot: string): Promise<SavedFarm | null>;
  save(slot: string, data: SavedFarm): Promise<void>;
  remove(slot: string): Promise<void>;
  list(): Promise<string[]>;
}

/** The slot a normal single-player session uses. */
export const DEFAULT_SLOT = "farm";

/** Losable, in-memory store — handy in tests and as a fallback. */
export class MemorySaveStore implements SaveStore {
  private slots = new Map<string, SavedFarm>();

  async load(slot: string) {
    return this.slots.get(slot) ?? null;
  }
  async save(slot: string, data: SavedFarm) {
    this.slots.set(slot, data);
  }
  async remove(slot: string) {
    this.slots.delete(slot);
  }
  async list() {
    return [...this.slots.keys()];
  }
}
