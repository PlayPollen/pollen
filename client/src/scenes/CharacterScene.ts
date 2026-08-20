// First-run character creator: name plus a handful of looks.
//
// Shown once, before a farm exists. Returning players skip it — the appearance
// is saved with the farm, so this must not appear again and quietly overwrite
// someone's character.
//
// This scene owns its own transitions. An earlier version took an onDone
// callback from MenuScene and called back into it; because `scene.start()`
// stops the scene its plugin belongs to, that stopped the already-dead
// MenuScene and left THIS scene running on top of the farm.
//
// Name entry captures keystrokes directly rather than using a DOM input,
// because a DOM overlay needs Phaser's dom container enabled and then has to be
// positioned and themed to match. For a 14-character name that's a poor trade.

import Phaser from "phaser";
import {
  APPEARANCE_LIMITS,
  HAIR_STYLES,
  MAX_NAME_LENGTH,
  cycle,
  defaultAppearance,
  randomAppearance,
  sanitizeName,
  type Appearance,
  type AppearanceKey,
} from "@pollen/shared";
import { MONO, GAP } from "../ui/MenuPanel";
import type { LocalGame } from "../game/LocalGame";
import {
  CHAR_H,
  appearanceKey,
  ensureCharacterTextures,
  releaseCharacterTextures,
} from "../art/character";

interface RowDef {
  key: AppearanceKey;
  label: string;
  describe: (a: Appearance) => string;
}

const ROWS: RowDef[] = [
  { key: "skin", label: "Skin", describe: (a) => `${a.skin + 1} / ${APPEARANCE_LIMITS.skin}` },
  { key: "hair", label: "Hair", describe: (a) => HAIR_STYLES[a.hair] },
  { key: "hairColor", label: "Hair colour", describe: (a) => `${a.hairColor + 1} / ${APPEARANCE_LIMITS.hairColor}` },
  { key: "shirt", label: "Shirt", describe: (a) => `${a.shirt + 1} / ${APPEARANCE_LIMITS.shirt}` },
  { key: "pants", label: "Trousers", describe: (a) => `${a.pants + 1} / ${APPEARANCE_LIMITS.pants}` },
];

/** Every row is clickable; arrows change the value, the label selects the row. */
interface RowViews {
  left: Phaser.GameObjects.Text;
  label: Phaser.GameObjects.Text;
  value: Phaser.GameObjects.Text;
  right: Phaser.GameObjects.Text;
}

const PREVIEW_SCALE = 4;
const ROW_STEP = 34;
const ACTIVE = "#ffd54a";
const IDLE = "#cfd8bc";

export class CharacterScene extends Phaser.Scene {
  private world!: LocalGame;

  private appearance: Appearance = defaultAppearance();
  private name = "";
  /** 0 = name field, 1..n = appearance rows. */
  private selected = 0;

  private panel!: Phaser.GameObjects.Graphics;
  private title!: Phaser.GameObjects.Text;
  private nameLabel!: Phaser.GameObjects.Text;
  private nameValue!: Phaser.GameObjects.Text;
  private rows: RowViews[] = [];
  private preview!: Phaser.GameObjects.Sprite;
  private hint!: Phaser.GameObjects.Text;
  private startBtn!: Phaser.GameObjects.Text;
  private backBtn!: Phaser.GameObjects.Text;
  private randomBtn!: Phaser.GameObjects.Text;

  private walkTimer = 0;
  private step: 0 | 1 = 0;
  private starting = false;

  constructor() {
    super("character");
  }

  init(data: { world: LocalGame }) {
    this.world = data.world;
    // Reset per run — Phaser reuses the Scene instance, so anything left here
    // would be a destroyed object from the previous visit.
    this.appearance = defaultAppearance();
    this.name = "";
    this.selected = 0;
    this.rows = [];
    this.starting = false;
    this.step = 0;
    this.walkTimer = 0;
  }

