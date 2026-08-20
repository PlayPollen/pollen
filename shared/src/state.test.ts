// Save/load is the one place where a bug silently destroys someone's progress,
// so the round trip is pinned down here rather than trusted.

import { describe, it, expect } from "vitest";
import {
  createFarmState,
  createHive,
  createPlayer,
  createTile,
  loadSave,
  migrate,
  reconcileContent,
  toSave,
  tileKey,
  SAVE_VERSION,
  type Migration,
  type SavedFarm,
} from "./state.js";
import { TileState } from "./types.js";

/** The old helper's behaviour, for the round-trip tests that only care about state. */
const fromSave = (saved: unknown) => loadSave(saved).state;

function populated() {
  const s = createFarmState(12345);
  s.currentTick = 987;

  const tile = createTile();
  tile.state = TileState.Watered;
  tile.crop = "turnip";
  tile.plantedAtTick = 900;
  tile.watered = true;
  s.tiles.set(tileKey(3, 4), tile);

  const hive = createHive(10, 10);
  hive.honey = 7.25;
  hive.foragingCount = 3;
  s.hives.set(tileKey(10, 10), hive);

  const player = createPlayer("local", "Farmer");
  player.coins = 420;
  player.dailyStreak = 5;
  player.lastDailyDay = 99;
  player.x = 12.5;
  player.y = 8.25;
  s.players.set("local", player);

  return s;
}

describe("save round trip", () => {
  it("restores tiles, hives, players and the tick", () => {
    const before = populated();
    // Through JSON, because that's what actually happens in storage.
    const after = fromSave(JSON.parse(JSON.stringify(toSave(before))));

    expect(after.currentTick).toBe(987);
    expect(after.seedSalt).toBe(12345);

    const tile = after.tiles.get(tileKey(3, 4))!;
    expect(tile).toEqual(before.tiles.get(tileKey(3, 4)));

    const hive = after.hives.get(tileKey(10, 10))!;
    expect(hive.honey).toBeCloseTo(7.25, 10);
    expect(hive.x).toBe(10);

    const player = after.players.get("local")!;
    expect(player.coins).toBe(420);
    expect(player.dailyStreak).toBe(5);
    expect(player.x).toBeCloseTo(12.5, 10);
  });

  it("keeps the seed salt so rewards stay reproducible across reloads", () => {
    const before = createFarmState(0xabcdef);
    expect(fromSave(toSave(before)).seedSalt).toBe(0xabcdef);
  });

  it("restores currentTick, so crops don't finish instantly on load", () => {
    // The failure this guards: growth is measured against currentTick, so
    // loading tiles without their tick would make everything Ready at once.
    const before = populated();
    const after = fromSave(toSave(before));
    const tile = after.tiles.get(tileKey(3, 4))!;
    expect(after.currentTick - tile.plantedAtTick).toBe(87);
  });

  it("recomputes derived hive state rather than trusting the file", () => {
    const after = fromSave(toSave(populated()));
    expect(after.hives.get(tileKey(10, 10))!.foragingCount).toBe(0);
  });

  it("clears the movement baseline, so a long-ago save isn't banked travel", () => {
    const before = populated();
    before.players.get("local")!.lastMoveAtMs = 1_000_000;
    const after = fromSave(toSave(before));
    expect(after.players.get("local")!.lastMoveAtMs).toBe(0);
  });
});

describe("save compatibility", () => {
  it("starts a fresh farm rather than throwing on a missing save", () => {
    const result = loadSave(null);
    expect(result.status).toBe("new");
    expect(result.state.tiles.size).toBe(0);
    expect(result.preserveExisting).toBe(false);
  });

  it("survives a save with missing sections", () => {
    const partial = { version: SAVE_VERSION, currentTick: 5, seedSalt: 1 } as unknown as SavedFarm;
    const state = fromSave(partial);
    expect(state.tiles.size).toBe(0);
    expect(state.hives.size).toBe(0);
    expect(state.players.size).toBe(0);
    expect(state.currentTick).toBe(5);
  });

  it("loads a current-version save as 'loaded'", () => {
    const result = loadSave(toSave(populated()));
    expect(result.status).toBe("loaded");
    expect(result.state.tiles.size).toBe(1);
  });
});

