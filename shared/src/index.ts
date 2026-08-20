// Public surface of @pollen/shared — the portable game core.
//
// This package holds the state model and ALL game rules, with no dependency on
// a framework, a renderer, or a network. The browser runs it directly for
// single player; a co-op server could run exactly the same code unchanged.
//
// NOTE: the .js extensions are required — this compiles to real Node ESM, where
// extensionless relative imports do not resolve.

export * from "./types.js";
export * from "./state.js";
export * from "./appearance.js";
export * from "./persistence.js";

export * as farming from "./systems/farming.js";
export * as beekeeping from "./systems/beekeeping.js";
export * as movement from "./systems/movement.js";
export * as rng from "./systems/rng.js";

// Result shapes are part of the contract with whatever renders the game.
export type { HarvestResult } from "./systems/farming.js";
export type { HoneyResult } from "./systems/beekeeping.js";
