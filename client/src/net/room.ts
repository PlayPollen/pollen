// Intent plumbing.
//
// This file used to own the Colyseus connection. Single player runs the rules
// locally now (see game/LocalGame.ts), so what's left is the thin seam the
// scenes talk through: send intents up, get reward events back.
//
// The shape is unchanged on purpose. If co-op arrives, a networked
// implementation slots in behind these same two functions and the scenes don't
// need to know.

import type { ClientMessage, HarvestResult, HoneyResult } from "@pollen/shared";
import type { LocalGame } from "../game/LocalGame";

export type { HarvestResult, HoneyResult };

/** Thin helper so scenes just call sendAction({type:'plant',...}). */
export function sendAction(game: LocalGame, msg: ClientMessage) {
  game.send(msg);
}

/**
 * Wire the juicy one-shot reward events. Keeping these separate from state is
 * deliberate: state tells you WHAT the world is; these tell you WHEN to
 * celebrate.
 */
export function onRewards(
  game: LocalGame,
  handlers: {
    onHarvest: (r: HarvestResult) => void;
    onHoney: (h: HoneyResult) => void;
    onDaily: (d: { reward: number; streak: number }) => void;
  },
) {
  game.on("harvest", handlers.onHarvest);
  game.on("honey", handlers.onHoney);
  game.on("daily", handlers.onDaily);
}
