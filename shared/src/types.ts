// Shared between client and server. NO game logic here — just shapes and
// constants both sides need to agree on. Keeping this pure means the client
// can render optimistically while the server stays the source of truth.

export const TICK_RATE = 10;          // server simulation ticks per second
export const TILE_SIZE = 32;          // px, client rendering only
export const FARM_WIDTH = 40;         // tiles
export const FARM_HEIGHT = 40;

// --- The player character --------------------------------------------------
// Positions are in TILES (floats), not pixels, so the server never has to know
// anything about rendering. TILE_SIZE stays a client-only concern.
export const PLAYER = {
  /** Tiles per second. */
  speed: 5,
  /**
   * How far you can reach to plant/water/harvest, in tiles (Chebyshev — a
   * square, matching how the grid reads). This is what makes walking matter:
   * without it the character is a decorative cursor, and a modified client
   * could farm the entire grid from one spot.
   */
  actionRange: 2,
  /**
   * Movement is client-predicted and server-validated. We allow some headroom
   * over `speed` before rejecting a move, because network jitter batches real
   * movement into bursts — too tight a bound would rubber-band honest players.
   * This catches teleporting, not micro-speedhacks.
   */
  speedTolerance: 1.5,
  /**
   * Movement budget accrues with elapsed time, but only up to this many
   * seconds' worth. Without a cap, idling (or reconnecting) would bank an
   * unlimited allowance and buy a free teleport across the farm — the exact
   * hole that made "first move is exempt" unsafe.
   *
   * Residual exposure is deliberate and small: a client that waits out the cap
   * between hops can sustain roughly 1.6x walking speed. In a cozy farming game
   * that isn't worth rubber-banding honest players to prevent, and the reach
   * gate still forces them to stop moving to actually work a tile.
   */
  maxStepSeconds: 0.5,
  /** Absolute slack per update, for rounding and sub-tick timing noise. */
  stepEpsilon: 0.25,
} as const;

/** Chebyshev distance in tiles — a square reach, which reads correctly on a grid. */
export function withinReach(px: number, py: number, x: number, y: number): boolean {
  return Math.max(Math.abs(px - x), Math.abs(py - y)) <= PLAYER.actionRange;
}

// Crop definitions. Growth is measured in server ticks, not wall-clock, so the
// server fully controls timing. `yield` ranges feed the RNG roll on harvest.
//
// Two categories, and the difference is the heart of the game:
//   "crop"   — what you sell. Where the coins come from.
//   "flower" — worth little on its own, but it FEEDS HIVES and is the only
//              thing that produces honey and pollination.
// Two tensions fall out of that, and they're the game:
//   1. Land spent on flowers isn't land spent on crops — but crops next to a
//      well-fed hive are worth far more.
//   2. Only a BLOOMED flower feeds bees, so harvesting a flower for its coins
//      shuts off the honey it was producing. Leaving it standing costs you.
export type CropCategory = "crop" | "flower";

export interface CropDef {
  id: string;
  category: CropCategory;
  growTicks: number;
  minYield: number;
  maxYield: number;
  rareChance: number;     // 0..1 chance of a "mutation" bonus drop
  seedCost: number;
}

export const CROPS: Record<string, CropDef> = {
  turnip:    { id: "turnip",    category: "crop",   growTicks: 400,  minYield: 1, maxYield: 3, rareChance: 0.04, seedCost: 5 },
  potato:    { id: "potato",    category: "crop",   growTicks: 700,  minYield: 2, maxYield: 5, rareChance: 0.06, seedCost: 12 },
  starfruit: { id: "starfruit", category: "crop",   growTicks: 1600, minYield: 1, maxYield: 2, rareChance: 0.15, seedCost: 80 },

  clover:    { id: "clover",    category: "flower", growTicks: 250,  minYield: 1, maxYield: 2, rareChance: 0.02, seedCost: 8 },
  lavender:  { id: "lavender",  category: "flower", growTicks: 500,  minYield: 1, maxYield: 3, rareChance: 0.05, seedCost: 20 },
  sunflower: { id: "sunflower", category: "flower", growTicks: 900,  minYield: 2, maxYield: 4, rareChance: 0.08, seedCost: 45 },
};

export const isFlower = (cropId: string) => CROPS[cropId]?.category === "flower";

// --- Beekeeping ------------------------------------------------------------
// A hive is placed on a tile and works a square area around itself. Bees forage
// any grown flower in range, converting them into honey over time; the same
// coverage pollinates crops, raising their yield and rare-drop odds.
export const HIVE = {
  /** Radius in tiles. A radius of 4 covers a 9x9 square centred on the hive. */
  range: 4,
  placeCost: 60,
  /** Max honey a hive holds before it stops accruing — go collect it. */
  capacity: 100,
  /** Honey per foraging flower per server tick. */
  honeyPerFlowerPerTick: 0.02,
  /** Coins per whole unit of honey collected. */
  honeyCoinValue: 3,
  /** More flowers than this add nothing — one hive can only work so hard. */
  maxForagers: 8,
} as const;

// What pollination is worth. Deliberately large enough that a player notices,
// small enough that flowers still cost real land.
export const POLLINATION = {
  yieldMultiplier: 1.5,
  rareChanceMultiplier: 2,
} as const;

// The messages the client is ALLOWED to send. The server validates every one.
// The client never sends "I harvested 3 turnips" — it sends "I want to harvest
// tile (x,y)" and the server decides what actually happens.
export type ClientMessage =
  // Movement is the one intent the client predicts locally before the server
  // confirms it — waiting a round-trip per step would feel awful. The server
  // still clamps and speed-checks every update, and the client snaps back if
  // it drifts. Everything else below waits for authoritative state.
  | { type: "move";         x: number; y: number }
  | { type: "plant";        x: number; y: number; crop: string }
  | { type: "water";        x: number; y: number }
  | { type: "harvest";      x: number; y: number }
  | { type: "placeHive";    x: number; y: number }
  | { type: "collectHoney"; x: number; y: number }
  | { type: "claimDaily" }
  // Pausing genuinely stops the simulation, so it is only honoured for solo
  // farms — one player must never be able to freeze a shared world.
  | { type: "pause" }
  | { type: "resume" };

export enum TileState {
  Empty = 0,
  Planted = 1,
  Watered = 2,
  Ready = 3,
}
