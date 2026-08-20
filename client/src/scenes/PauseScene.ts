// The in-game pause menu, launched over a paused FarmScene.
//
// "Paused" means the world genuinely stops: LocalGame halts its tick, so crops
// don't grow and bees don't forage while this is open. Because all growth is
// measured in ticks rather than wall-clock, that pauses the world exactly —
// there is no elapsed-time drift to reconcile on resume.

import Phaser from "phaser";
import type { LocalGame } from "../game/LocalGame";
import { sendAction } from "../net/room";
import { MenuPanel, MONO, GAP, type MenuOption } from "../ui/MenuPanel";

/**
 * ESC opens this scene from FarmScene's key handler. Without a brief guard the
 * same physical keypress can also reach this scene's freshly-bound handler and
 * close it again immediately.
 */
const REOPEN_GUARD_MS = 200;

export class PauseScene extends Phaser.Scene {
  private world!: LocalGame;
  private menu!: MenuPanel;
  private dim!: Phaser.GameObjects.Graphics;
  private title!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private controlsText!: Phaser.GameObjects.Text;
  private openedAt = 0;
  private unbindKeys?: () => void;

  constructor() {
    super("pause");
  }

  init(data: { world: LocalGame }) {
    this.world = data.world;
  }

  create() {
    this.openedAt = this.time.now;
    sendAction(this.world, { type: "pause" });

    this.dim = this.add.graphics();

    this.title = this.add
      .text(0, 0, "PAUSED", { fontFamily: MONO, fontSize: "34px", color: "#ffd54a" })
      .setOrigin(0.5);

    const items: MenuOption[] = [
      {
        label: "Resume",
        icon: "▶",
        hint: "Back to the farm.  (ESC)",
        onSelect: () => this.resume(),
      },
      {
        label: "Controls",
        icon: "⌨",
        hint: "How to play.",
        onSelect: () => {
          this.controlsText.setVisible(!this.controlsText.visible);
          this.layout();
        },
      },
      {
        label: "Quit to Title",
        icon: "🚪",
        hint: "Leave the farm. Your progress is saved.",
        onSelect: () => void this.quit(),
      },
    ];

    this.menu = new MenuPanel(this, items);
    this.menu.refresh();

    this.statusText = this.add
      .text(0, 0, "", { fontFamily: MONO, fontSize: "12px", color: "#8d9b7a", align: "center" })
      .setOrigin(0.5);

    this.controlsText = this.add
      .text(
        0,
        0,
        [
          "WASD / arrows   walk",
          "1 2 3 4         plant · water · harvest · hive",
          "TAB             cycle seed",
          "click           act on a tile within reach",
          "SPACE           claim daily reward",
          "+ / -           zoom",
          "ESC             pause",
        ].join("\n"),
        { fontFamily: MONO, fontSize: "13px", color: "#cfd8bc", align: "left", lineSpacing: 4 },
      )
      .setOrigin(0.5)
      .setVisible(false);

    const kb = this.input.keyboard!;
    this.unbindKeys = this.menu.bindKeys(kb);
    kb.on("keydown-ESC", this.onEsc);

    this.scale.on("resize", this.layout, this);
    this.layout();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unbindKeys?.();
      kb.off("keydown-ESC", this.onEsc);
      this.scale.off("resize", this.layout, this);
    });
  }

  private onEsc = () => {
    if (this.time.now - this.openedAt < REOPEN_GUARD_MS) return;
    this.resume();
  };

  private resume() {
    sendAction(this.world, { type: "resume" });
    this.scene.resume("farm");
    this.scene.stop();
  }

  private async quit() {
    this.menu.locked = true;
    this.statusText.setText("saving…");
    // Resume before shutting down: a farm saved while flagged paused would load
    // back frozen next session.
    sendAction(this.world, { type: "resume" });
    try {
      // Stops the tick loop AND flushes to storage, so quitting can't lose the
      // work done since the last autosave.
      await this.world.shutdown();
    } catch (err) {
      console.error("[pollen] shutdown save failed:", err);
    }
    this.scene.stop("hud");
    this.scene.stop("farm");
    this.scene.start("menu");
  }

  update() {
    const paused = this.world.state.paused;
    this.statusText.setText(
      this.menu.locked ? "saving…" : paused ? "world stopped — crops aren't growing" : "",
    );
  }

  private layout() {
    const w = this.scale.width;
    const h = this.scale.height;
    const cx = w / 2;

    this.dim.clear();
    this.dim.fillStyle(0x0d1109, 0.78);
    this.dim.fillRect(0, 0, w, h);

    const controlsH = this.controlsText.visible ? this.controlsText.height + GAP : 0;
    const stackH =
      this.title.height +
      GAP +
      this.menu.panelHeight +
      GAP +
      this.menu.hintHeight +
      GAP * 0.6 +
      this.statusText.height +
      controlsH;

    let y = Math.max(24, (h - stackH) / 2);

    this.title.setPosition(cx, Math.round(y + this.title.height / 2));
    y += this.title.height + GAP;

    y = this.menu.layoutAt(cx, y) + GAP * 0.6;

    this.statusText.setPosition(cx, Math.round(y + this.statusText.height / 2));
    y += this.statusText.height + GAP;

    if (this.controlsText.visible) {
      this.controlsText.setPosition(cx, Math.round(y + this.controlsText.height / 2));
    }

    // Everything in this scene sits above the dim layer.
    this.dim.setDepth(0);
    this.menu.setDepth(10);
    this.title.setDepth(10);
    this.statusText.setDepth(10);
    this.controlsText.setDepth(10);
  }
}
