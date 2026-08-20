// Beekeeping rules. Same contract as farming.ts: pure-ish functions over state,
// server-side only, no RNG of their own — so every number here is unit-testable
// without a network or a client.
//
// The mechanic in one sentence: bees turn nearby GROWN FLOWERS into honey, and
// the same coverage pollinates nearby CROPS. Flowers are the input to both.

import { FarmState, Player, createHive } from "../state.js";
import {
  CROPS,
  HIVE,
  POLLINATION,
  TileState,
  FARM_WIDTH,
  FARM_HEIGHT,
  withinReach,
} from "../types.js";

const key = (x: number, y: number) => `${x},${y}`;
const inBounds = (x: number, y: number) =>
  x >= 0 && y >= 0 && x < FARM_WIDTH && y < FARM_HEIGHT;

// Square (Chebyshev) coverage rather than a circle: it reads unambiguously on a
// tile grid, so a player can see exactly which tiles a hive works.
const inRange = (hx: number, hy: number, x: number, y: number) =>
  Math.abs(hx - x) <= HIVE.range && Math.abs(hy - y) <= HIVE.range;

/**
 * Only a fully bloomed flower feeds bees — a seedling has no nectar.
 *
 * This is the central tension of the whole mechanic: a Ready flower can either
 * be harvested for its (small) coin value, or left standing to keep the hive
 * working. Counting half-grown flowers would erase that choice, because you
 * could harvest every bloom the instant it appeared and lose nothing.
 */
function isForageable(state: FarmState, x: number, y: number): boolean {
  const tile = state.tiles.get(key(x, y));
  if (!tile) return false;
  if (tile.state !== TileState.Ready) return false;
  return CROPS[tile.crop]?.category === "flower";
}

export function placeHive(state: FarmState, player: Player, x: number, y: number): boolean {
  if (!inBounds(x, y)) return false;
  if (!withinReach(player.x, player.y, x, y)) return false;
  if (player.coins < HIVE.placeCost) return false;
  const k = key(x, y);
  if (state.hives.has(k)) return false;                       // one hive per tile

  // Can't drop a hive on top of a growing crop.
  const tile = state.tiles.get(k);
  if (tile && tile.state !== TileState.Empty) return false;

  player.coins -= HIVE.placeCost;                             // charged by the rules, never by the caller
  state.hives.set(k, createHive(x, y));
  return true;
}

/**
 * Advance every hive by one tick. Counts grown flowers in range and accrues
 * honey proportionally, capped both by `maxForagers` (one hive can only work so
 * much land) and `capacity` (a full hive stops until you collect).
 */
export function beeTick(state: FarmState): void {
  state.hives.forEach((hive) => {
    let foragers = 0;
    for (let dy = -HIVE.range; dy <= HIVE.range; dy++) {
      for (let dx = -HIVE.range; dx <= HIVE.range; dx++) {
        const x = hive.x + dx;
        const y = hive.y + dy;
        if (!inBounds(x, y)) continue;
        if (isForageable(state, x, y)) foragers++;
        if (foragers >= HIVE.maxForagers) break;
      }
      if (foragers >= HIVE.maxForagers) break;
    }

    hive.foragingCount = foragers;
    if (foragers === 0) return;                               // idle hive, no honey
    if (hive.honey >= HIVE.capacity) return;                  // full: go collect

    hive.honey = Math.min(
      HIVE.capacity,
      hive.honey + foragers * HIVE.honeyPerFlowerPerTick,
    );
  });
}

/**
 * Is this tile covered by at least one hive? Coverage is binary on purpose:
 * stacking hives on one plot shouldn't multiply the bonus, or the optimal play
 * collapses into "build hives everywhere" instead of "lay out a farm".
 */
export function isPollinated(state: FarmState, x: number, y: number): boolean {
  let covered = false;
  state.hives.forEach((hive) => {
    if (!covered && inRange(hive.x, hive.y, x, y)) covered = true;
  });
  return covered;
}

/** The multipliers a pollinated tile gets. Kept here so farming.ts stays thin. */
export function pollinationBonus(pollinated: boolean) {
  return pollinated
    ? { yieldMultiplier: POLLINATION.yieldMultiplier, rareChanceMultiplier: POLLINATION.rareChanceMultiplier }
    : { yieldMultiplier: 1, rareChanceMultiplier: 1 };
}

export interface HoneyResult {
  ok: boolean;
  units: number;
  coins: number;
}

/**
 * Collect whole units of honey. The fractional remainder stays in the hive, so
 * repeatedly tapping "collect" can never round scraps into free coins.
 */
export function collectHoney(
  state: FarmState,
  player: Player,
  x: number,
  y: number,
): HoneyResult {
  const fail: HoneyResult = { ok: false, units: 0, coins: 0 };
  if (!withinReach(player.x, player.y, x, y)) return fail;
  const hive = state.hives.get(key(x, y));
  if (!hive) return fail;

  const units = Math.floor(hive.honey);
  if (units <= 0) return fail;

  hive.honey -= units;
  const coins = units * HIVE.honeyCoinValue;
  player.coins += coins;
  return { ok: true, units, coins };
}
