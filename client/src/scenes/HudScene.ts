// The HUD runs as a PARALLEL scene alongside FarmScene, not inside it.
//
// That's not tidiness — anything drawn in FarmScene is transformed by the world
// camera, so the old in-world HUD scaled up and down whenever the player zoomed
// with +/-. A separate scene has its own untransformed camera, so UI stays at a
// fixed screen size no matter what the world camera is doing.

import Phaser from "phaser";
import type { LocalGame } from "../game/LocalGame";
import { CROPS, HIVE, PLAYER } from "@pollen/shared";
import { UI, type ToolState } from "../ui/events";

/** Emoji stand in until real sprites exist; swapping these is a one-line change. */
const TOOL_SLOTS = [
  { key: "1", tool: "plant", icon: "🌱", label: "plant" },
  { key: "2", tool: "water", icon: "💧", label: "water" },
  { key: "3", tool: "harvest", icon: "🌾", label: "harvest" },
  { key: "4", tool: "hive", icon: "🐝", label: "hive" },
] as const;

const SLOT = 60;
const SLOT_GAP = 8;
const SLOT_BOTTOM_MARGIN = 24;

// Windows/macOS/Linux emoji fonts differ; listing them all avoids tofu boxes.
const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
const MONO = 'ui-monospace,"Cascadia Mono",Consolas,monospace';

export class HudScene extends Phaser.Scene {
  private world!: LocalGame;

  // These are (re)built in create(), never in a field initializer. Phaser
  // instantiates a Scene once and REUSES it, so a field initializer runs only
  // at construction — on a second run these would still hold the previous
  // session's destroyed Text objects, and drawing to a destroyed Text throws
  // on its null texture.
  private slotBg!: Phaser.GameObjects.Graphics;
  private slotIcons: Phaser.GameObjects.Text[] = [];
  private slotKeys: Phaser.GameObjects.Text[] = [];
  private slotLabels: Phaser.GameObjects.Text[] = [];
  private seedChip!: Phaser.GameObjects.Text;
  private stats!: Phaser.GameObjects.Text;
  private toast!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;

  private toolState: ToolState = { tool: "plant", cropId: "turnip" };

  constructor() {
    super("hud");
  }

  init(data: { world: LocalGame }) {
    this.world = data.world;
  }

