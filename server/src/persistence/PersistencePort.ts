// The persistence PORT. This interface is the seam that makes the whole
// "start small, scale later" plan real. Your game logic depends only on this
// interface — never on Postgres/Redis/a-file directly.
//
// Day 1: back it with an in-memory or SQLite adapter (below).
// At scale: write a PostgresAdapter + RedisAdapter implementing the same port,
// and swap it in main.ts with a one-line change. No game code touched.
//
// This is exactly the dependency-inversion habit that also makes the systems
// testable: in tests you pass a fake adapter.

import { FarmState } from "../schema/FarmState.js";

export interface SavedPlayer {
  coins: number;
  lastDailyDay: number;
  dailyStreak: number;
}

export interface PersistencePort {
  loadPlayer(userId: string): Promise<SavedPlayer | null>;
  savePlayer(userId: string, data: SavedPlayer): Promise<void>;
  saveFarm(farmId: string, state: FarmState): Promise<void>;
  loadFarm(farmId: string): Promise<Record<string, unknown> | null>;
}

// --- Simplest possible adapter to get you running TODAY. -------------------
// In-memory: everything lost on restart. Replace with SQLite for local persist,
// then Postgres+Redis for scale. Same three method signatures throughout.
export class InMemoryPersistence implements PersistencePort {
  private players = new Map<string, SavedPlayer>();
  private farms = new Map<string, Record<string, unknown>>();

  async loadPlayer(userId: string) { return this.players.get(userId) ?? null; }
  async savePlayer(userId: string, data: SavedPlayer) { this.players.set(userId, data); }
  async saveFarm(farmId: string, state: FarmState) {
    // toJSON() gives a plain serializable snapshot of the synced schema.
    this.farms.set(farmId, (state as any).toJSON());
  }
  async loadFarm(farmId: string) { return this.farms.get(farmId) ?? null; }
}
