// Colyseus @colyseus/schema classes. Anything in here is AUTOMATICALLY synced
// to every client in the room — you mutate it on the server, clients receive
// only the diffs. This is the whole reason to use Colyseus: you don't hand-roll
// the netcode. But note: everything here is server-owned. Clients get a
// read-only replica.

import { Schema, MapSchema, type } from "@colyseus/schema";
import { TileState } from "../../../shared/types";

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
}

export class FarmState extends Schema {
  // key = "x,y". Sparse: only tiles that have been touched exist.
  @type({ map: Tile }) tiles = new MapSchema<Tile>();
  @type({ map: Player }) players = new MapSchema<Player>();
  @type("uint32") currentTick: number = 0;
}
