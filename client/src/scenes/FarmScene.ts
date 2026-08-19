// Phaser scene. Two responsibilities only:
//   1. Turn player input into intents (sendAction) — optimistic visuals are OK,
//      but the server's next state sync is the correction.
//   2. Render the synced state, and play the "juice" when reward events arrive.
//
// This is where your "maximum dopamine" craft actually happens — but built on
// honest, server-decided outcomes.

import Phaser from "phaser";
import { Room } from "colyseus.js";
import { sendAction, onRewards } from "../net/room";
import { TILE_SIZE, TileState } from "../../../shared/types";

export class FarmScene extends Phaser.Scene {
  private room!: Room;
  private tileSprites = new Map<string, Phaser.GameObjects.Rectangle>();

  constructor() { super("farm"); }
  init(data: { room: Room }) { this.room = data.room; }

  create() {
    // Render from synced state. onAdd/onChange fire whenever the SERVER changes
    // a tile — the client is a pure view of authoritative state.
    const tiles = (this.room.state as any).tiles;
    // Colyseus MapSchema: onAdd fires for existing + future tiles. In real code
    // also attach per-tile .onChange / .listen() to re-tint on state changes.
    tiles.onAdd((tile: any, key: string) => this.drawTile(key, tile));

    // Reward juice — the payoff moments.
    onRewards(this.room, {
      onHarvest: (r) => {
        if (r.rare) this.playRareBurst();      // big screen shake + gold particles
        else this.playCoinPop(r.coins);        // small satisfying pop
      },
      onDaily: (d) => this.playDailyChest(d.reward, d.streak),
    });

    // Input -> intent. Example: click a tile to harvest.
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      const x = Math.floor(p.worldX / TILE_SIZE);
      const y = Math.floor(p.worldY / TILE_SIZE);
      sendAction(this.room, { type: "harvest", x, y });   // ASK; don't decide
    });
  }

  private drawTile(key: string, tile: any) {
    const [x, y] = key.split(",").map(Number);
    const color = tile.state === TileState.Ready ? 0xffd54a
      : tile.state === TileState.Watered ? 0x6ab04c
      : tile.state === TileState.Planted ? 0x8d6e63 : 0x3b2f2f;
    const rect = this.add.rectangle(
      x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2,
      TILE_SIZE - 2, TILE_SIZE - 2, color,
    );
    this.tileSprites.set(key, rect);
  }

  // --- The dopamine layer. Tune ruthlessly; this is your craft. ------------
  private playCoinPop(coins: number) {
    this.cameras.main.shake(80, 0.003);
    // particle burst, rising "+coins" text, a bright short "cha-ching" — the
    // anticipation->payoff beat that makes a trivial win feel great.
  }
  private playRareBurst() {
    this.cameras.main.shake(220, 0.010);      // bigger shake = bigger deal
    this.cameras.main.flash(160, 255, 240, 180);
    // gold particle fountain + "RARE!" banner + a distinct celebratory sting.
    // Use the near-miss/rare contrast sparingly so it stays meaningful.
  }
  private playDailyChest(reward: number, streak: number) {
    // Chest-open ritual: the "unknown result" unwrap. The streak counter ticking
    // up is your loss-aversion hook — but tied to tending a living farm, not a
    // nagging popup.
  }
}
