# Contributing

Thanks for your interest! This is a learning-focused community project — clear,
well-tested contributions are more valued than clever ones.

## Ground rules for this codebase

This project has **one architectural rule that PRs must respect**:

> **The server is authoritative.** Game logic, reward decisions, and RNG live on
> the server. The client sends *intents* and *renders* state — it never computes
> a reward or edits its own state.

A PR that moves reward logic or RNG to the client will be declined regardless of
how well it works, because it breaks anti-cheat, multiplayer correctness, and
testability all at once. If you're unsure where something belongs, open an issue
first.

## Dev setup

```bash
git clone <your-fork>
cd pollen/server
npm install
npm run dev     # authoritative server on :2567
npm test        # deterministic reward tests
```

## Before you open a PR

- [ ] `npm test` passes
- [ ] `npx tsc --noEmit` is clean
- [ ] `npm run lint` is clean
- [ ] New game logic has a test (seeded RNG makes exact outcomes assertable —
      use it)
- [ ] Commits are signed off (see DCO below)

## DCO — Developer Certificate of Origin

Every commit must be signed off:

```bash
git commit -s -m "your message"
```

**You probably won't have to think about this.** Run the one-time setup and the
sign-off is added automatically on every commit:

```bash
sh scripts/setup-dev.sh
```

That points git at the shared hooks in `.githooks/`, which auto-append your
`Signed-off-by:` line (and hard-block a commit if it's ever missing). CI verifies
it as a server-side backstop.

The `-s` adds a `Signed-off-by:` line certifying you wrote the code and have the
right to submit it under the project's license (AGPL-3.0 for code).

**Why we use DCO:** it keeps the project's licensing clean and preserves the
maintainer's ability to offer the project under a commercial license in the
future. By signing off, you agree your code contributions are licensed under
AGPL-3.0 and that the maintainer may also license the project (including your
contribution) under other terms. If you're not comfortable with that, that's
completely fine — open an issue to discuss before contributing.

## Assets are different

Code is AGPL-3.0. **Art, music, and other assets are NOT** — see
`assets/LICENSE-ASSETS.md`. If you contribute assets, say so explicitly in your
PR and note the license you intend for them.

## Good first issues

Look for the `good first issue` label. Docs, tests, and small self-contained
systems (a new crop, a new reward animation) are great starting points.
