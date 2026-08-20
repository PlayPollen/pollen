# 🌼 [PlayPollen.com](https://www.playpollen.com)

*🐝 A free, cozy farming game with a purpose — a share of any future profit goes to pollinator conservation.*

Runs in the browser · Built on Node/TypeScript · Open source (AGPL-3.0)

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

**The server is authoritative.** The client sends *intents* ("I want to harvest
tile 3,4") and *renders* whatever state comes back. It never computes a reward,
never edits its own wallet, never runs the RNG. This gives you three things at
once: anti-cheat, clean multiplayer sync, and unit-testable game logic.

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

## Contributing

Pollen is open source and contributions are welcome — whether that's code, art,
bug reports, or ideas. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) to get started.

The one rule to know: **the server is authoritative.** Game logic, rewards, and
randomness live on the server; the client only sends intents and renders what
comes back. It keeps the game fair, cheat-resistant, and testable — so PRs that
respect that boundary are easy to accept.

Every pull request runs through CI (typecheck, lint, and tests) and uses
[DCO](https://developercertificate.org/) sign-off (`git commit -s`), which keeps
the project's licensing clean.

## License

- **Code** is licensed under the **GNU AGPL-3.0** (see [`LICENSE`](./LICENSE)).
  In short: you're free to use, study, modify, and share the code — but if you
  run a modified version as a public service, you must share your changes too.
  This keeps Pollen open for everyone while preventing closed commercial forks.
- **Game assets** — artwork, music, sound, and the Pollen name and logo — are
  **not** covered by the AGPL and remain © the project
  (see [`assets/LICENSE-ASSETS.md`](./assets/LICENSE-ASSETS.md)).

## Support Pollen

Pollen is free to play and free to build on. If you'd like to help it grow:

- 💛 **[Sponsor on GitHub](https://github.com/sponsors/PlayPollen)** — supports
  ongoing development and hosting.
- ☕ **[Buy us a coffee on Ko-fi](https://ko-fi.com/playpollen)** — one-off tips
  welcome, no account needed.

Contributions here help cover hosting and development. Separately, **a share of
any future profit goes to pollinator conservation** — that pledge stands on its
own, and we'll report publicly on it once there's revenue to share. 🐝
