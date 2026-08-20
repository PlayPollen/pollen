// The room is one co-op farm instance. This is the horizontal-scaling unit:
// you scale by running MANY small rooms across MANY processes, never one giant
// room. That's what keeps a farming game cheap to scale vs. an MMO.

import { Room, Client, ServerError } from "@colyseus/core";
import { verifyGuestToken, soloFarmId, isSoloFarmId } from "../auth/guestToken.js";
import { FarmState, Player, Tile, Hive } from "../schema/FarmState.js";
import * as farming from "../systems/farming.js";
import * as bees from "../systems/beekeeping.js";
import * as movement from "../systems/movement.js";
import { ClientMessage, TICK_RATE } from "@pollen/shared";
import { PersistencePort } from "../persistence/PersistencePort.js";

export class FarmRoom extends Room<FarmState> {
  // Default is the small co-op instance, Stardew-style. A solo farm narrows to
  // 1 in onCreate — see the mode option.
  maxClients = 4;
  private seedSalt = (Math.random() * 0xffffffff) >>> 0;
  private persistence!: PersistencePort;
  // The persistence key. `roomId` is regenerated every process start, so it
  // can't identify a farm across restarts — a caller-supplied farmId can.
  private farmKey!: string;
  /** Only a solo farm may be paused — see the "pause" message handler. */
  private solo = false;

  async onCreate(options: {
    persistence: PersistencePort;
    farmId?: string;
    mode?: "solo" | "coop";
  }) {
    this.persistence = options.persistence;
    this.farmKey = options.farmId ?? this.roomId;
    this.solo = options.mode === "solo";
    // A solo farm is enforced server-side, not just hidden in the UI.
    if (this.solo) this.maxClients = 1;
    this.setState(new FarmState());
    await this.restore();

    // Server simulation loop. The ONLY place currentTick advances. Clients
    // never drive time.
    // Order matters: crops grow first, then bees forage against the state those
    // crops are now in. Running bees first would have them forage a flower on
    // the tick before it finishes growing.
    this.setSimulationInterval(() => {
      // Pausing simply stops advancing the tick. Because ALL growth is measured
      // in ticks rather than wall-clock, this pauses the world exactly — there
      // is no elapsed-time drift to reconcile on resume.
      if (this.state.paused) return;
      farming.growthTick(this.state);
      bees.beeTick(this.state);
    }, 1000 / TICK_RATE);

    // Every client message is validated inside the system functions. The room
    // just routes; it never trusts the payload.
    this.onMessage("action", (client, msg: ClientMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      // A paused world accepts nothing but "resume". Without this the client
      // could keep acting through the pause menu — and a paused farm where you
      // can still harvest isn't paused.
      if (this.state.paused && msg.type !== "resume") return;

      switch (msg.type) {
        case "pause":
          // Refused for co-op: one player must not be able to freeze a world
          // other people are living in.
          if (this.solo) this.state.paused = true;
          break;
        case "resume":
          this.state.paused = false;
          // Reset the movement baseline so the paused duration isn't counted as
          // travel time. PLAYER.maxStepSeconds already caps how much a gap can
          // fund, so this isn't load-bearing for anti-cheat — it just stops the
          // first post-resume step from consuming that whole allowance.
          player.lastMoveAtMs = Date.now();
          break;
        case "move":
          movement.movePlayer(player, msg.x, msg.y, Date.now());
          break;
        case "plant":
          farming.plant(this.state, player, msg.x, msg.y, msg.crop);
          break;
        case "water":
          farming.water(this.state, player, msg.x, msg.y);
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
        case "placeHive":
          bees.placeHive(this.state, player, msg.x, msg.y);
          break;
        case "collectHoney": {
          const h = bees.collectHoney(this.state, player, msg.x, msg.y);
          if (h.ok) client.send("honeyResult", h);
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

  /**
   * The trust boundary. Everything downstream uses the userId established
   * HERE, never one the client asserted in its join options.
   */
  onAuth(_client: Client, options: { token?: string; farmId?: string }) {
    const userId = verifyGuestToken(options.token);
    if (!userId) {
      throw new ServerError(401, "invalid or missing guest token");
    }

    // Verifying the token alone isn't enough: matchmaking routes by farmId, so
    // an attacker with a perfectly valid token of their OWN could still ask to
    // be placed in `solo:<victim>` and walk around someone else's farm. A
    // private farm is joinable only by the player it belongs to.
    if (isSoloFarmId(options.farmId) && options.farmId !== soloFarmId(userId)) {
      throw new ServerError(403, "that farm belongs to someone else");
    }

    return { userId };
  }

  async onJoin(client: Client, options: { name?: string }) {
    // client.auth is what onAuth returned — the verified identity.
    const userId = (client.auth as { userId: string }).userId;

    // Load this player's persisted wallet/streak, or start fresh.
    const saved = await this.persistence.loadPlayer(userId);
    const p = new Player();
    p.id = userId;
    p.name = options.name ?? "Farmer";
    const spawn = movement.spawnPoint();
    p.x = spawn.x;
    p.y = spawn.y;
    // Stamp the movement baseline at join. Without this the player's first
    // `move` would have no elapsed time to measure against, and the speed check
    // would be measuring from an epoch of 0.
    p.lastMoveAtMs = Date.now();
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

  // A room is disposed as soon as the last player leaves. Without this, a solo
  // farm would lose everything since the last 30s autosave the moment you
  // closed the tab — and "Single Player" implies your farm is still there when
  // you come back.
  async onDispose() {
    await this.save();
  }

  private async save() {
    // Persist the tile grid for this farm. Kept deliberately small/serializable.
    await this.persistence.saveFarm(this.farmKey, this.state);
  }

  // Rehydrate the tile grid from the last snapshot. Only tiles and the tick
  // counter are restored — players are loaded per-connection in onJoin, so a
  // stale snapshot can never resurrect someone else's wallet.
  private async restore() {
    const snapshot = await this.persistence.loadFarm(this.farmKey);
    if (!snapshot) return;

    const tiles = snapshot.tiles as Record<string, {
      state: number; crop: string; plantedAtTick: number; watered: boolean;
    }> | undefined;
    if (tiles) {
      for (const [key, saved] of Object.entries(tiles)) {
        const tile = new Tile();
        tile.state = saved.state;
        tile.crop = saved.crop;
        tile.plantedAtTick = saved.plantedAtTick;
        tile.watered = saved.watered;
        this.state.tiles.set(key, tile);
      }
    }
    const hives = snapshot.hives as Record<string, {
      x: number; y: number; level: number; honey: number;
    }> | undefined;
    if (hives) {
      for (const [key, saved] of Object.entries(hives)) {
        const hive = new Hive();
        hive.x = saved.x;
        hive.y = saved.y;
        hive.level = saved.level;
        hive.honey = saved.honey;
        // foragingCount is derived — the next beeTick recomputes it.
        this.state.hives.set(key, hive);
      }
    }

    // Growth is measured against currentTick, so restoring the grid without
    // the tick it was saved at would make every crop instantly ready.
    this.state.currentTick = (snapshot.currentTick as number) ?? 0;
  }
}
