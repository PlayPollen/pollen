// The single-player game loop, running the real rules in the browser.
//
// This replaces the Colyseus room. It exposes deliberately the same shape the
// scenes already used — `state`, `send(intent)`, reward events — so rendering
// didn't have to care that the authority moved from a server into this file.
//
// Intents still go through the rule functions rather than mutating state
// directly. That isn't anti-cheat theatre (it's your own machine; you can edit
// your own save) — it's that the rules are the only place that knows what a
// legal action is, and they're the part covered by tests.

import {
  farming,
  beekeeping,
  movement,
  createFarmState,
  createPlayer,
  loadSave,
  toSave,
  TICK_RATE,
  DEFAULT_SLOT,
  type Appearance,
  type ClientMessage,
  type FarmState,
  type LoadResult,
  type HarvestResult,
  type HoneyResult,
  type Player,
  type SaveStore,
} from "@pollen/shared";

export interface GameEvents {
  harvest: HarvestResult;
  honey: HoneyResult;
  daily: { reward: number; streak: number };
}

/** How often the farm is written to storage while playing. */
const AUTOSAVE_MS = 10_000;

/** The single player's key in the players map. */
export const LOCAL_PLAYER = "local";

export class LocalGame {
  state: FarmState;
  /** Kept so scenes can address "me" the same way they did with a room. */
  readonly sessionId = LOCAL_PLAYER;

  private handlers: { [K in keyof GameEvents]: Array<(p: GameEvents[K]) => void> } = {
    harvest: [],
    honey: [],
    daily: [],
  };
  private tickTimer?: ReturnType<typeof setInterval>;
  private autosaveTimer?: ReturnType<typeof setInterval>;
  private dirty = false;

  /**
   * True when there was no save to load — the only time the character creator
   * should appear. Running it again would overwrite an existing character.
   */
  readonly isNewFarm: boolean;

  private constructor(
    state: FarmState,
    private store: SaveStore,
    private slot: string,
    isNewFarm: boolean,
  ) {
    this.state = state;
    this.isNewFarm = isNewFarm;
  }

  /** Load the farm from storage, or start a fresh one. */
  static async load(store: SaveStore, slot = DEFAULT_SLOT): Promise<LocalGame> {
    let state: FarmState;
    let existed = false;
    let result: LoadResult | undefined;

    try {
      const saved = await store.load(slot);
      existed = saved !== null;
      result = loadSave(saved);
      state = result.state;
      if (result.status === "migrated") {
        console.info(`[pollen] upgraded save from version ${result.savedVersion}`);
      }
      if (result.message) console.warn("[pollen]", result.message);
    } catch (err) {
      // Storage itself failed. Start fresh so the game still runs, but treat the
      // existing save as untouchable — we don't know what's in it.
      console.error("[pollen] could not read save:", err);
      state = createFarmState();
      result = {
        state,
        status: "unreadable",
        message: "Your saved farm couldn't be opened. It has been left untouched.",
        preserveExisting: true,
      };
    }

    if (!state.players.has(LOCAL_PLAYER)) {
      const player = createPlayer(LOCAL_PLAYER);
      const spawn = movement.spawnPoint();
      player.x = spawn.x;
      player.y = spawn.y;
      state.players.set(LOCAL_PLAYER, player);
    }
    // Movement's speed check measures from this; a save loaded hours later must
    // not look like hours of banked travel.
    state.players.get(LOCAL_PLAYER)!.lastMoveAtMs = Date.now();

    const game = new LocalGame(state, store, slot, !existed);
    game.loadResult = result;
    // The single most destructive thing this class could do: autosave a fresh
    // farm over a save we failed to read. If we couldn't open it, we don't
    // touch it — the player keeps whatever is there and can recover it later.
    game.savingBlocked = result.preserveExisting;
    if (game.savingBlocked) {
      console.warn("[pollen] saving is disabled this session to protect the existing save.");
    }
    return game;
  }

  /** How the save loaded, so the UI can be honest about a migration or failure. */
  loadResult?: LoadResult;
  private savingBlocked = false;

  /** True when this session will not persist — the UI should say so. */
  get isReadOnly() {
    return this.savingBlocked;
  }

  /** Apply the character creator's result and commit it straight away. */
  setCharacter(name: string, appearance: Appearance) {
    const player = this.player;
    player.name = name;
    player.appearance = appearance;
    this.dirty = true;
    // Saved immediately: losing a character you just made to a crash before the
    // first autosave would be a miserable first impression.
    void this.save();
  }

