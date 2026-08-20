# server/ — parked

**This is not built, tested, or run right now, and it does not currently
compile.** It is kept as the reference implementation for co-op multiplayer.

## Why it's parked

Pollen is single-player for the foreseeable future. A server-authoritative
architecture charges rent for that: every new feature needs schema definitions
and message routing, every action pays a network round trip, and someone has to
pay for always-on Node processes. None of that buys anything until two people
share a farm.

So the game rules moved to `@pollen/shared` and now run directly in the browser:
no latency, no hosting, works offline, and the client deploys as static files.

## What's still here, and what broke

Still valid and worth keeping:

- `src/auth/guestToken.ts` — signed guest identity. Closes a real impersonation
  hole (a client used to be able to send any `userId` and load that player's
  farm). Dormant while saves are local; needed again for cloud saves or co-op.
- `src/rooms/FarmRoom.ts` — room lifecycle, intent routing, pause handling.
- `src/schema/FarmState.ts` — the Colyseus synced-state mirror.
- `src/persistence/PersistencePort.ts` — the server-side storage seam.

Broken by the move: `FarmRoom` imports `../systems/*`, which now live in
`@pollen/shared`. The systems are unchanged in behaviour — they operate on plain
objects instead of Schema instances.

## Reviving it

`MapSchema` and a plain `Map` expose the same surface (`get`/`set`/`has`/
`forEach`/`size`), so the systems are close to running against either. The real
work is one of:

1. Make the systems generic over the state shape, so a `MapSchema` and a `Map`
   both satisfy them — no duplication, some indirection in the core.
2. Keep plain state as the source of truth server-side and mirror it into a
   Schema purely for sync.

Option 2 is usually the calmer one: the rules stay framework-free, and only the
transport knows about Colyseus.

The intended path is a separate repository for co-op that depends on
`@pollen/shared` for the rules — which is exactly why the rules were moved out
of here.
