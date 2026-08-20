// Player movement rules. Movement is the one place where the client leads and
// the server follows — but "follows" still means "validates and can overrule".
//
// The threat model is deliberately modest. Nobody cares if a cheater walks 10%
// too fast in a cozy farming game; what matters is that they can't teleport
// across the farm to work every tile, and can't leave the map. The real
// anti-cheat lives in `withinReach`, which gates every farming action.

import { Player } from "../state.js";
import { FARM_WIDTH, FARM_HEIGHT, PLAYER } from "../types.js";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Apply a client-reported position. Returns true if the move was accepted as
 * sent; false if it was clamped or rejected (the client then gets corrected by
 * the next state sync, since Player.x/y are synced fields).
 */
export function movePlayer(player: Player, x: number, y: number, nowMs: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

  // Stay on the farm. Half-tile inset so the sprite's centre never sits in the
  // void beyond the last tile.
  const cx = clamp(x, 0.5, FARM_WIDTH - 0.5);
  const cy = clamp(y, 0.5, FARM_HEIGHT - 0.5);

  const last = player.lastMoveAtMs;
  player.lastMoveAtMs = nowMs;

  // No exemption for the first update. The room stamps lastMoveAtMs at join
  // time against a known spawn position, so there is always a baseline — and if
  // one is somehow missing we grant the minimum budget rather than a free pass.
  // Exempting the first move meant a client could teleport anywhere once, then
  // reconnect for another free teleport.
  const elapsedSec = last === 0 ? 0 : Math.max(0, nowMs - last) / 1000;

  // Capped, so banking idle time can't buy a long-distance jump.
  const dtSec = Math.min(PLAYER.maxStepSeconds, elapsedSec);
  const maxDistance = PLAYER.speed * PLAYER.speedTolerance * dtSec + PLAYER.stepEpsilon;
  const distance = Math.hypot(cx - player.x, cy - player.y);

  if (distance > maxDistance) {
    // Too far, too fast — a teleport. Move them as far as they were entitled to
    // along the requested direction rather than freezing them, so a genuine lag
    // spike degrades into a slow player instead of a stuck one.
    const scale = maxDistance / distance;
    player.x = clamp(player.x + (cx - player.x) * scale, 0.5, FARM_WIDTH - 0.5);
    player.y = clamp(player.y + (cy - player.y) * scale, 0.5, FARM_HEIGHT - 0.5);
    return false;
  }

  player.x = cx;
  player.y = cy;
  return cx === x && cy === y;
}

/**
 * Where a new player starts: the middle of the farm. Call sites must also stamp
 * `lastMoveAtMs`, or the player's first move has no baseline to measure against.
 */
export function spawnPoint(): { x: number; y: number } {
  return { x: Math.floor(FARM_WIDTH / 2) + 0.5, y: Math.floor(FARM_HEIGHT / 2) + 0.5 };
}
