// Client entry point. Boots Phaser straight into the menu — connecting is the
// menu's job now, so a dead server produces a readable in-game message instead
// of a bare DOM string, and the player gets to choose how they want to play.

import Phaser from "phaser";
import { MenuScene } from "./scenes/MenuScene";
import { FarmScene } from "./scenes/FarmScene";
import { HudScene } from "./scenes/HudScene";
import { CharacterScene } from "./scenes/CharacterScene";
import { PauseScene } from "./scenes/PauseScene";

function boot() {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    backgroundColor: "#1b2216",
    pixelArt: true, // nearest-neighbour: keeps 32px art crisp instead of blurry
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: window.innerWidth,
      height: window.innerHeight,
    },
  });

  // MenuScene starts immediately; the other two are started by it.
  game.scene.add("menu", MenuScene, true);
  game.scene.add("farm", FarmScene, false);
  game.scene.add("character", CharacterScene, false);
  game.scene.add("hud", HudScene, false);
  game.scene.add("pause", PauseScene, false);

  // Phaser is drawing now, so the DOM placeholder has done its job.
  document.getElementById("boot")?.classList.add("hidden");
}

boot();
