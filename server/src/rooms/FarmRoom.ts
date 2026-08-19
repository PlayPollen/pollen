// The room is one co-op farm instance. This is the horizontal-scaling unit:
// you scale by running MANY small rooms across MANY processes, never one giant
// room. That's what keeps a farming game cheap to scale vs. an MMO.

import { Room, Client } from "colyseus";
import { FarmState, Player } from "../schema/FarmState";
import * as farming from "../systems/farming";
import { ClientMessage, TICK_RATE } from "../../../shared/types";
import { PersistencePort } from "../persistence/PersistencePort";

export class FarmRoom extends Room<FarmState> {
  maxClients = 4;                       // small co-op instance, Stardew-style
  private seedSalt = (Math.random() * 0xffffffff) >>> 0;
  private persistence!: PersistencePort;

  onCreate(options: { persistence: PersistencePort; farmId: string }) {
    this.persistence = options.persistence;
    this.setState(new FarmState());

    // Server simulation loop. The ONLY place currentTick advances. Clients
    // never drive time.
    this.setSimulationInterval(() => farming.growthTick(this.state), 1000 / TICK_RATE);

    // Every client message is validated inside the system functions. The room
    // just routes; it never trusts the payload.
    this.onMessage("action", (client, msg: ClientMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      switch (msg.type) {
        case "plant":
          farming.plant(this.state, player, msg.x, msg.y, msg.crop);
          break;
        case "water":
          farming.water(this.state, msg.x, msg.y);
          break;
        case "harvest": {
          const r = farming.harvest(this.state, player, msg.x, msg.y, this.seedSalt);
          if (r.ok) {
            // Send the reward result ONLY to the acting client, so the client
            // can play the dopamine feedback (coin shower, "RARE!" flash).
            // The state sync already told everyone the tile is empty; this
            // extra event is just for juice.
            client.send("harvestResult", r);
          }
          break;
        }
        case "claimDaily": {
          const day = Math.floor(Date.now() / 86_400_000);   // server day index
          const reward = farming.claimDaily(player, day);
          if (reward > 0) client.send("dailyResult", { reward, streak: player.dailyStreak });
          break;
        }
      }
    });

    // Periodically snapshot to durable storage so a crash doesn't lose farms.
    this.clock.setInterval(() => this.save(), 30_000);
  }

  async onJoin(client: Client, options: { name?: string; userId: string }) {
    // Load this player's persisted wallet/streak, or start fresh.
    const saved = await this.persistence.loadPlayer(options.userId);
    const p = new Player();
    p.id = options.userId;
    p.name = options.name ?? "Farmer";
    if (saved) {
      p.coins = saved.coins;
      p.lastDailyDay = saved.lastDailyDay;
      p.dailyStreak = saved.dailyStreak;
    }
    this.state.players.set(client.sessionId, p);
  }

  async onLeave(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (p) await this.persistence.savePlayer(p.id, {
      coins: p.coins, lastDailyDay: p.lastDailyDay, dailyStreak: p.dailyStreak,
    });
    this.state.players.delete(client.sessionId);
  }

  private async save() {
    // Persist the tile grid for this farm. Kept deliberately small/serializable.
    await this.persistence.saveFarm(this.roomId, this.state);
  }
}
