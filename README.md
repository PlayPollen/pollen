# 🌼 Pollen <www.playpollen.com>

*A cozy co-op browser farming game. Built on Node/TypeScript.*

## The one rule everything else follows

**The server is authoritative.** The client sends *intents* ("I want to harvest
tile 3,4") and *renders* whatever state comes back. It never computes a reward,
never edits its own wallet, never runs the RNG. This gives you three things at
once: anti-cheat, clean multiplayer sync, and unit-testable game logic.

## Layout

```
shared/            types + constants both sides agree on (no logic)
server/
  src/schema/      Colyseus synced state (server-owned, auto-replicated)
  src/systems/     ALL game rules: farming.ts (logic), rng.ts (seeded RNG)
  src/rooms/       FarmRoom — one co-op instance; the scaling unit
  src/persistence/ PersistencePort — the swappable-storage seam
  src/main.ts      infra wiring (the only place you change to scale)
client/
  src/net/         intents up, state + reward events down
  src/scenes/      Phaser rendering + the dopamine "juice" layer
```

## Why these choices scale

- **Colyseus** for state-sync: a farming game is low-frequency, so its automatic
  sync overhead is a non-issue, and you get netcode for free.
- **Rooms as the scaling unit**: scale horizontally by running many small
  4-player rooms across many processes — never one giant world. Add a Redis
  presence driver + more nodes; no game code changes.
- **PersistencePort**: game logic depends on an interface, not a database. Start
  with `InMemoryPersistence`, swap in Postgres+Redis by changing one line in
  `main.ts`. If you'd rather not run infra, a managed BaaS adapter fits the same
  seam.
- **Seeded server RNG**: reproducible, auditable, unforgeable, and testable.

## Build order (don't skip ahead)

1. **Single-player loop** — plant/water/harvest/daily + juice. Fun solo first.
2. **Async shared world** — see friends' farms, gift, shared goals. Low risk.
3. **Realtime co-op** — multiple players live on one farm. The hard part, last.

## Run

```
sh scripts/setup-dev.sh                        # one-time: installs deps + DCO hooks
cd server && npm run dev                        # authoritative server on :2567
npm test                                        # deterministic reward tests
```

## License & contributing

- **Code:** AGPL-3.0 (`/LICENSE`). If you run a modified version as a network
  service, you must publish your changes. This is deliberate: it keeps the code
  open and contributable while preventing a **closed, commercial fork of the
  server**. Replace the placeholder LICENSE with the full official AGPL text
  (GitHub inserts it automatically if you pick "AGPL-3.0" when creating the repo).
- **Assets** (art, music, name, logo): **NOT** AGPL — all rights reserved. See
  `assets/LICENSE-ASSETS.md`. A fork gets the farming *logic*, not *this game*.
- **Contributing:** see `CONTRIBUTING.md`. Uses **DCO sign-off** (`git commit -s`)
  so the project's license stays clean and commercial relicensing stays possible
  later. CI enforces typecheck + lint + tests + sign-off on every PR.

What a code license can and can't do for you: AGPL stops closed commercial forks
of your *code*. It does **not** protect your game *idea* (anyone can clone the
concept) — that's what keeping *assets* proprietary and registering a
*trademark* on the name/logo are for. The three together (AGPL code + proprietary
assets + trademark) are the realistic protection an open-source game has.
