# Asset Credits

Tracks every asset that is **not** original work owned by the project, along
with its license. `assets/LICENSE-ASSETS.md` covers original assets; anything
listed here is the exception and is governed by its own license instead.

## Current status: no third-party art in the repo

The client renders procedurally (Phaser `Graphics` primitives) — soil, crops,
flowers, hives, honey levels and hive coverage are all drawn in code from
`client/src/scenes/FarmScene.ts`. There are no image files to credit yet.

## Before adding any third-party asset

1. Confirm the license actually permits commercial use and redistribution.
   CC0 is the safe default; "free for non-commercial" is **not** usable here.
2. Drop the files under `client/public/assets/`.
3. Add a row to the table below.

| Asset | Source | Author | License | Used for |
| ----- | ------ | ------ | ------- | -------- |
| _none yet_ | | | | |

## Why this matters more than usual for Pollen

The project's protection model is **AGPL code + proprietary assets +
trademark** (see the README). The AGPL deliberately allows anyone to run a fork
of the server — what stops a fork from being *this game* is that the art, music,
name and logo are not licensed with the code.

Third-party CC0 art is fine as a placeholder during development, but every CC0
sprite that ships is a piece of the game that anyone may reuse freely. Replacing
placeholders with original art before launch is a **licensing requirement**, not
a polish task.
