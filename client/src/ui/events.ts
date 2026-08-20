// A tiny typed channel between FarmScene (the world) and HudScene (the overlay).
//
// They're separate Phaser scenes on purpose: anything drawn inside FarmScene is
// subject to the camera's zoom, so the HUD used to grow and shrink when the
// player zoomed. A parallel scene has its own untransformed camera, which is
// also where the menu and any future dialogs belong.
//
// Phaser's game-level emitter is the natural bus here — it outlives individual
// scenes and doesn't couple them to each other's classes.

import Phaser from "phaser";

export interface ToolState {
  tool: "plant" | "water" | "harvest" | "hive";
  cropId: string;
}

export interface UiEvents {
  /** The player switched tool or cycled seed. */
  tool: ToolState;
  /** A transient message: reward, refusal, anything worth one line. */
  toast: { text: string; tone: "good" | "bad" };
  /** Where the character is, for the position readout. */
  position: { x: number; y: number };
}

export const UI = {
  emit<K extends keyof UiEvents>(game: Phaser.Game, key: K, payload: UiEvents[K]) {
    game.events.emit(key, payload);
  },
  on<K extends keyof UiEvents>(
    game: Phaser.Game,
    key: K,
    handler: (payload: UiEvents[K]) => void,
  ) {
    game.events.on(key, handler);
  },
  off<K extends keyof UiEvents>(
    game: Phaser.Game,
    key: K,
    handler: (payload: UiEvents[K]) => void,
  ) {
    game.events.off(key, handler);
  },
};