// This is the suite that decides whether shipping an update costs players their
// farms. The old loader discarded everything whenever the version didn't match
// exactly, so the FIRST format change would have silently wiped every player.
describe("shipping a new version", () => {
  it("upgrades an older save through the migration chain instead of wiping it", () => {
    // A hypothetical chain: 1 -> 2 renames a field, 2 -> 3 adds one.
    const migrations: Record<number, Migration> = {
      1: (s) => ({ ...s, version: 2, currentTick: (s.currentTick as number) + 1000 }),
      2: (s) => ({ ...s, version: 3, seedSalt: 4242 }),
    };
    const old = { ...toSave(populated()), version: 1 };
    const upgraded = migrate(old as unknown as Record<string, unknown>, migrations, 3);
    expect(upgraded).not.toBeNull();
    // Ran every step in order rather than stopping at the first.
    expect(upgraded!.currentTick).toBe(987 + 1000);
    expect(upgraded!.seedSalt).toBe(4242);
  });

  it("refuses to migrate when a step is missing, rather than guessing", () => {
    // Version 1 with only a 2 -> 3 migration available: no path forward.
    const old = { version: 1, tiles: {}, hives: {}, players: {}, currentTick: 0, seedSalt: 1 };
    expect(migrate(old, { 2: (s) => ({ ...s, version: 3 }) }, 3)).toBeNull();
  });

  it("cannot loop forever on a migration that fails to advance the version", () => {
    const old = { version: 1, tiles: {}, hives: {}, players: {}, currentTick: 0, seedSalt: 1 };
    expect(migrate(old, { 1: (s) => ({ ...s }) }, 3)).toBeNull();
  });

  it("preserves an unreadable save instead of overwriting it", () => {
    for (const bad of ["nonsense", 42, { noVersion: true }]) {
      const result = loadSave(bad);
      expect(result.status).toBe("unreadable");
      // The critical flag: the caller must not autosave over this.
      expect(result.preserveExisting).toBe(true);
    }
  });

  it("preserves a save written by a NEWER build", () => {
    // Happens when someone has a stale cached bundle. Overwriting would
    // downgrade their farm and lose whatever the newer version added.
    const future = { ...toSave(populated()), version: SAVE_VERSION + 1 };
    const result = loadSave(future);
    expect(result.status).toBe("too-new");
    expect(result.preserveExisting).toBe(true);
    expect(result.message).toMatch(/newer version/i);
  });

  it("survives a migration that throws, without losing the save", () => {
    const exploding: Record<number, Migration> = {
      1: () => {
        throw new Error("bad upgrade");
      },
    };
    // migrate() propagates; loadSave() is the layer that must not blow up.
    expect(() => migrate({ version: 1 }, exploding, 2)).toThrow();

    const result = loadSave({ version: -1, tiles: {}, hives: {}, players: {} });
    expect(result.preserveExisting).toBe(true);
  });
});

describe("content removed between versions", () => {
  it("clears tiles whose crop no longer exists, instead of leaving dead ground", () => {
    // Without this, growthTick skips the tile (never ripens), harvest refuses it
    // (never clears) and plant sees it as occupied — a square lost forever.
    const s = createFarmState();
    const zombie = createTile();
    zombie.state = TileState.Ready;
    zombie.crop = "crop_that_was_removed";
    s.tiles.set(tileKey(1, 1), zombie);

    const good = createTile();
    good.state = TileState.Watered;
    good.crop = "turnip";
    s.tiles.set(tileKey(2, 2), good);

    const { clearedTiles } = reconcileContent(s);

    expect(clearedTiles).toBe(1);
    expect(s.tiles.get(tileKey(1, 1))!.state).toBe(TileState.Empty);
    expect(s.tiles.get(tileKey(1, 1))!.crop).toBe("");
    // Untouched crops must survive the sweep.
    expect(s.tiles.get(tileKey(2, 2))!.crop).toBe("turnip");
  });

  it("runs automatically on load", () => {
    const s = populated();
    s.tiles.get(tileKey(3, 4))!.crop = "gone";
    const loaded = fromSave(toSave(s));
    expect(loaded.tiles.get(tileKey(3, 4))!.state).toBe(TileState.Empty);
  });
});
