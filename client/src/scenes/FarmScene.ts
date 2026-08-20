// Phaser scene. Two responsibilities only:
//   1. Turn player input into intents (sendAction) — never into outcomes.
//   2. Render the synced state, and play the "juice" when reward events arrive.
//
// This is where the "maximum dopamine" craft happens — but built on honest,
// server-decided outcomes. Nothing in this file computes a reward.
//
// Rendering is VIEWPORT-CULLED: cost scales with what's on screen and with how
// many tiles are actually planted, never with the farm's dimensions. That's what
// keeps a much larger map affordable later — the `tiles` map is sparse, so an
// untouched tile costs nothing to store, sync, or draw.

import Phaser from "phaser";
import type { LocalGame } from "../game/LocalGame";
import { WORLD, tileHash, tileNoise } from "../art/world";
import { appearanceKey, ensureCharacterTextures, shouldFlipSide, type Facing } from "../art/character";
import { sendAction, onRewards } from "../net/room";
import { UI } from "../ui/events";
import {
  TILE_SIZE,
  TileState,
  CROPS,
  FARM_WIDTH,
  FARM_HEIGHT,
  HIVE,
  PLAYER,
  isFlower,
  withinReach,
} from "@pollen/shared";

// "hive" is one tool, not two: clicking bare ground places a hive, clicking an
// existing hive collects its honey. Fewer keys, and the meaning is obvious from
// what's under the cursor.
type Tool = "plant" | "water" | "harvest" | "hive";

// The visible tool order now lives in HudScene, which owns all UI drawing.
const CROP_IDS = Object.keys(CROPS);

/** How often we tell the server where we are. Movement is predicted locally. */
const MOVE_SEND_HZ = 10;
/** If the server's idea of our position drifts this far, it overruled us. */
const RECONCILE_SNAP_TILES = 1.5;

const DEFAULT_ZOOM = 2;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

const COLORS = {
  soil: 0x3b2f2f,
  planted: 0x8d6e63,
  watered: 0x6ab04c,
  ready: 0xffd54a,
  flower: 0xc77dff,
  grid: 0x2a331f,
  hover: 0xffffff,
  hoverBlocked: 0xff6b6b,
  hive: 0xffb300,
  hiveRange: 0xffd54a,
  honey: 0xffe082,
  self: 0x4fc3f7,
  other: 0xb0bec5,
  reach: 0xffffff,
};

export class FarmScene extends Phaser.Scene {
  private world!: LocalGame;

  private groundLayer!: Phaser.GameObjects.Graphics;
  private cropLayer!: Phaser.GameObjects.Graphics;
  private actorLayer!: Phaser.GameObjects.Graphics;
  private hoverLayer!: Phaser.GameObjects.Graphics;

  // The camera follows this invisible object rather than the player graphic, so
  // the graphic can be redrawn freely without fighting the follow logic.
  private cameraTarget!: Phaser.GameObjects.Rectangle;
  private nameTags = new Map<string, Phaser.GameObjects.Text>();

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;

  /** Locally predicted position, in tiles. The server is still authoritative. */
  private localX = FARM_WIDTH / 2;
  private localY = FARM_HEIGHT / 2;
  private lastMoveSentAt = 0;

  private tool: Tool = "plant";
  private cropIndex = 0;
  private hoverTile: { x: number; y: number } | null = null;
  private cropLayerDirty = true;

  // Character animation state.
  private playerSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private facing: Facing = "down";
  private facingRight = false;
  private moving = false;
  private walkStep: 0 | 1 = 0;
  private walkTimer = 0;

  constructor() {
    super("farm");
  }

  init(data: { world: LocalGame }) {
    this.world = data.world;
  }