  create() {
    // Drop references to the previous run's objects before rebuilding. Phaser
    // already destroyed them on shutdown; keeping them here is what crashed
    // "quit to title, then play again".
    this.slotIcons = [];
    this.slotKeys = [];
    this.slotLabels = [];
    this.toolState = { tool: "plant", cropId: "turnip" };

    this.slotBg = this.add.graphics();

    for (const slot of TOOL_SLOTS) {
      this.slotIcons.push(
        this.add.text(0, 0, slot.icon, { fontFamily: EMOJI_FONT, fontSize: "26px" }).setOrigin(0.5),
      );
      this.slotKeys.push(
        this.add
          .text(0, 0, slot.key, { fontFamily: MONO, fontSize: "11px", color: "#8d9b7a" })
          .setOrigin(0.5),
      );
      this.slotLabels.push(
        this.add
          .text(0, 0, slot.label, { fontFamily: MONO, fontSize: "10px", color: "#cfd8bc" })
          .setOrigin(0.5),
      );
    }

    // Sits above the plant slot and only appears for the plant tool — a seed
    // readout is meaningless while you're holding a watering can.
    this.seedChip = this.add
      .text(0, 0, "", { fontFamily: MONO, fontSize: "12px", color: "#1b2216", backgroundColor: "#ffd54a", padding: { x: 6, y: 3 } })
      .setOrigin(0.5)
      .setVisible(false);

    this.stats = this.add.text(12, 12, "", {
      fontFamily: MONO,
      fontSize: "13px",
      color: "#e8e2cf",
      lineSpacing: 2,
    });

    this.hint = this.add
      .text(0, 0, "", { fontFamily: MONO, fontSize: "11px", color: "#9aa88a" })
      .setOrigin(0.5);

    this.toast = this.add
      .text(0, 0, "", { fontFamily: MONO, fontSize: "18px", color: "#ffd54a" })
      .setOrigin(0.5)
      .setAlpha(0);

    UI.on(this.game, "tool", this.onTool);
    UI.on(this.game, "toast", this.onToast);

    this.scale.on("resize", this.layout, this);
    this.layout();

    // A parallel scene keeps listening after the world scene stops, which would
    // leak handlers across a return-to-menu.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      UI.off(this.game, "tool", this.onTool);
      UI.off(this.game, "toast", this.onToast);
      this.scale.off("resize", this.layout, this);
    });
  }

  private onTool = (state: ToolState) => {
    this.toolState = state;
    this.layout();
  };

  private onToast = ({ text, tone }: { text: string; tone: "good" | "bad" }) => {
    this.toast.setText(text).setColor(tone === "bad" ? "#ff8a80" : "#ffd54a").setAlpha(1);
    this.tweens.killTweensOf(this.toast);
    this.tweens.add({ targets: this.toast, alpha: 0, duration: 1100, delay: 700 });
  };

  /** Recomputed on resize and on tool change; cheap enough to just redo wholesale. */
  private layout() {
    const w = this.scale.width;
    const h = this.scale.height;
    const total = TOOL_SLOTS.length * SLOT + (TOOL_SLOTS.length - 1) * SLOT_GAP;
    const startX = Math.round((w - total) / 2);
    const y = Math.round(h - SLOT_BOTTOM_MARGIN - SLOT);

    const g = this.slotBg;
    g.clear();

    TOOL_SLOTS.forEach((slot, i) => {
      const x = startX + i * (SLOT + SLOT_GAP);
      const selected = slot.tool === this.toolState.tool;

      // The selected slot lifts slightly and brightens — position plus contrast,
      // so it still reads for anyone who can't distinguish the border colour.
      const lift = selected ? 6 : 0;
      const top = y - lift;

      g.fillStyle(selected ? 0x2f3a24 : 0x232b1b, selected ? 0.98 : 0.85);
      g.fillRoundedRect(x, top, SLOT, SLOT, 8);
      g.lineStyle(selected ? 2 : 1, selected ? 0xffd54a : 0x4a5740, 1);
      g.strokeRoundedRect(x, top, SLOT, SLOT, 8);

      const cx = x + SLOT / 2;
      this.slotIcons[i].setPosition(cx, top + 22).setAlpha(selected ? 1 : 0.75);
      this.slotLabels[i].setPosition(cx, top + 42).setColor(selected ? "#ffd54a" : "#cfd8bc");
      this.slotKeys[i].setPosition(cx, top + 54);
    });

    // Seed chip above the plant slot.
    const plantIndex = TOOL_SLOTS.findIndex((s) => s.tool === "plant");
    const plantX = startX + plantIndex * (SLOT + SLOT_GAP) + SLOT / 2;
    if (this.toolState.tool === "plant") {
      const def = CROPS[this.toolState.cropId];
      this.seedChip
        .setText(`${this.toolState.cropId}  ${def.seedCost}c`)
        .setPosition(plantX, y - 22)
        .setVisible(true);
    } else {
      this.seedChip.setVisible(false);
    }

    this.hint
      .setText(
        this.toolState.tool === "plant"
          ? "TAB cycle seed · click a tile in reach · SPACE daily"
          : this.toolState.tool === "hive"
            ? `click bare ground to build (${HIVE.placeCost}c) · click a hive to collect`
            : "WASD move · +/- zoom · SPACE daily",
      )
      .setPosition(w / 2, y + SLOT + 12);

    this.toast.setPosition(w / 2, y - 56);
  }

  update() {
    const state = this.world.state as any;
    const me = state?.players?.get(this.world.sessionId);

    let honey = 0;
    let foraging = 0;
    state?.hives?.forEach((hv: any) => {
      honey += hv.honey;
      foraging += hv.foragingCount;
    });

    this.stats.setText(
      [
        `🪙 ${me?.coins ?? "…"}    🔥 streak ${me?.dailyStreak ?? 0}`,
        `🍯 ${honey.toFixed(1)}   hives ${state?.hives?.size ?? 0}   bees ${foraging}`,
        `reach ${PLAYER.actionRange} tiles`,
      ].join("\n"),
    );
  }
}
