// Title screen. Also the place connection happens: previously main.ts connected
// before Phaser even started, which meant a dead server showed a bare DOM
// string, and there was nowhere to choose how you wanted to play.

import Phaser from "phaser";
import { LocalGame } from "../game/LocalGame";
import { IndexedDbSaveStore, isAvailable } from "../game/IndexedDbSaveStore";
import { DEFAULT_SLOT, MemorySaveStore, type SaveStore } from "@pollen/shared";
import { MenuPanel, MONO, EMOJI_FONT, GAP, type MenuOption } from "../ui/MenuPanel";

/** How long a delete stays "armed" before it reverts to needing confirmation. */
const CONFIRM_WINDOW_MS = 5000;

export class MenuScene extends Phaser.Scene {
  private menu!: MenuPanel;
  private newFarmOption!: MenuOption;
  private confirmingDelete = false;
  private confirmTimer?: Phaser.Time.TimerEvent;
  private statusText!: Phaser.GameObjects.Text;
  private controlsText!: Phaser.GameObjects.Text;
  private logo!: Phaser.GameObjects.Text;
  private title!: Phaser.GameObjects.Text;
  private tagline!: Phaser.GameObjects.Text;

  constructor() {
    super("menu");
  }

  create() {
    this.cameras.main.setBackgroundColor("#1b2216");

    // Rebuilt per run: Phaser reuses the Scene instance, so a stale confirm
    // state would persist across visits to the menu.
    this.confirmingDelete = false;
    this.newFarmOption = {
      label: "New Farm",
      icon: "🗑",
      hint: "Delete the saved farm and start over.",
      disabled: "checking…",
      onSelect: () => void this.deleteSave(),
    };
    void this.refreshSaveState();

    this.logo = this.add
      .text(0, 0, "🌼", { fontFamily: EMOJI_FONT, fontSize: "56px" })
      .setOrigin(0.5);
    this.title = this.add
      .text(0, 0, "POLLEN", { fontFamily: MONO, fontSize: "44px", color: "#ffd54a" })
      .setOrigin(0.5);
    this.tagline = this.add
      .text(0, 0, "a cozy farming game about bees", {
        fontFamily: MONO,
        fontSize: "13px",
        color: "#8d9b7a",
      })
      .setOrigin(0.5);

    const items: MenuOption[] = [
      {
        label: "Single Player",
        icon: "🌱",
        hint: "Your farm, saved in this browser.",
        onSelect: () => void this.startGame(),
      },
      {
        label: "Multiplayer",
        icon: "👥",
        hint: "Co-op on a shared farm — not built yet.",
        disabled: "soon",
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
      this.newFarmOption,
    ];

    this.menu = new MenuPanel(this, items);
    this.menu.refresh();

    this.statusText = this.add
      .text(0, 0, "", { fontFamily: MONO, fontSize: "13px", color: "#ff8a80", align: "center" })
      .setOrigin(0.5);

    // Text set here, not in layout(), so its measured height is available when
    // the stack is composed.
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
    const unbind = this.menu.bindKeys(kb);
    const onEsc = () => {
      this.controlsText.setVisible(false);
      this.layout();
    };
    kb.on("keydown-ESC", onEsc);

    this.scale.on("resize", this.layout, this);
    this.layout();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      unbind();
      kb.off("keydown-ESC", onEsc);
      this.scale.off("resize", this.layout, this);
    });
  }

  private async startGame() {
    this.menu.locked = true;
    this.statusText.setColor("#cfd8bc").setText("loading your farm…");
    this.layout();

    try {
      // IndexedDB is unavailable in some private-browsing modes. Falling back to
      // memory means the game still runs — it just won't remember. Better than
      // refusing to start, but the player deserves to be told.
      const persistent = await isAvailable();
      const store: SaveStore = await this.store();
      if (!persistent) {
        console.warn("[pollen] IndexedDB unavailable — this session will not be saved.");
      }

      const world = await LocalGame.load(store);

      // First run only. A returning player's character is already in the save,
      // and re-running the creator would silently overwrite it.
      //
      // CharacterScene takes over from here and starts the farm itself — a
      // callback back into this scene wouldn't work, because scene.start()
      // stops the scene it's called ON, so it would stop this (already dead)
      // menu and leave the creator running over the farm.
      if (world.isNewFarm) {
        this.scene.start("character", { world });
        return;
      }

      this.enterFarm(world);
    } catch (err) {
      console.error("[pollen] could not start the game:", err);
      this.menu.locked = false;
      this.statusText
        .setColor("#ff8a80")
        .setText("Couldn't start the farm.\nSee the browser console for details.");
      this.layout();
    }
  }

  private async store(): Promise<SaveStore> {
    // IndexedDB is unavailable in some private-browsing modes. Falling back to
    // memory means the game still runs — it just won't remember.
    return (await isAvailable()) ? new IndexedDbSaveStore() : new MemorySaveStore();
  }

  /** Grey out "New Farm" when there's nothing to delete. */
  private async refreshSaveState() {
    let exists = false;
    try {
      exists = (await (await this.store()).load(DEFAULT_SLOT)) !== null;
    } catch {
      exists = false;
    }
    this.newFarmOption.disabled = exists ? undefined : "no save yet";
    // This resolves asynchronously and can land before create() has finished
    // building the panel, so guard rather than assume.
    if (this.menu) {
      this.menu.refresh();
      this.layout();
    }
  }

  /**
   * Two-step, because this destroys hours of someone's play and a menu is easy
   * to fat-finger. The first press arms it and relabels; the second commits.
   */
  private async deleteSave() {
    if (!this.confirmingDelete) {
      this.confirmingDelete = true;
      this.newFarmOption.label = "Delete forever?";
      this.newFarmOption.hint = "Press again to erase this farm. This cannot be undone.";
      this.menu.refresh();

      this.confirmTimer?.remove();
      this.confirmTimer = this.time.delayedCall(CONFIRM_WINDOW_MS, () => this.disarmDelete());
      return;
    }

    this.confirmTimer?.remove();
    this.confirmingDelete = false;
    this.menu.locked = true;
    this.statusText.setColor("#cfd8bc").setText("erasing…");
    this.layout();

    try {
      await (await this.store()).remove(DEFAULT_SLOT);
      this.statusText.setColor("#cfd8bc").setText("Farm erased. Single Player starts fresh.");
    } catch (err) {
      console.error("[pollen] could not delete the save:", err);
      this.statusText.setColor("#ff8a80").setText("Couldn't erase the save.\nSee the console.");
    }

    this.menu.locked = false;
    this.newFarmOption.label = "New Farm";
    this.newFarmOption.hint = "Delete the saved farm and start over.";
    await this.refreshSaveState();
    this.layout();
  }

  private disarmDelete() {
    if (!this.confirmingDelete) return;
    this.confirmingDelete = false;
    this.newFarmOption.label = "New Farm";
    this.newFarmOption.hint = "Delete the saved farm and start over.";
    this.menu.refresh();
  }

  /** Only for a returning player — new farms go via CharacterScene. */
  private enterFarm(world: LocalGame) {
    world.start();
    // The world scene and the HUD run in parallel — see HudScene for why.
    this.scene.launch("hud", { world });
    this.scene.start("farm", { world });
  }

  /**
   * Compose the screen as a single measured vertical stack, then centre it.
   * Each element is placed from a running cursor using its real height, so
   * nothing can overlap regardless of font metrics or whether the controls
   * block is open — and the stack re-centres when it expands.
   */
  private layout() {
    const w = this.scale.width;
    const h = this.scale.height;
    const cx = w / 2;

    const controlsH = this.controlsText.visible ? this.controlsText.height + GAP : 0;
    const stackH =
      this.logo.height +
      GAP * 0.4 +
      this.title.height +
      GAP * 0.4 +
      this.tagline.height +
      GAP +
      this.menu.panelHeight +
      GAP +
      this.menu.hintHeight +
      GAP * 0.6 +
      this.statusText.height +
      controlsH;

    let y = Math.max(24, (h - stackH) / 2);

    const place = (obj: Phaser.GameObjects.Text, gapAfter: number) => {
      obj.setPosition(cx, Math.round(y + obj.height / 2));
      y += obj.height + gapAfter;
    };

    place(this.logo, GAP * 0.4);
    place(this.title, GAP * 0.4);
    place(this.tagline, GAP);

    y = this.menu.layoutAt(cx, y) + GAP * 0.6;

    place(this.statusText, GAP);
    if (this.controlsText.visible) place(this.controlsText, 0);
  }
}

// Identity moved to net/auth.ts: it is no longer a locally-invented id but a
// server-signed token, so it belongs next to the networking code.