  create() {
    // Phaser reuses the Scene instance across runs, so anything holding game
    // objects from a previous session must be dropped here — those objects were
    // destroyed on shutdown and touching them throws. (See HudScene for the
    // crash this class of bug caused.)
    this.nameTags.clear();
    this.playerSprites.clear();
    this.hoverTile = null;
    this.lastMoveSentAt = 0;
    this.cropLayerDirty = true;
    this.moving = false;
    this.facing = "down";

    this.groundLayer = this.add.graphics();
    this.cropLayer = this.add.graphics();
    this.actorLayer = this.add.graphics();
    this.hoverLayer = this.add.graphics();

    // Start where the server spawned us, so we don't visibly slide in from 0,0.
    const me = (this.world.state as any).players?.get(this.world.sessionId);
    if (me) {
      this.localX = me.x;
      this.localY = me.y;
    }

    this.cameraTarget = this.add
      .rectangle(this.localX * TILE_SIZE, this.localY * TILE_SIZE, 1, 1)
      .setVisible(false);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, FARM_WIDTH * TILE_SIZE, FARM_HEIGHT * TILE_SIZE);
    // 32px tiles at 1:1 are uncomfortably small on a modern display. Zooming the
    // camera (rather than scaling the canvas) keeps a bigger window showing
    // proportionally more farm, which is the point of the free-scrolling model.
    cam.setZoom(DEFAULT_ZOOM);
    // Lerped follow rather than a hard lock: the small lag reads as weight
    // instead of the camera feeling welded to the character.
    cam.startFollow(this.cameraTarget, true, 0.12, 0.12);

    // No state-sync callbacks any more: the state is a plain object we own, so
    // the 100ms redraw timer below covers every change without bookkeeping.
    this.bindInput();

    onRewards(this.world, {
      onHarvest: (r) => {
        if (r.rare) this.playRareBurst();
        else this.playCoinPop(r.coins);
        const bee = r.pollinated ? " 🐝" : "";
        this.showToast(r.rare ? `RARE!  +${r.coins}${bee}` : `+${r.coins}${bee}`);
      },
      onHoney: (h) => {
        this.playCoinPop(h.coins);
        this.showToast(`HONEY  ${h.units} × ${HIVE.honeyCoinValue}  =  +${h.coins}`);
      },
      onDaily: (d) => this.playDailyChest(d.reward, d.streak),
    });

    // Growth progress only needs ~10fps of visual precision, so we rebuild the
    // crop geometry on a timer rather than every frame. Change events flip the
    // same flag for instant feedback on an action.
    this.time.addEvent({
      delay: 100,
      loop: true,
      callback: () => {
        this.cropLayerDirty = true;
      },
    });

