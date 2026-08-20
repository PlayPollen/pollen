# 🌼 [PlayPollen.com](https://www.playpollen.com)

*🐝 A free, cozy farming game with a purpose — a share of any future profit goes to pollinator conservation.*

Runs in the browser · Built on TypeScript · Open source (AGPL-3.0)

## Layout

npm workspaces: `shared`, `client`. (`server/` is parked — see below.)

```
shared/src/        the portable game core — no framework, no network
  types.ts         crops, hives, constants both sides agree on
  state.ts         plain state model + save serialisation
  appearance.ts    character looks
  systems/         ALL game rules: farming, beekeeping, movement, rng
  persistence.ts   SaveStore — the swappable-storage seam
client/
  src/game/        LocalGame: the tick loop + IndexedDB saves
  src/scenes/      Phaser scenes: menu, character, farm, hud, pause
  src/art/         runtime-generated character and world art
  src/ui/          shared UI pieces
server/            PARKED — the co-op reference. Not built or tested.
```

**The rules are the single source of truth.** Every action goes through a pure
function in `shared/src/systems/` — the renderer only sends intents and draws
what comes back. It never computes a reward, never edits its own wallet, never
runs the RNG. That gives three things at once: outcomes you can reproduce from a
seed, unit-testable game logic, and a core that can run anywhere.

Today it runs in the browser, so single player needs no server at all: no
latency, no hosting bill, and it works offline. If co-op arrives, the *same*
rules run server-side, where being the single source of truth also makes them
the anti-cheat boundary.

## Why these choices scale

- **Framework-free core**: `shared/` depends on nothing — not Phaser, not a
  network library, not a database. That's what lets it run in a browser today
  and on a server tomorrow without a rewrite.
- **Seeded RNG**: reproducible, auditable, and testable. Given a seed you can
  replay any outcome, which is priceless for "why did I get that drop?".
- **`SaveStore`**: game logic depends on an interface, not on IndexedDB. Cloud
  saves later are a new adapter, not a refactor.
- **Sparse state + viewport culling**: an untouched tile costs nothing to store
  or draw, so cost scales with what's *planted* and what's *on screen* — not
  with the size of the map.

## Build order (don't skip ahead)

1. **Single-player loop** — plant/water/harvest/daily + juice. Fun solo first.
2. **Depth** — town, NPCs, dialogue, inventory. Where a farming game earns its
   hours.
3. **Realtime co-op** — multiple players live on one farm. The hard part, last.

## Run

```
sh scripts/setup-dev.sh    # one-time: installs deps, builds shared, adds DCO hooks
npm run dev                # the game on http://localhost:5173
```

Then open <http://localhost:5173>. Controls: **WASD/arrows** walk, **1/2/3/4**
pick tool (plant, water, harvest, hive), **Tab** cycle seed, **click** a tile
within reach to act, **Space** claim the daily reward, **+/-** zoom, **ESC**
pause.

```
npm test          # rules, save round-trip, movement and reach tests
npm run lint      # eslint across all workspaces
npm run typecheck # tsc --noEmit across all workspaces
npm run build     # production build into client/dist
npm run deploy    # build + deploy to Cloudflare Workers
```

Production builds ship without sourcemaps — the map is ~10MB against a ~1.5MB
bundle. `npm run build:debug` produces the *same* bundle with its sourcemap,
for when a production-only bug needs a readable stack trace.

`shared/` compiles to `shared/dist`, so run `npm run build:shared` after
changing it (the `dev` and `test` scripts already do this for you).

Your farm saves to **IndexedDB in your browser**, not to a server — so clearing
site data clears your farm. "New Farm" on the title screen resets it deliberately.

## Contributing

Pollen is open source and contributions are welcome — whether that's code, art,
bug reports, or ideas. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) to get started.

The one rule to know: **the game rules are authoritative.** Logic, rewards, and
randomness live in `shared/src/systems/` as pure functions; the client only
sends intents and renders what comes back. It keeps the game fair, testable, and
portable — so PRs that respect that boundary are easy to accept.

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
