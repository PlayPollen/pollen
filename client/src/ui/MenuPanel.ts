// A bordered option list with keyboard + mouse navigation, laid out as a
// MEASURED stack.
//
// Shared by the title screen and the pause menu on purpose. The first version
// of this layout hand-tuned pixel offsets and put the hint label 2px below the
// panel border, so a centre-origin label straddled it. Positioning everything
// from each element's real height makes that class of bug impossible — and
// copying the fixed code into a second menu would have been asking for the bug
// to come back in the copy.

import Phaser from "phaser";

export const MONO = 'ui-monospace,"Cascadia Mono",Consolas,monospace';
export const EMOJI_FONT =
  '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';

export const ITEM_SPACING = 40;
/** Space between the panel border and the first/last item's centre line. */
export const PANEL_PAD = 26;
export const GAP = 22;

export interface MenuOption {
  label: string;
  icon: string;
  hint: string;
  /** Present = unavailable; the string is shown as the reason. */
  disabled?: string;
  onSelect?: () => void;
}

export class MenuPanel {
  private panel: Phaser.GameObjects.Graphics;
  private itemTexts: Phaser.GameObjects.Text[] = [];
  private hintText: Phaser.GameObjects.Text;
  private selected = 0;
  /** Set while an option is running, to stop double-activation. */
  locked = false;

  constructor(
    private scene: Phaser.Scene,
    private options: MenuOption[],
    private width = 340,
  ) {
    this.panel = scene.add.graphics();

    options.forEach((opt, i) => {
      const t = scene.add
        .text(0, 0, "", { fontFamily: MONO, fontSize: "20px" })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: !opt.disabled });

      t.on("pointerover", () => {
        this.selected = i;
        this.refresh();
      });
      t.on("pointerdown", () => this.activate(i));
      this.itemTexts.push(t);
    });

    this.hintText = scene.add
      .text(0, 0, "", { fontFamily: MONO, fontSize: "12px", color: "#8d9b7a" })
      .setOrigin(0.5);
  }

  /** Wire arrow/WASD/Enter navigation. Returns a disposer. */
  bindKeys(kb: Phaser.Input.Keyboard.KeyboardPlugin) {
    const up = () => this.move(-1);
    const down = () => this.move(1);
    const go = () => this.activate(this.selected);

    kb.on("keydown-UP", up);
    kb.on("keydown-W", up);
    kb.on("keydown-DOWN", down);
    kb.on("keydown-S", down);
    kb.on("keydown-ENTER", go);

    return () => {
      kb.off("keydown-UP", up);
      kb.off("keydown-W", up);
      kb.off("keydown-DOWN", down);
      kb.off("keydown-S", down);
      kb.off("keydown-ENTER", go);
    };
  }

  private move(delta: number) {
    this.selected = (this.selected + delta + this.options.length) % this.options.length;
    this.refresh();
  }

  activate(index: number) {
    if (this.locked) return;
    this.selected = index;
    const opt = this.options[index];
    this.refresh();
    if (opt.disabled) return;
    opt.onSelect?.();
  }

  refresh() {
    this.options.forEach((opt, i) => {
      const active = i === this.selected;
      const dim = !!opt.disabled;
      this.itemTexts[i]
        .setText(`${active ? "▸" : " "} ${opt.icon}  ${opt.label}${dim ? `   (${opt.disabled})` : ""}`)
        .setColor(dim ? "#5c6b52" : active ? "#ffd54a" : "#cfd8bc");
    });
    this.hintText.setText(this.options[this.selected].hint);
  }

  /** Height this panel occupies, excluding the hint line below it. */
  get panelHeight() {
    return (this.options.length - 1) * ITEM_SPACING + PANEL_PAD * 2;
  }

  get hintHeight() {
    return this.hintText.height;
  }

  /** Draw at the given top-left cursor. Returns the y just below the hint. */
  layoutAt(cx: number, top: number): number {
    const h = this.panelHeight;
    this.panel.clear();
    this.panel.fillStyle(0x232b1b, 0.6);
    this.panel.fillRoundedRect(cx - this.width / 2, top, this.width, h, 10);
    this.panel.lineStyle(1, 0x4a5740, 1);
    this.panel.strokeRoundedRect(cx - this.width / 2, top, this.width, h, 10);

    this.itemTexts.forEach((t, i) =>
      t.setPosition(cx, Math.round(top + PANEL_PAD + i * ITEM_SPACING)),
    );

    const hintY = top + h + GAP;
    this.hintText.setPosition(cx, Math.round(hintY + this.hintText.height / 2));
    return hintY + this.hintText.height;
  }

  setDepth(depth: number) {
    this.panel.setDepth(depth);
    this.itemTexts.forEach((t) => t.setDepth(depth));
    this.hintText.setDepth(depth);
  }
}
