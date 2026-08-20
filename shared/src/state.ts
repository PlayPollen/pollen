// The game's state model, as PLAIN data.
//
// This used to be @colyseus/schema classes living in the server, which meant the
// game rules could only run inside a server process. They're plain objects now,
// so the exact same rules run in the browser — no round trip, no hosting, and
// the game works offline.
//
// Nothing in here imports a framework, on purpose. That's what keeps the rules
// portable if co-op ever wants them on a server again.

import { CROPS, TileState } from "./types.js";
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

/**
 * Bump when the saved shape changes — and add a matching entry to MIGRATIONS.
 * Bumping without a migration is the same as deleting everyone's farm.
 */
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

// --- Migrations -----------------------------------------------------------
// A save written by ANY previous version must still open. Each entry upgrades a
// save by exactly one version, and they run in sequence, so a v1 save opened by
// v4 code goes 1→2→3→4 without anyone writing a 1→4 special case.
//
// Rules for writing one:
//   - Never throw. A migration that throws locks the player out of their farm.
//   - Never assume a field exists; old saves predate it by definition.
//   - Prefer defaulting over discarding. Losing a hive is better than losing a
//     farm, and losing nothing is better still.

/** Upgrades a save from version N to N+1. Receives untyped, untrusted data. */
export type Migration = (save: Record<string, unknown>) => Record<string, unknown>;

/** Keyed by the version being upgraded FROM. */
export const MIGRATIONS: Record<number, Migration> = {
  // Example of the shape, for when the first real one is needed:
  //
  // 1: (save) => ({
  //   ...save,
  //   version: 2,
  //   hives: mapValues(save.hives, (h) => ({ ...h, level: h.level ?? 1 })),
  // }),
};

export type LoadStatus =
  /** No save existed — a brand new farm. */
  | "new"
  /** Loaded as-is, versions matched. */
  | "loaded"
  /** Loaded after upgrading from an older format. */
  | "migrated"
  /** The save is from a NEWER build than this code understands. */
  | "too-new"
  /** The save exists but could not be read. */
  | "unreadable";

export interface LoadResult {
  state: FarmState;
  status: LoadStatus;
  /** The version found on disk, when there was one. */
  savedVersion?: number;
  /** Human-readable explanation for the statuses that need one. */
  message?: string;
  /**
   * True when the existing save MUST NOT be overwritten. Loading a farm we
   * couldn't parse and then autosaving over it would destroy the very thing we
   * failed to read — the one outcome worse than showing an error.
   */
  preserveExisting: boolean;
}

/**
 * Run the migration chain. Returns null if it can't reach the target version.
 *
 * `migrations` and `target` are injectable so the chain can be tested for
 * versions that don't exist yet — otherwise this would only become testable
 * after the first real format change, which is exactly too late.
 */
export function migrate(
  raw: Record<string, unknown>,
  migrations: Record<number, Migration> = MIGRATIONS,
  target: number = SAVE_VERSION,
): Record<string, unknown> | null {
  let save = raw;
  let guard = 0;

  while (typeof save.version === "number" && save.version < target) {
    const from = save.version;
    const step = migrations[from];
    if (!step) return null; // no path forward; caller decides what to tell the player

    save = step(save);

    // A migration that fails to advance the version would spin forever.
    if (typeof save.version !== "number" || save.version <= from) return null;
    if (++guard > 100) return null;
  }

  return save;
}

/**
 * Read a save into playable state, upgrading it if needed.
 *
 * Replaces the old `fromSave`, which discarded the entire farm whenever the
 * version didn't match exactly — meaning the first format change would have
 * silently wiped every existing player.
 */
export function loadSave(saved: unknown): LoadResult {
  if (saved === null || saved === undefined) {
    return { state: createFarmState(), status: "new", preserveExisting: false };
  }

  if (typeof saved !== "object") {
    return {
      state: createFarmState(),
      status: "unreadable",
      message: "The save file isn't in a recognisable format.",
      preserveExisting: true,
    };
  }

  const raw = saved as Record<string, unknown>;
  const savedVersion = typeof raw.version === "number" ? raw.version : undefined;

  if (savedVersion === undefined) {
    return {
      state: createFarmState(),
      status: "unreadable",
      message: "The save file has no version and can't be read safely.",
      preserveExisting: true,
    };
  }

  // A save from a newer build. Usually means an old cached bundle. Starting a
  // fresh farm is fine; overwriting the newer save is not.
  if (savedVersion > SAVE_VERSION) {
    return {
      state: createFarmState(),
      status: "too-new",
      savedVersion,
      message:
        "This farm was saved by a newer version of the game. Reload the page to get the latest version.",
      preserveExisting: true,
    };
  }

  let upgraded: Record<string, unknown> | null;
  try {
    upgraded = migrate(raw);
  } catch (err) {
    // A throwing migration must not cost anyone their farm.
    return {
      state: createFarmState(),
      status: "unreadable",
      savedVersion,
      message: `Couldn't upgrade this farm: ${err instanceof Error ? err.message : String(err)}`,
      preserveExisting: true,
    };
  }

  if (!upgraded) {
    return {
      state: createFarmState(),
      status: "unreadable",
      savedVersion,
      message: `No upgrade path from save version ${savedVersion}.`,
      preserveExisting: true,
    };
  }

  try {
    return {
      state: hydrate(upgraded as unknown as SavedFarm),
      status: savedVersion === SAVE_VERSION ? "loaded" : "migrated",
      savedVersion,
      preserveExisting: false,
    };
  } catch (err) {
    return {
      state: createFarmState(),
      status: "unreadable",
      savedVersion,
      message: `Couldn't read this farm: ${err instanceof Error ? err.message : String(err)}`,
      preserveExisting: true,
    };
  }
}

/** Turn a current-version save into live state. Assumes the version matches. */
function hydrate(saved: SavedFarm): FarmState {
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
  reconcileContent(state);
  return state;
}

/**
 * Clear anything referring to content this build no longer has.
 *
 * A tile holding a removed or renamed crop id doesn't crash — it becomes a
 * zombie. `growthTick` skips it so it never ripens, `harvest` refuses it so it
 * never clears, and `plant` sees it as occupied. The square is dead ground the
 * player can never reclaim. Clearing it back to bare soil loses one crop; not
 * clearing it costs them the tile permanently.
 */
export function reconcileContent(state: FarmState): { clearedTiles: number } {
  let clearedTiles = 0;

  state.tiles.forEach((tile) => {
    if (tile.state === TileState.Empty) return;
    if (CROPS[tile.crop]) return;

    tile.state = TileState.Empty;
    tile.crop = "";
    tile.watered = false;
    tile.plantedAtTick = 0;
    clearedTiles++;
  });

  return { clearedTiles };
}