    this.publishTool();
  }

  /** Tell the HUD which tool/seed is active. The HUD owns all of its own drawing. */
  private publishTool() {
    UI.emit(this.game, "tool", { tool: this.tool, cropId: CROP_IDS[this.cropIndex] });
  }

  private showToast(text: string, tone: "good" | "bad" = "good") {
    UI.emit(this.game, "toast", { text, tone });
  }

  private bindInput() {
    const kb = this.input.keyboard!;

    // Created once. Calling addKey() inside update() allocates on every frame.
    this.keys = {
      up: kb.addKey("W"),
      down: kb.addKey("S"),
      left: kb.addKey("A"),
      right: kb.addKey("D"),
      upArrow: kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      downArrow: kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      leftArrow: kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      rightArrow: kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
    };

    const pick = (tool: Tool) => {
      this.tool = tool;
      this.publishTool();
    };
    kb.on("keydown-ONE", () => pick("plant"));
    kb.on("keydown-TWO", () => pick("water"));
    kb.on("keydown-THREE", () => pick("harvest"));
    kb.on("keydown-FOUR", () => pick("hive"));
    kb.on("keydown-TAB", (e: KeyboardEvent) => {
      e.preventDefault();
      this.cropIndex = (this.cropIndex + 1) % CROP_IDS.length;
      this.publishTool();
    });
    kb.on("keydown-SPACE", () => sendAction(this.world, { type: "claimDaily" }));

    kb.on("keydown-ESC", () => {
      // Pausing this scene stops its update loop and input, so the character
      // can't keep walking behind the menu. PauseScene sends the server-side
      // pause and resumes us on close.
      this.scene.pause();
      this.scene.launch("pause", { world: this.world });
    });

    const zoomBy = (f: number) => {
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * f, MIN_ZOOM, MAX_ZOOM));
    };
    kb.on("keydown-MINUS", () => zoomBy(1 / 1.25));
    kb.on("keydown-PLUS", () => zoomBy(1.25));
    kb.on("keydown-EQUALS", () => zoomBy(1.25));

    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      this.hoverTile = this.tileAt(p);
    });

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      const t = this.tileAt(p);
      if (!t) return;
      // Refuse locally what the server would refuse anyway — a rejected action
      // is silent, so an out-of-reach click would just look broken.
      if (!withinReach(this.localX, this.localY, t.x, t.y)) {
        this.showToast("too far — walk closer", "bad");
        return;
      }
      // ASK; never decide. The server validates and the state sync corrects us.
      switch (this.tool) {
        case "plant":
          sendAction(this.world, { type: "plant", x: t.x, y: t.y, crop: CROP_IDS[this.cropIndex] });
          break;
        case "water":
          sendAction(this.world, { type: "water", x: t.x, y: t.y });
          break;
        case "harvest":
          sendAction(this.world, { type: "harvest", x: t.x, y: t.y });
          break;
        case "hive": {
          const exists = (this.world.state as any).hives?.get(`${t.x},${t.y}`);
          sendAction(this.world, {
            type: exists ? "collectHoney" : "placeHive",
            x: t.x,
            y: t.y,
          });
          break;
        }
      }
    });
  }

  private tileAt(p: Phaser.Input.Pointer): { x: number; y: number } | null {
    const x = Math.floor(p.worldX / TILE_SIZE);
    const y = Math.floor(p.worldY / TILE_SIZE);
    if (x < 0 || y < 0 || x >= FARM_WIDTH || y >= FARM_HEIGHT) return null;
    return { x, y };
  }

  update(time: number, delta: number) {
    this.moveLocalPlayer(delta);
    this.reconcileWithServer();
    this.sendMoveIfDue(time);

    this.drawGround();
    if (this.cropLayerDirty) {
      this.drawCrops();
      this.cropLayerDirty = false;
    }
    this.drawActors();
    this.drawHover();
  }

  // --- Movement -------------------------------------------------------------
  // Predicted locally so walking feels instant; the server still clamps and
  // speed-checks every update and can overrule us (see reconcileWithServer).
  private moveLocalPlayer(delta: number) {
    const k = this.keys;
    let dx = 0;
    let dy = 0;
    if (k.left.isDown || k.leftArrow.isDown) dx -= 1;
    if (k.right.isDown || k.rightArrow.isDown) dx += 1;
    if (k.up.isDown || k.upArrow.isDown) dy -= 1;
    if (k.down.isDown || k.downArrow.isDown) dy += 1;

    this.moving = dx !== 0 || dy !== 0;
    if (!this.moving) {
      this.walkTimer = 0;
      this.walkStep = 0;
      return;
    }

    // Horizontal input wins the facing: sideways reads more clearly than a
    // front-on sprite when you're moving diagonally.
    if (dx !== 0) {
      this.facing = "side";
      this.facingRight = dx > 0;
    } else {
      this.facing = dy < 0 ? "up" : "down";
    }

    this.walkTimer += delta;
    if (this.walkTimer > 160) {
      this.walkTimer = 0;
      this.walkStep = this.walkStep === 0 ? 1 : 0;
    }

    // Normalise so diagonal movement isn't ~1.4x faster than orthogonal.
    const len = Math.hypot(dx, dy);
    const step = (PLAYER.speed * delta) / 1000;
    this.localX = Phaser.Math.Clamp(this.localX + (dx / len) * step, 0.5, FARM_WIDTH - 0.5);
    this.localY = Phaser.Math.Clamp(this.localY + (dy / len) * step, 0.5, FARM_HEIGHT - 0.5);

    this.cameraTarget.setPosition(this.localX * TILE_SIZE, this.localY * TILE_SIZE);
  }

  private reconcileWithServer() {
    const me = (this.world.state as any).players?.get(this.world.sessionId);
    if (!me) return;
    // Normally the server just echoes what we sent. A large gap means it
    // rejected or clamped us, and its position is the real one.
    if (Math.hypot(me.x - this.localX, me.y - this.localY) > RECONCILE_SNAP_TILES) {
      this.localX = me.x;
      this.localY = me.y;
      this.cameraTarget.setPosition(this.localX * TILE_SIZE, this.localY * TILE_SIZE);
    }
  }

  private sendMoveIfDue(time: number) {
    if (time - this.lastMoveSentAt < 1000 / MOVE_SEND_HZ) return;
    this.lastMoveSentAt = time;
    sendAction(this.world, { type: "move", x: this.localX, y: this.localY });
  }

  /** The tile range currently on screen, padded by one so edges don't pop in. */
  private visibleTileRange() {
    const v = this.cameras.main.worldView;
    return {
      minX: Math.max(0, Math.floor(v.x / TILE_SIZE) - 1),
      minY: Math.max(0, Math.floor(v.y / TILE_SIZE) - 1),
      maxX: Math.min(FARM_WIDTH - 1, Math.ceil((v.x + v.width) / TILE_SIZE) + 1),
      maxY: Math.min(FARM_HEIGHT - 1, Math.ceil((v.y + v.height) / TILE_SIZE) + 1),
    };
  }

  // --- Rendering ------------------------------------------------------------
  private drawGround() {
    const { minX, minY, maxX, maxY } = this.visibleTileRange();
    const g = this.groundLayer;
    g.clear();

    // Per-tile grass shades plus occasional tufts. Every variation is hashed
    // from the tile's coordinates, never Math.random() — the ground is redrawn
    // as the camera moves, so anything actually random would crawl and shimmer.
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        const px = tx * TILE_SIZE;
        const py = ty * TILE_SIZE;
        const shade = WORLD.grass[tileHash(tx, ty) % WORLD.grass.length];

        g.fillStyle(shade, 1);
        g.fillRect(px, py, TILE_SIZE, TILE_SIZE);

        // Sparse detail: roughly one tile in six gets a couple of blades.
        if (tileNoise(tx, ty, 1) < 0.17) {
          const ox = 4 + Math.floor(tileNoise(tx, ty, 2) * (TILE_SIZE - 12));
          const oy = 4 + Math.floor(tileNoise(tx, ty, 3) * (TILE_SIZE - 12));
          g.fillStyle(WORLD.grassTuft, 0.65);
          g.fillRect(px + ox, py + oy, 2, 4);
          g.fillRect(px + ox + 3, py + oy + 1, 2, 3);
        }
      }
    }

    // A very faint grid: enough to judge tile boundaries when placing hives,
    // not so much that the farm reads as a spreadsheet.
    g.lineStyle(1, WORLD.grid, 0.07);
    for (let x = minX; x <= maxX + 1; x++) {
      g.lineBetween(x * TILE_SIZE, minY * TILE_SIZE, x * TILE_SIZE, (maxY + 1) * TILE_SIZE);
    }
    for (let y = minY; y <= maxY + 1; y++) {
      g.lineBetween(minX * TILE_SIZE, y * TILE_SIZE, (maxX + 1) * TILE_SIZE, y * TILE_SIZE);
    }
  }

  private drawCrops() {
    const g = this.cropLayer;
    g.clear();
    const state = this.world.state as any;
    if (!state?.tiles) return;
    const currentTick: number = state.currentTick ?? 0;
    const { minX, minY, maxX, maxY } = this.visibleTileRange();

    // Iterating the sparse tile map (only planted tiles exist) and rejecting
    // off-screen ones is cheaper than scanning the viewport rectangle, because
    // most of a farm is empty ground at any given moment.
    state.tiles.forEach((tile: any, key: string) => {
      if (tile.state === TileState.Empty) return;
      const [tx, ty] = key.split(",").map(Number);
      if (tx < minX || tx > maxX || ty < minY || ty > maxY) return;

      const px = tx * TILE_SIZE;
      const py = ty * TILE_SIZE;
      const def = CROPS[tile.crop];

      // Tilled soil under every worked tile — wetter and darker once watered,
      // which makes "have I watered this?" readable without any icon.
      g.fillStyle(tile.watered ? WORLD.soilWet : WORLD.soil, 1);
      g.fillRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
      g.fillStyle(WORLD.soilDark, 0.5);
      for (let f = 0; f < 3; f++) {
        g.fillRect(px + 3, py + 6 + f * 8, TILE_SIZE - 6, 1); // furrows
      }

      const progress = def
        ? Phaser.Math.Clamp((currentTick - tile.plantedAtTick) / def.growTicks, 0, 1)
        : 0;
      const ready = tile.state === TileState.Ready;
      this.drawPlant(g, px, py, tile.crop, ready ? 1 : tile.state === TileState.Planted ? 0 : progress, ready);
    });

    this.drawHives(g, minX, minY, maxX, maxY);
  }

  /**
   * A plant that visibly grows: a sprout becomes a stem with leaves, then
   * flowers or fruits. Progress drives the height, so "nearly ready" is legible
   * from across the farm instead of needing a progress bar under every tile.
   */
  private drawPlant(
    g: Phaser.GameObjects.Graphics,
    px: number,
    py: number,
    cropId: string,
    progress: number,
    ready: boolean,
  ) {
    const cx = px + TILE_SIZE / 2;
    const base = py + TILE_SIZE - 5;
    const height = Math.round(4 + progress * (TILE_SIZE - 16));

    g.fillStyle(WORLD.stem, 1);
    g.fillRect(cx - 1, base - height, 2, height);

    // Leaves appear as it grows, alternating sides.
    const leaves = Math.min(3, Math.floor(progress * 4));
    g.fillStyle(WORLD.leaf, 1);
    for (let i = 0; i < leaves; i++) {
      const ly = base - 4 - i * Math.max(3, height / 4);
      if (i % 2 === 0) g.fillRect(cx - 6, ly, 5, 2);
      else g.fillRect(cx + 1, ly, 5, 2);
    }

    if (!ready) return;

    const top = base - height;
    if (isFlower(cropId)) {
      // Four petals and a centre — unmistakably a bloom, which is what the bees
      // care about and therefore what the player needs to spot.
      const petal = WORLD.flower[tileHash(px, py) % WORLD.flower.length];
      g.fillStyle(petal, 1);
      g.fillRect(cx - 4, top - 3, 3, 3);
      g.fillRect(cx + 1, top - 3, 3, 3);
      g.fillRect(cx - 4, top + 1, 3, 3);
      g.fillRect(cx + 1, top + 1, 3, 3);
      g.fillStyle(0xfff3b0, 1);
      g.fillRect(cx - 1, top - 1, 2, 2);
    } else {
      g.fillStyle(WORLD.ripe, 1);
      g.fillRect(cx - 4, top - 4, 8, 6);
      g.fillStyle(0x000000, 0.18);
      g.fillRect(cx - 4, top + 1, 8, 1);
    }
  }

  private drawHives(
    g: Phaser.GameObjects.Graphics,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ) {
    const state = this.world.state as any;
    if (!state?.hives) return;

    state.hives.forEach((hive: any) => {
      // A hive's coverage square can be visible even when the hive itself is
      // off-screen, so cull against the hive's whole footprint, not its tile.
      if (
        hive.x + HIVE.range < minX ||
        hive.x - HIVE.range > maxX ||
        hive.y + HIVE.range < minY ||
        hive.y - HIVE.range > maxY
      ) {
        return;
      }

      const px = hive.x * TILE_SIZE;
      const py = hive.y * TILE_SIZE;
      const r = HIVE.range;

      // The coverage square is the whole strategy layer made visible: it's how
      // you decide where flowers and crops go. Keep it faint but always on.
      g.lineStyle(1, WORLD.hiveRange, hive.foragingCount > 0 ? 0.4 : 0.15);
      g.strokeRect(
        (hive.x - r) * TILE_SIZE,
        (hive.y - r) * TILE_SIZE,
        (r * 2 + 1) * TILE_SIZE,
        (r * 2 + 1) * TILE_SIZE,
      );

      // A stacked box hive: roof, banded body, entrance hole.
      g.fillStyle(0x000000, 0.22);
      g.fillEllipse(px + TILE_SIZE / 2, py + TILE_SIZE - 4, 20, 6);

      g.fillStyle(WORLD.hiveRoof, 1);
      g.fillRect(px + 3, py + 5, TILE_SIZE - 6, 4);

      g.fillStyle(WORLD.hiveBody, 1);
      g.fillRect(px + 5, py + 9, TILE_SIZE - 10, TILE_SIZE - 15);
      g.fillStyle(WORLD.hiveBand, 1);
      for (let b = 0; b < 3; b++) g.fillRect(px + 5, py + 12 + b * 5, TILE_SIZE - 10, 2);

      g.fillStyle(WORLD.hiveHole, 1);
      g.fillRect(px + TILE_SIZE / 2 - 2, py + TILE_SIZE - 10, 4, 3);

      // Honey level rises up the body. A full hive stops producing, so this
      // doubles as the "come collect me" signal.
      const fill = Phaser.Math.Clamp(hive.honey / HIVE.capacity, 0, 1);
      const barH = (TILE_SIZE - 17) * fill;
      g.fillStyle(WORLD.honey, 0.9);
      g.fillRect(px + 6, py + TILE_SIZE - 7 - barH, 2, barH);

      // One bee per foraging flower, circling the hive — an idle hive is
      // instantly obvious because nothing is flying.
      const t = this.time.now / 1000;
      for (let i = 0; i < Math.min(hive.foragingCount, HIVE.maxForagers); i++) {
        const angle = t * 2 + (i * Math.PI * 2) / HIVE.maxForagers;
        const bx = px + TILE_SIZE / 2 + Math.cos(angle) * 13;
        const by = py + TILE_SIZE / 2 + Math.sin(angle) * 9;
        g.fillStyle(0x2a2118, 1);
        g.fillRect(bx - 1, by - 1, 2, 2);
        g.fillStyle(WORLD.hiveBody, 1);
        g.fillRect(bx, by - 1, 1, 1);
      }
    });
  }

  /** The player characters, plus the reach square that gates every action. */
  private drawActors() {
    const g = this.actorLayer;
    g.clear();
    const state = this.world.state as any;

    // Reach footprint, drawn under the character.
    const r = PLAYER.actionRange;
    const cx = Math.floor(this.localX);
    const cy = Math.floor(this.localY);
    g.lineStyle(1, COLORS.reach, 0.25);
    g.strokeRect(
      (cx - r) * TILE_SIZE,
      (cy - r) * TILE_SIZE,
      (r * 2 + 1) * TILE_SIZE,
      (r * 2 + 1) * TILE_SIZE,
    );

    state?.players?.forEach((p: any, sessionId: string) => {
      const isSelf = sessionId === this.world.sessionId;
      // Draw ourselves at the predicted position, everyone else at the stored
      // one — otherwise our own character visibly lags our input.
      const x = isSelf ? this.localX : p.x;
      const y = isSelf ? this.localY : p.y;

      // Textures are generated per appearance and cached, so this is a no-op
      // after the first frame unless someone's look changed.
      ensureCharacterTextures(this, p.appearance);

      let sprite = this.playerSprites.get(sessionId);
      if (!sprite) {
        sprite = this.add.sprite(0, 0, appearanceKey(p.appearance, "down", 0)).setOrigin(0.5, 0.9);
        this.playerSprites.set(sessionId, sprite);
      }

      const facing: Facing = isSelf ? this.facing : "down";
      const step = isSelf && this.moving ? this.walkStep : 0;
      sprite.setTexture(appearanceKey(p.appearance, facing, step));
      // Only the side sprite is ever mirrored, and only when it's looking the
      // opposite way to how it was drawn. Flipping the front/back sprites would
      // mirror the hair parting for no reason.
      sprite.setFlipX(facing === "side" && shouldFlipSide(isSelf ? this.facingRight : true));
      sprite.setPosition(Math.round(x * TILE_SIZE), Math.round(y * TILE_SIZE));
      // Depth-sort by Y so a character behind a hive is drawn behind it.
      sprite.setDepth(y);

      if (!isSelf) {
        let tag = this.nameTags.get(sessionId);
        if (!tag) {
          tag = this.add
            .text(0, 0, p.name ?? "Farmer", {
              fontFamily: "monospace",
              fontSize: "11px",
              color: "#cfd8dc",
            })
            .setOrigin(0.5, 1)
            .setDepth(900);
          this.nameTags.set(sessionId, tag);
        }
        tag.setPosition(x * TILE_SIZE, y * TILE_SIZE - 14);
      }
    });
  }

  private drawHover() {
    const g = this.hoverLayer;
    g.clear();
    if (!this.hoverTile) return;
    const { x, y } = this.hoverTile;
    const reachable = withinReach(this.localX, this.localY, x, y);

    // Previewing the coverage BEFORE you commit 60 coins is the difference
    // between placing hives thoughtfully and placing them at random.
    if (reachable && this.tool === "hive" && !(this.world.state as any).hives?.get(`${x},${y}`)) {
      const r = HIVE.range;
      g.fillStyle(COLORS.hiveRange, 0.1);
      g.fillRect(
        (x - r) * TILE_SIZE,
        (y - r) * TILE_SIZE,
        (r * 2 + 1) * TILE_SIZE,
        (r * 2 + 1) * TILE_SIZE,
      );
    }

    g.lineStyle(2, reachable ? COLORS.hover : COLORS.hoverBlocked, 0.7);
    g.strokeRect(x * TILE_SIZE + 1, y * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2);
  }

  // --- The dopamine layer. Tune ruthlessly; this is the craft. --------------
  private playCoinPop(_coins: number) {
    this.cameras.main.shake(80, 0.003);
    // TODO(art): particle burst + rising "+coins" text + a short "cha-ching".
  }

  private playRareBurst() {
    this.cameras.main.shake(220, 0.01);
    this.cameras.main.flash(160, 255, 240, 180);
    // TODO(art): gold particle fountain + "RARE!" banner + celebratory sting.
    // Keep this rare enough that it stays meaningful.
  }

  private playDailyChest(reward: number, streak: number) {
    this.cameras.main.flash(200, 255, 220, 140);
    this.showToast(`DAILY  +${reward}   streak ${streak}`);
    // TODO(art): chest-open ritual — the "unknown result" unwrap.
  }
}
