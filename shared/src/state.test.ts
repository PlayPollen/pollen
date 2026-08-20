// Save/load is the one place where a bug silently destroys someone's progress,
// so the round trip is pinned down here rather than trusted.

import { describe, it, expect } from "vitest";
import {
  createFarmState,
  createHive,
  createPlayer,
  createTile,
  fromSave,
  toSave,
  tileKey,
  SAVE_VERSION,
  type SavedFarm,
} from "./state.js";
import { TileState } from "./types.js";

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
    const state = fromSave(null);
    expect(state.tiles.size).toBe(0);
    expect(state.currentTick).toBe(0);
  });

  it("starts fresh on an unknown save version instead of loading garbage", () => {
    const stale = { ...toSave(populated()), version: SAVE_VERSION + 1 };
    const state = fromSave(stale);
    expect(state.tiles.size).toBe(0);
  });

  it("survives a save with missing sections", () => {
    const partial = { version: SAVE_VERSION, currentTick: 5, seedSalt: 1 } as unknown as SavedFarm;
    const state = fromSave(partial);
    expect(state.tiles.size).toBe(0);
    expect(state.hives.size).toBe(0);
    expect(state.players.size).toBe(0);
    expect(state.currentTick).toBe(5);
  });
});