  get player(): Player {
    return this.state.players.get(LOCAL_PLAYER)!;
  }

  start() {
    this.stop();
    this.tickTimer = setInterval(() => this.tick(), 1000 / TICK_RATE);
    this.autosaveTimer = setInterval(() => void this.save(), AUTOSAVE_MS);
  }

  stop() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.autosaveTimer) clearInterval(this.autosaveTimer);
    this.tickTimer = undefined;
    this.autosaveTimer = undefined;
  }

  private tick() {
    if (this.state.paused) return;
    // Order matters: crops grow first, then bees forage against the state those
    // crops are now in. Running bees first would have them forage a flower on
    // the tick before it finishes growing.
    farming.growthTick(this.state);
    beekeeping.beeTick(this.state);
    this.dirty = true;
  }

  /** Apply an intent through the rules. Unknown or illegal intents are no-ops. */
  send(msg: ClientMessage) {
    const player = this.player;
    if (this.state.paused && msg.type !== "resume") return;

    switch (msg.type) {
      case "move":
        movement.movePlayer(player, msg.x, msg.y, Date.now());
        break;
      case "plant":
        this.dirty = farming.plant(this.state, player, msg.x, msg.y, msg.crop) || this.dirty;
        break;
      case "water":
        this.dirty = farming.water(this.state, player, msg.x, msg.y) || this.dirty;
        break;
      case "harvest": {
        const r = farming.harvest(this.state, player, msg.x, msg.y, this.state.seedSalt);
        if (r.ok) {
          this.dirty = true;
          this.emit("harvest", r);
        }
        break;
      }
      case "placeHive":
        this.dirty = beekeeping.placeHive(this.state, player, msg.x, msg.y) || this.dirty;
        break;
      case "collectHoney": {
        const h = beekeeping.collectHoney(this.state, player, msg.x, msg.y);
        if (h.ok) {
          this.dirty = true;
          this.emit("honey", h);
        }
        break;
      }
      case "claimDaily": {
        // Wall-clock day index, so pausing can't farm daily rewards.
        const day = Math.floor(Date.now() / 86_400_000);
        const reward = farming.claimDaily(player, day);
        if (reward > 0) {
          this.dirty = true;
          this.emit("daily", { reward, streak: player.dailyStreak });
        }
        break;
      }
      case "pause":
        this.state.paused = true;
        void this.save(); // pausing is a natural save point
        break;
      case "resume":
        this.state.paused = false;
        // Don't count the paused stretch as travel time.
        player.lastMoveAtMs = Date.now();
        break;
    }
  }

  on<K extends keyof GameEvents>(event: K, handler: (payload: GameEvents[K]) => void) {
    this.handlers[event].push(handler);
  }

  private emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]) {
    for (const h of this.handlers[event]) h(payload);
  }

  /** Write the farm out. Skips the write when nothing has changed. */
  async save(force = false): Promise<void> {
    // Refuses even a forced save: shutdown() forces one, and quitting is exactly
    // when an unreadable save would get overwritten.
    if (this.savingBlocked) return;
    if (!this.dirty && !force) return;
    this.dirty = false;
    try {
      await this.backupOnce();
      await this.store.save(this.slot, toSave(this.state));
    } catch (err) {
      // Losing a save is bad; crashing the game over it is worse.
      console.error("[pollen] save failed:", err);
      this.dirty = true; // try again on the next autosave
    }
  }

  /**
   * Before the first write following a migration, copy the pre-migration save
   * aside. If an upgrade turns out to be wrong, the original is still there
   * rather than already overwritten by the first autosave.
   */
  private async backupOnce(): Promise<void> {
    if (this.backedUp || this.loadResult?.status !== "migrated") return;
    this.backedUp = true;
    try {
      const original = await this.store.load(this.slot);
      if (original) await this.store.save(`${this.slot}.v${this.loadResult.savedVersion}`, original);
    } catch (err) {
      // A failed backup shouldn't block play, but it should be loud.
      console.error("[pollen] could not back up the pre-upgrade save:", err);
    }
  }
  private backedUp = false;

  /** Stop the loop and flush. Call before leaving the game scene. */
  async shutdown(): Promise<void> {
    this.stop();
    await this.save(true);
  }
}
