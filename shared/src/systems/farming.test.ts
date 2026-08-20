// This test file is the payoff of every architecture decision above. Because
// game logic is server-side, pure, and RNG is seeded, you can assert EXACT
// reward outcomes with zero network and zero client. This is the QA leverage
// that most game codebases never get — lean into it.

import { describe, it, expect } from "vitest";
import { FarmState, createFarmState, createPlayer, createTile } from "../state.js";
import * as farming from "./farming.js";
import { TileState, PLAYER } from "../types.js";

function readyTile(state: FarmState, x: number, y: number, crop: string, plantedAtTick = 0) {
  const t = createTile();
  t.state = TileState.Ready; t.crop = crop; t.plantedAtTick = plantedAtTick;
  state.tiles.set(`${x},${y}`, t);
}

/** A player standing on the given tile, so reach checks pass by default. */
function playerAt(x: number, y: number, coins = 100) {
  const p = createPlayer("test");
  p.x = x; p.y = y; p.coins = coins;
  return p;
}

describe("harvest", () => {
  it("is deterministic for a fixed seedSalt (replayable outcomes)", () => {
    const make = () => {
      const s = createFarmState(); s.currentTick = 500;
      const p = playerAt(3, 4, 0);
      readyTile(s, 3, 4, "turnip");
      return { s, p };
    };
    const a = make(); const r1 = farming.harvest(a.s, a.p, 3, 4, 123456);
    const b = make(); const r2 = farming.harvest(b.s, b.p, 3, 4, 123456);
    expect(r1).toEqual(r2);                 // same seed -> identical reward
    expect(r1.ok).toBe(true);
  });

  it("rejects harvesting a tile that isn't Ready (anti-cheat)", () => {
    const s = createFarmState(); const p = playerAt(1, 1);
    const t = createTile(); t.state = TileState.Planted; s.tiles.set("1,1", t);
    const r = farming.harvest(s, p, 1, 1, 1);
    expect(r.ok).toBe(false);
    expect(p.coins).toBe(100);              // wallet untouched
  });
});

describe("plant", () => {
  it("refuses when the player can't afford the seed", () => {
    const s = createFarmState(); const p = playerAt(0, 0, 0);
    expect(farming.plant(s, p, 0, 0, "starfruit")).toBe(false);
  });
});

// The reach gate is what makes the character mechanically real rather than
// decorative: without it a modified client could work the entire grid from a
// single spot, which would also make co-op meaningless.
describe("action range", () => {
  const far = PLAYER.actionRange + 1;

  it("refuses to plant a tile out of reach", () => {
    const s = createFarmState(); const p = playerAt(0, 0, 1000);
    expect(farming.plant(s, p, far, 0, "turnip")).toBe(false);
    expect(p.coins).toBe(1000);             // not charged for a refused action
  });

  it("allows planting at the edge of reach", () => {
    const s = createFarmState(); const p = playerAt(0, 0, 1000);
    expect(farming.plant(s, p, PLAYER.actionRange, PLAYER.actionRange, "turnip")).toBe(true);
  });

  it("refuses to water out of reach", () => {
    const s = createFarmState(); const p = playerAt(0, 0, 1000);
    const t = createTile(); t.state = TileState.Planted; t.crop = "turnip";
    s.tiles.set(`${far},0`, t);
    expect(farming.water(s, p, far, 0)).toBe(false);
    expect(t.state).toBe(TileState.Planted);   // untouched
  });

  it("refuses to harvest out of reach, leaving the crop standing", () => {
    const s = createFarmState(); const p = playerAt(0, 0, 0);
    readyTile(s, far, 0, "turnip");
    const r = farming.harvest(s, p, far, 0, 1);
    expect(r.ok).toBe(false);
    expect(p.coins).toBe(0);
    // The crop must still be there — a refused harvest can't consume the tile.
    expect(s.tiles.get(`${far},0`)!.state).toBe(TileState.Ready);
  });

  it("uses a square (Chebyshev) reach, matching how the grid reads", () => {
    const s = createFarmState(); const p = playerAt(0, 0, 1000);
    const r = PLAYER.actionRange;
    // The far corner of the square is further away in a straight line than the
    // edge, but is still legally in reach.
    expect(farming.plant(s, p, r, r, "turnip")).toBe(true);
  });
});

describe("claimDaily", () => {
  it("grants once per server day and builds a streak", () => {
    const p = playerAt(0, 0);
    expect(farming.claimDaily(p, 100)).toBeGreaterThan(0);
    expect(farming.claimDaily(p, 100)).toBe(0);      // same day: no double-claim
    const before = p.dailyStreak;
    farming.claimDaily(p, 101);
    expect(p.dailyStreak).toBe(before + 1);          // consecutive day: streak++
  });
});
