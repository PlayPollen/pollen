// Movement is client-predicted, so these tests pin down exactly how much the
// server is willing to believe. The goal is not to catch every speedhack — it's
// to make teleporting across the farm impossible while never rubber-banding an
// honest player who hit a lag spike.

import { describe, it, expect } from "vitest";
import { createPlayer } from "../state.js";
import * as movement from "./movement.js";
import { FARM_WIDTH, FARM_HEIGHT, PLAYER } from "../types.js";

function playerAt(x: number, y: number, lastMoveAtMs = 1000) {
  const p = createPlayer("test");
  p.x = x;
  p.y = y;
  p.lastMoveAtMs = lastMoveAtMs;
  return p;
}

describe("movePlayer", () => {
  it("accepts a plausible step", () => {
    const p = playerAt(10, 10);
    // 100ms at 5 tiles/sec = 0.5 tiles. Well inside budget.
    expect(movement.movePlayer(p, 10.5, 10, 1100)).toBe(true);
    expect(p.x).toBeCloseTo(10.5, 10);
    expect(p.y).toBeCloseTo(10, 10);
  });

  it("does NOT hand out a free teleport when no baseline was stamped", () => {
    // Regression: an earlier version exempted the first update entirely, so a
    // client could jump anywhere once — and reconnect for another free jump.
    const p = playerAt(0.5, 0.5, 0);
    expect(movement.movePlayer(p, 20, 20, 5000)).toBe(false);
    expect(Math.hypot(p.x - 0.5, p.y - 0.5)).toBeLessThanOrEqual(PLAYER.stepEpsilon + 1e-9);
  });

  it("caps how far a long idle gap can fund, so waiting can't buy a teleport", () => {
    const p = playerAt(5, 5);
    // 10 seconds of "banked" time. Uncapped this would fund 75+ tiles.
    expect(movement.movePlayer(p, 39, 5, 11_000)).toBe(false);
    const cap = PLAYER.speed * PLAYER.speedTolerance * PLAYER.maxStepSeconds + PLAYER.stepEpsilon;
    expect(p.x - 5).toBeLessThanOrEqual(cap + 1e-9);
  });

  it("refuses a teleport, but still moves the player as far as they'd earned", () => {
    const p = playerAt(5, 5);
    // 100ms later, claiming to be 30 tiles away.
    expect(movement.movePlayer(p, 35, 5, 1100)).toBe(false);
    expect(p.x).toBeGreaterThan(5);                    // not frozen
    const budget = PLAYER.speed * PLAYER.speedTolerance * 0.1 + PLAYER.stepEpsilon;
    expect(p.x - 5).toBeLessThanOrEqual(budget + 1e-9); // but capped
  });

  it("absorbs a modest lag spike without rubber-banding an honest player", () => {
    const p = playerAt(5, 5);
    // 300ms gap: a real player walking the whole time covers 1.5 tiles.
    expect(movement.movePlayer(p, 6.5, 5, 1300)).toBe(true);
    expect(p.x).toBe(6.5);
  });

  it("clamps to the farm instead of rejecting outright", () => {
    const p = playerAt(1, 1);
    expect(movement.movePlayer(p, -50, -50, 1100)).toBe(false);
    expect(p.x).toBeGreaterThanOrEqual(0.5);
    expect(p.y).toBeGreaterThanOrEqual(0.5);

    const q = playerAt(FARM_WIDTH - 1, FARM_HEIGHT - 1);
    movement.movePlayer(q, FARM_WIDTH + 100, FARM_HEIGHT + 100, 1100);
    expect(q.x).toBeLessThanOrEqual(FARM_WIDTH - 0.5);
    expect(q.y).toBeLessThanOrEqual(FARM_HEIGHT - 0.5);
  });

  it("ignores NaN and Infinity rather than corrupting the position", () => {
    const p = playerAt(7, 7);
    expect(movement.movePlayer(p, NaN, 7, 1100)).toBe(false);
    expect(movement.movePlayer(p, 7, Infinity, 1100)).toBe(false);
    expect(p.x).toBe(7);
    expect(p.y).toBe(7);
  });
});

describe("spawnPoint", () => {
  it("puts new players inside the farm", () => {
    const s = movement.spawnPoint();
    expect(s.x).toBeGreaterThan(0);
    expect(s.y).toBeGreaterThan(0);
    expect(s.x).toBeLessThan(FARM_WIDTH);
    expect(s.y).toBeLessThan(FARM_HEIGHT);
  });
});
