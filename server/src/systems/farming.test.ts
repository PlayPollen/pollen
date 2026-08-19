// This test file is the payoff of every architecture decision above. Because
// game logic is server-side, pure, and RNG is seeded, you can assert EXACT
// reward outcomes with zero network and zero client. This is the QA leverage
// that most game codebases never get — lean into it.

import { describe, it, expect } from "vitest";
import { FarmState, Player, Tile } from "../schema/FarmState";
import * as farming from "./farming";
import { TileState } from "../../../shared/types";

function readyTile(state: FarmState, x: number, y: number, crop: string, plantedAtTick = 0) {
  const t = new Tile();
  t.state = TileState.Ready; t.crop = crop; t.plantedAtTick = plantedAtTick;
  state.tiles.set(`${x},${y}`, t);
}

describe("harvest", () => {
  it("is deterministic for a fixed seedSalt (replayable outcomes)", () => {
    const make = () => {
      const s = new FarmState(); s.currentTick = 500;
      const p = new Player(); p.coins = 0;
      readyTile(s, 3, 4, "turnip");
      return { s, p };
    };
    const a = make(); const r1 = farming.harvest(a.s, a.p, 3, 4, 123456);
    const b = make(); const r2 = farming.harvest(b.s, b.p, 3, 4, 123456);
    expect(r1).toEqual(r2);                 // same seed -> identical reward
    expect(r1.ok).toBe(true);
  });

  it("rejects harvesting a tile that isn't Ready (anti-cheat)", () => {
    const s = new FarmState(); const p = new Player();
    const t = new Tile(); t.state = TileState.Planted; s.tiles.set("1,1", t);
    const r = farming.harvest(s, p, 1, 1, 1);
    expect(r.ok).toBe(false);
    expect(p.coins).toBe(100);              // wallet untouched
  });
});

describe("plant", () => {
  it("refuses when the player can't afford the seed", () => {
    const s = new FarmState(); const p = new Player(); p.coins = 0;
    expect(farming.plant(s, p, 0, 0, "starfruit")).toBe(false);
  });
});

describe("claimDaily", () => {
  it("grants once per server day and builds a streak", () => {
    const p = new Player();
    expect(farming.claimDaily(p, 100)).toBeGreaterThan(0);
    expect(farming.claimDaily(p, 100)).toBe(0);      // same day: no double-claim
    const before = p.dailyStreak;
    farming.claimDaily(p, 101);
    expect(p.dailyStreak).toBe(before + 1);          // consecutive day: streak++
  });
});
