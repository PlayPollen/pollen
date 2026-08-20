// ALL game rules live here, on the server. Each function takes current state +
// a validated request and returns what actually happened. The room (next file)
// wires these to network messages. Keeping the rules in pure-ish functions like
// this means you can unit-test every reward path without a network or a client.

import { FarmState, Player, createTile } from "../state.js";
import { CROPS, TileState, FARM_WIDTH, FARM_HEIGHT, withinReach } from "../types.js";
import { makeRng, rollYield, rollRare } from "./rng.js";
import { isPollinated, pollinationBonus } from "./beekeeping.js";

const key = (x: number, y: number) => `${x},${y}`;
const inBounds = (x: number, y: number) =>
  x >= 0 && y >= 0 && x < FARM_WIDTH && y < FARM_HEIGHT;

// Every action is gated on the player standing near the tile. This check lives
// in the systems layer rather than the room so that NO caller can skip it —
// the room only routes messages, it never decides what's legal.
export function plant(state: FarmState, player: Player, x: number, y: number, cropId: string): boolean {
  if (!inBounds(x, y)) return false;
  if (!withinReach(player.x, player.y, x, y)) return false;
  const def = CROPS[cropId];
  if (!def) return false;                          // reject unknown crops
  if (player.coins < def.seedCost) return false;   // server checks the wallet
  const k = key(x, y);
  if (state.hives.has(k)) return false;            // a hive already sits here
  const existing = state.tiles.get(k);
  if (existing && existing.state !== TileState.Empty) return false; // occupied

  player.coins -= def.seedCost;                    // charge server-side
  const tile = existing ?? createTile();
  tile.state = TileState.Planted;
  tile.crop = cropId;
  tile.plantedAtTick = state.currentTick;          // server stamps the time
  tile.watered = false;
  state.tiles.set(k, tile);
  return true;
}

export function water(state: FarmState, player: Player, x: number, y: number): boolean {
  if (!withinReach(player.x, player.y, x, y)) return false;
  const tile = state.tiles.get(key(x, y));
  if (!tile || tile.state === TileState.Empty) return false;
  tile.watered = true;
  if (tile.state === TileState.Planted) tile.state = TileState.Watered;
  return true;
}

// Result carries what the player earned, so the room can emit a juicy event
// to that client (screen shake, coin shower, "RARE!" banner).
export interface HarvestResult {
  ok: boolean;
  amount: number;
  rare: boolean;
  coins: number;
  pollinated: boolean;     // so the client can celebrate the bee bonus
}

export function harvest(
  state: FarmState,
  player: Player,
  x: number,
  y: number,
  seedSalt: number,
): HarvestResult {
  const fail: HarvestResult = { ok: false, amount: 0, rare: false, coins: 0, pollinated: false };
  if (!withinReach(player.x, player.y, x, y)) return fail;
  const tile = state.tiles.get(key(x, y));
  if (!tile || tile.state !== TileState.Ready) return fail;  // must be grown
  const def = CROPS[tile.crop];
  if (!def) return fail;

  // Seed the roll from state the CLIENT CANNOT PREDICT OR CHANGE: server tick,
  // tile position, plant time, and a per-room salt. Same inputs -> same result,
  // so it's testable, but the client can't grind for a good seed.
  const rng = makeRng((state.currentTick ^ (x * 73856093) ^ (y * 19349663) ^ tile.plantedAtTick ^ seedSalt) >>> 0);

  // Bees improve the ODDS, not the outcome: the bonus changes the inputs to the
  // roll, never the roll itself. The RNG stream is consumed identically either
  // way, so a pollinated and unpollinated harvest stay directly comparable — and
  // both stay reproducible from the same seed.
  const { yieldMultiplier, rareChanceMultiplier } = pollinationBonus(
    isPollinated(state, x, y),
  );
  const maxYield = Math.round(def.maxYield * yieldMultiplier);
  const rareChance = Math.min(1, def.rareChance * rareChanceMultiplier);

  const amount = rollYield(rng, def.minYield, maxYield);
  const rare = rollRare(rng, rareChance);
  const coins = amount * 10 + (rare ? 100 : 0);

  player.coins += coins;

  // reset tile
  tile.state = TileState.Empty;
  tile.crop = "";
  tile.watered = false;
  return { ok: true, amount, rare, coins, pollinated: yieldMultiplier > 1 };
}

// Called every server tick to advance growth. Watered crops grow; unwatered
// ones stall — a gentle, diegetic daily-return hook (your farm needs you).
export function growthTick(state: FarmState): void {
  state.currentTick += 1;
  state.tiles.forEach((tile) => {
    if (tile.state === TileState.Watered) {
      const def = CROPS[tile.crop];
      if (!def) return;
      if (state.currentTick - tile.plantedAtTick >= def.growTicks) {
        tile.state = TileState.Ready;
      }
    }
  });
}

// Daily reward with streak, keyed to a server-computed day index so the client
// clock is irrelevant. Returns coins granted (0 if already claimed today).
export function claimDaily(player: Player, serverDayIndex: number): number {
  if (player.lastDailyDay === serverDayIndex) return 0;       // already claimed
  const consecutive = serverDayIndex === player.lastDailyDay + 1;
  player.dailyStreak = consecutive ? player.dailyStreak + 1 : 1;
  player.lastDailyDay = serverDayIndex;
  const reward = 50 + Math.min(player.dailyStreak, 7) * 10;   // caps the ramp
  player.coins += reward;
  return reward;
}