  create() {
    this.cameras.main.setBackgroundColor("#1b2216");
    this.panel = this.add.graphics();

    this.title = this.add
      .text(0, 0, "WHO ARE YOU?", { fontFamily: MONO, fontSize: "30px", color: ACTIVE })
      .setOrigin(0.5);

    ensureCharacterTextures(this, this.appearance);
    this.preview = this.add
      .sprite(0, 0, appearanceKey(this.appearance, "down", 0))
      .setOrigin(0.5, 1)
      .setScale(PREVIEW_SCALE);

    // --- Name row ---
    this.nameLabel = this.add
      .text(0, 0, "Name", { fontFamily: MONO, fontSize: "18px" })
      .setOrigin(0, 0.5)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => this.select(0))
      .on("pointerdown", () => this.select(0));
    this.nameValue = this.add
      .text(0, 0, "", { fontFamily: MONO, fontSize: "18px" })
      .setOrigin(1, 0.5)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => this.select(0))
      .on("pointerdown", () => this.select(0));

    // --- Appearance rows ---
    ROWS.forEach((row, i) => {
      const arrow = (dir: -1 | 1) =>
        this.add
          .text(0, 0, dir < 0 ? "◂" : "▸", { fontFamily: MONO, fontSize: "20px", color: IDLE })
          .setOrigin(0.5)
          .setInteractive({ useHandCursor: true })
          .on("pointerover", () => this.select(i + 1))
          .on("pointerdown", () => {
            this.select(i + 1);
            this.change(dir);
          });

      const label = this.add
        .text(0, 0, row.label, { fontFamily: MONO, fontSize: "18px" })
        .setOrigin(0, 0.5)
        .setInteractive({ useHandCursor: true })
        .on("pointerover", () => this.select(i + 1))
        // Clicking the label cycles forward, so the whole row is usable without
        // having to hit a small arrow glyph.
        .on("pointerdown", () => {
          this.select(i + 1);
          this.change(1);
        });

      const value = this.add
        .text(0, 0, "", { fontFamily: MONO, fontSize: "18px" })
        .setOrigin(1, 0.5)
        .setInteractive({ useHandCursor: true })
        .on("pointerover", () => this.select(i + 1))
        .on("pointerdown", () => {
          this.select(i + 1);
          this.change(1);
        });

      this.rows.push({ left: arrow(-1), label, value, right: arrow(1) });
    });

    this.randomBtn = this.button("🎲 Randomise", () => this.reroll(), "#cfd8bc", "#2f3a24");
    this.startBtn = this.button("START", () => this.finish(), "#1b2216", ACTIVE);
    this.backBtn = this.button("Back", () => this.goBack(), "#cfd8bc", "#2f3a24");

    this.hint = this.add
      .text(0, 0, "click or use ↑↓ ←→ · type a name · ENTER to start", {
        fontFamily: MONO,
        fontSize: "12px",
        color: "#8d9b7a",
      })
      .setOrigin(0.5);

    this.bindKeys();
    this.scale.on("resize", this.layout, this);
    this.refresh();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off("resize", this.layout, this);
    });
  }

  private button(text: string, onClick: () => void, color: string, bg: string) {
    return this.add
      .text(0, 0, `  ${text}  `, {
        fontFamily: MONO,
        fontSize: "18px",
        color,
        backgroundColor: bg,
        padding: { x: 4, y: 6 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", onClick);
  }

  private select(index: number) {
    if (this.selected === index) return;
    this.selected = index;
    this.refresh();
  }

  private bindKeys() {
    const kb = this.input.keyboard!;

    kb.on("keydown", (e: KeyboardEvent) => {
      if (this.starting) return;

      switch (e.key) {
        case "Escape":
          // Deliberately inert. Leaving mid-creation would strand a farm with a
          // default character; use the explicit Back button instead.
          e.preventDefault();
          return;
        case "ArrowUp":
          return this.select((this.selected - 1 + ROWS.length + 1) % (ROWS.length + 1));
        case "ArrowDown":
          return this.select((this.selected + 1) % (ROWS.length + 1));
        case "ArrowLeft":
          return this.change(-1);
        case "ArrowRight":
          return this.change(1);
        case "Enter":
          return this.finish();
        case "Backspace":
          this.name = this.name.slice(0, -1);
          return this.refresh();
      }

      // Any other single printable character types into the name, whichever row
      // is highlighted — hunting for the field first would be needless friction.
      if (e.key.length === 1 && this.name.length < MAX_NAME_LENGTH) {
        this.name += e.key;
        this.refresh();
      }
    });
  }

  private reroll() {
    releaseCharacterTextures(this, this.appearance);
    this.appearance = randomAppearance();
    ensureCharacterTextures(this, this.appearance);
    this.refresh();
  }

  private change(delta: number) {
    if (this.selected === 0) return; // the name row has nothing to cycle
    const row = ROWS[this.selected - 1];
    // Free the old textures before generating new ones, or every click leaks.
    releaseCharacterTextures(this, this.appearance);
    this.appearance = {
      ...this.appearance,
      [row.key]: cycle(this.appearance[row.key], delta, row.key),
    };
    ensureCharacterTextures(this, this.appearance);
    this.refresh();
  }

  private goBack() {
    // scene.start() stops THIS scene and starts the target — which is exactly
    // why the transition belongs here rather than in a MenuScene callback.
    this.scene.start("menu");
  }

  private finish() {
    if (this.starting) return;
    this.starting = true;

    this.world.setCharacter(sanitizeName(this.name), this.appearance);
    this.world.start();
    this.scene.launch("hud", { world: this.world });
    this.scene.start("farm", { world: this.world });
  }

  private refresh() {
    const nameActive = this.selected === 0;
    this.nameLabel.setColor(nameActive ? ACTIVE : IDLE).setText(`${nameActive ? "▸" : " "} Name`);
    this.nameValue
      .setText(`${this.name || "…"}${nameActive ? "_" : ""}`)
      .setColor(nameActive ? ACTIVE : IDLE);

    ROWS.forEach((row, i) => {
      const active = this.selected === i + 1;
      const views = this.rows[i];
      views.label.setColor(active ? ACTIVE : IDLE).setText(`${active ? "▸" : " "} ${row.label}`);
      views.value.setText(row.describe(this.appearance)).setColor(active ? ACTIVE : IDLE);
      views.left.setColor(active ? ACTIVE : "#6b7a5e");
      views.right.setColor(active ? ACTIVE : "#6b7a5e");
    });

    this.startBtn.setText(`  START as ${sanitizeName(this.name)}  `);
    this.preview.setTexture(appearanceKey(this.appearance, "down", this.step));
    this.layout();
  }

  update(_time: number, delta: number) {
    // Idle bob, so the preview looks alive rather than like a paper doll.
    this.walkTimer += delta;
    if (this.walkTimer > 420) {
      this.walkTimer = 0;
      this.step = this.step === 0 ? 1 : 0;
      this.preview.setTexture(appearanceKey(this.appearance, "down", this.step));
    }
  }

  private layout() {
    const w = this.scale.width;
    const h = this.scale.height;
    const cx = w / 2;

    // Two columns on a wide window (preview beside the options), stacked on a
    // narrow one so nothing overlaps.
    const wide = w >= 760;
    const optionsX = wide ? cx + 100 : cx;
    const previewX = wide ? cx - 180 : cx;

    const rowCount = ROWS.length + 1;
    const rowsH = rowCount * ROW_STEP;
    const buttonsH = this.startBtn.height + GAP * 0.6;
    const stackH =
      this.title.height + GAP + rowsH + GAP + buttonsH + GAP * 0.6 + this.hint.height;

    let y = Math.max(20, (h - stackH) / 2);

    this.title.setPosition(cx, Math.round(y + this.title.height / 2));
    y += this.title.height + GAP;

    const top = y;
    const panelW = 320;
    this.panel.clear();
    this.panel.fillStyle(0x232b1b, 0.6);
    this.panel.fillRoundedRect(optionsX - panelW / 2, top - 16, panelW, rowsH + 20, 10);
    this.panel.lineStyle(1, 0x4a5740, 1);
    this.panel.strokeRoundedRect(optionsX - panelW / 2, top - 16, panelW, rowsH + 20, 10);

    const labelX = optionsX - panelW / 2 + 14;
    const valueX = optionsX + panelW / 2 - 34;
    const leftX = optionsX + panelW / 2 - 24;
    const rightX = optionsX + panelW / 2 - 4;

    const nameY = Math.round(top + 6);
    this.nameLabel.setPosition(labelX, nameY);
    this.nameValue.setPosition(optionsX + panelW / 2 - 14, nameY);

    this.rows.forEach((views, i) => {
      const ry = Math.round(top + 6 + (i + 1) * ROW_STEP);
      views.label.setPosition(labelX, ry);
      views.value.setPosition(valueX, ry);
      // Arrows sit at the row's right edge, so the clickable targets for
      // "previous" and "next" are always in the same place on every row.
      views.left.setPosition(leftX - 66, ry);
      views.right.setPosition(rightX, ry);
    });

    const previewBottom = top + rowsH - 6;
    this.preview
      .setScale(wide ? PREVIEW_SCALE : PREVIEW_SCALE * 0.7)
      .setPosition(previewX, wide ? previewBottom : top - 26);

    y = top + rowsH + GAP;
    const btnY = Math.round(y + this.startBtn.height / 2);
    if (wide) {
      this.backBtn.setPosition(cx - 190, btnY);
      this.randomBtn.setPosition(cx - 60, btnY);
      this.startBtn.setPosition(cx + 130, btnY);
    } else {
      this.randomBtn.setPosition(cx - 90, btnY);
      this.startBtn.setPosition(cx + 80, btnY);
      this.backBtn.setPosition(cx, btnY + this.startBtn.height + 10);
    }

    y = btnY + this.startBtn.height / 2 + (wide ? GAP * 0.6 : GAP * 1.6);
    this.hint.setPosition(cx, Math.round(y + this.hint.height / 2));

    // Hide the preview rather than let it spill off a very short window.
    this.preview.setVisible(this.preview.y - CHAR_H * this.preview.scaleY > 0);
  }
}
