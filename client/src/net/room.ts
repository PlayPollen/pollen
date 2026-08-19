// Client networking. Note what this file does NOT do: it never computes a
// yield, never decides if a harvest succeeded, never touches coins. It sends
// intents up and renders whatever authoritative state comes down. The reward
// *feeling* is client-side; the reward *truth* is server-side.

import { Client, Room } from "colyseus.js";
import { ClientMessage } from "../../../shared/types";

export interface HarvestResult {
  ok: boolean; amount: number; rare: boolean; coins: number;
}

export async function connect(userId: string, name: string) {
  const client = new Client(
    (import.meta as any).env?.VITE_SERVER_URL ?? "ws://localhost:2567"
  );
  const room: Room = await client.joinOrCreate("farm", { userId, name });
  return room;
}

// Thin helper so scenes just call sendAction({type:'plant',...}).
export function sendAction(room: Room, msg: ClientMessage) {
  room.send("action", msg);
}

// Wire the juicy one-shot reward events. The scene passes callbacks that fire
// the screen shake / coin shower / RARE banner. Keeping this separate from
// state sync is deliberate: state tells you WHAT the world is; these events
// tell you WHEN to celebrate.
export function onRewards(
  room: Room,
  handlers: {
    onHarvest: (r: HarvestResult) => void;
    onDaily: (d: { reward: number; streak: number }) => void;
  },
) {
  room.onMessage("harvestResult", handlers.onHarvest);
  room.onMessage("dailyResult", handlers.onDaily);
}
