// The game's state model, as PLAIN data.
//
// This used to be @colyseus/schema classes living in the server, which meant the
// game rules could only run inside a server process. They're plain objects now,
// so the exact same rules run in the browser — no round trip, no hosting, and
// the game works offline.
//
// Nothing in here imports a framework, on purpose. That's what keeps the rules
// portable if co-op ever wants them on a server again.

import { TileState } from "./types.js";
import { defaultAppearance, sanitizeAppearance, type Appearance } from "./appearance.js";

export interface Tile {
  state: TileState;
  crop: string;
  /** Stamped when planted; growth is measured against it in ticks. */
  plantedAtTick: number;
  watered: boolean;
}

export interface Hive {
  x: number;
  y: number;
  level: number;
  /** Accrues fractionally each tick; only whole units can be collected. */
  honey: number;
  /** Derived each tick — how many flowers this hive is currently working. */
  foragingCount: number;
}

export interface Player {
  id: string;
  name: string;
  appearance: Appearance;
  coins: number;
  x: number;
  y: number;
  lastDailyDay: number;
  dailyStreak: number;
  /** Movement speed-check baseline. Meaningful only when a server validates. */
  lastMoveAtMs: number;
}

export interface FarmState {
  /** Sparse, keyed "x,y" — untouched ground costs nothing to store. */
  tiles: Map<string, Tile>;
  hives: Map<string, Hive>;
  players: Map<string, Player>;
  currentTick: number;
  paused: boolean;
  /**
   * Per-save salt mixed into every reward roll. Persisted so outcomes stay
   * reproducible across reloads rather than being re-randomised on every boot.
   */
  seedSalt: number;
}

export const tileKey = (x: number, y: number) => `${x},${y}`;

export function createTile(): Tile {
  return { state: TileState.Empty, crop: "", plantedAtTick: 0, watered: false };
}

export function createHive(x: number, y: number): Hive {
  return { x, y, level: 1, honey: 0, foragingCount: 0 };
}

export function createPlayer(id: string, name = "Farmer"): Player {
  return {
    id,
    name,
    appearance: defaultAppearance(),
    coins: 100,
    x: 0,
    y: 0,
    lastDailyDay: 0,
    dailyStreak: 0,
    lastMoveAtMs: 0,
  };
}

export function createFarmState(seedSalt = (Math.random() * 0xffffffff) >>> 0): FarmState {
  return {
    tiles: new Map(),
    hives: new Map(),
    players: new Map(),
    currentTick: 0,
    paused: false,
    seedSalt: seedSalt >>> 0,
  };
}

// --- Serialisation --------------------------------------------------------
// Maps don't survive JSON, so saving and loading go through these. Keeping the
// shape explicit (rather than reaching for a generic serialiser) means a save
// format change is a visible edit here.

export interface SavedFarm {
  version: number;
  tiles: Record<string, Tile>;
  hives: Record<string, Hive>;
  /** Included in the same blob: a single-player save is one atomic thing. */
  players: Record<string, Player>;
  currentTick: number;
  seedSalt: number;
}

/** Bump when the saved shape changes, and handle the old one in `fromSave`. */
export const SAVE_VERSION = 1;

export function toSave(state: FarmState): SavedFarm {
  return {
    version: SAVE_VERSION,
    tiles: Object.fromEntries(state.tiles),
    hives: Object.fromEntries(state.hives),
    players: Object.fromEntries(state.players),
    currentTick: state.currentTick,
    seedSalt: state.seedSalt,
  };
}

export function fromSave(saved: SavedFarm | null): FarmState {
  if (!saved || saved.version !== SAVE_VERSION) return createFarmState();

  const state = createFarmState(saved.seedSalt);
  for (const [key, tile] of Object.entries(saved.tiles ?? {})) {
    state.tiles.set(key, { ...createTile(), ...tile });
  }
  for (const [key, hive] of Object.entries(saved.hives ?? {})) {
    // foragingCount is derived; the next tick recomputes it.
    state.hives.set(key, { ...createHive(hive.x, hive.y), ...hive, foragingCount: 0 });
  }
  for (const [key, player] of Object.entries(saved.players ?? {})) {
    state.players.set(key, {
      ...createPlayer(player.id, player.name),
      ...player,
      // Clamped, so a save from before a palette changed can't index off the end.
      appearance: sanitizeAppearance(player.appearance),
      // lastMoveAtMs is a live speed-check baseline, never restored from disk.
      lastMoveAtMs: 0,
    });
  }
  // Growth is measured against currentTick, so restoring tiles without the tick
  // they were saved at would make every crop instantly ready.
  state.currentTick = saved.currentTick ?? 0;
  return state;
}
