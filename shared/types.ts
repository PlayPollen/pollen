// Shared between client and server. NO game logic here — just shapes and
// constants both sides need to agree on. Keeping this pure means the client
// can render optimistically while the server stays the source of truth.

export const TICK_RATE = 10;          // server simulation ticks per second
export const TILE_SIZE = 32;          // px, client rendering only
export const FARM_WIDTH = 40;         // tiles
export const FARM_HEIGHT = 40;

// Crop definitions. Growth is measured in server ticks, not wall-clock, so the
// server fully controls timing. `yield` ranges feed the RNG roll on harvest.
export interface CropDef {
  id: string;
  growTicks: number;
  minYield: number;
  maxYield: number;
  rareChance: number;     // 0..1 chance of a "mutation" bonus drop
  seedCost: number;
}

export const CROPS: Record<string, CropDef> = {
  turnip:    { id: "turnip",    growTicks: 400,  minYield: 1, maxYield: 3, rareChance: 0.04, seedCost: 5 },
  potato:    { id: "potato",    growTicks: 700,  minYield: 2, maxYield: 5, rareChance: 0.06, seedCost: 12 },
  starfruit: { id: "starfruit", growTicks: 1600, minYield: 1, maxYield: 2, rareChance: 0.15, seedCost: 80 },
};

// The messages the client is ALLOWED to send. The server validates every one.
// The client never sends "I harvested 3 turnips" — it sends "I want to harvest
// tile (x,y)" and the server decides what actually happens.
export type ClientMessage =
  | { type: "plant";   x: number; y: number; crop: string }
  | { type: "water";   x: number; y: number }
  | { type: "harvest"; x: number; y: number }
  | { type: "claimDaily" };

export enum TileState {
  Empty = 0,
  Planted = 1,
  Watered = 2,
  Ready = 3,
}
