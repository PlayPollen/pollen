// Colyseus @colyseus/schema classes. Anything in here is AUTOMATICALLY synced
// to every client in the room — you mutate it on the server, clients receive
// only the diffs. This is the whole reason to use Colyseus: you don't hand-roll
// the netcode. But note: everything here is server-owned. Clients get a
// read-only replica.

import { Schema, MapSchema, type } from "@colyseus/schema";
import { TileState } from "@pollen/shared";

export class Tile extends Schema {
  @type("uint8")  state: number = TileState.Empty;
  @type("string") crop: string = "";
  @type("uint32") plantedAtTick: number = 0;   // set server-side on plant
  @type("boolean") watered: boolean = false;
}

export class Player extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "";
  @type("uint32") coins: number = 100;
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  // Persisted daily-reward bookkeeping. Stored as a day-index so we never
  // trust the client's clock.
  @type("uint32") lastDailyDay: number = 0;
  @type("uint16") dailyStreak: number = 0;

  // NOT decorated, so NOT synced: server-only bookkeeping for the movement
  // speed check. Clients have no business seeing it, and it would be pure
  // bandwidth waste at 10 updates/second.
  lastMoveAtMs: number = 0;
}

// A beehive occupies one tile and works a square area around it. `honey` is a
// float because it accrues fractionally every tick; only whole units can be
// collected. `foragingCount` is derived state — it exists purely so the client
// can show how hard a hive is working without recomputing the radius scan.
export class Hive extends Schema {
  @type("uint16") x: number = 0;
  @type("uint16") y: number = 0;
  @type("uint8")  level: number = 1;
  @type("number") honey: number = 0;
  @type("uint8")  foragingCount: number = 0;
}

export class FarmState extends Schema {
  // key = "x,y". Sparse: only tiles that have been touched exist.
  @type({ map: Tile }) tiles = new MapSchema<Tile>();
  @type({ map: Hive }) hives = new MapSchema<Hive>();
  @type({ map: Player }) players = new MapSchema<Player>();
  @type("uint32") currentTick: number = 0;
  // Synced so the client shows the server's actual pause state rather than its
  // own guess — if the server declined to pause, the UI must not claim it did.
  @type("boolean") paused: boolean = false;
}
