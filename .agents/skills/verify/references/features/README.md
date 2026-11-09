# Event Factory verification map

This directory is the maintained source for verifying what a player sees. Read it before driving the game, then use the matching feature file as the recipe.

## Baseline

- Launch the dev server per the skill's Launch section. Its port is in the JSON line `spawn` printed and in `.verify/runs/<run-id>/run.json`.
- The pack is `packs/order-processing` unless `EVENT_FACTORY_PACK` names another. Its levels, in order, are `Your first event`, `Two teams, one order`, `Ship from the right continent` and `When payments fail`.
- `pnpm pack:check` for the same pack exits 0 before any UI drive.

## Reset

- Every level opens from its own map at tick 0. `Clear` returns to that state, and `Restart` returns to tick 0 with the layout kept. Reloading the page keeps the level from the URL hash and resets it. Won levels are remembered in `localStorage`; a new browser context starts with none.

## Driving conventions

- Locate controls by role and accessible name: `Show solution`, `Play`, `Pause`, `Step`, `Restart`, `Clear`, the speed buttons `1×` `2×` `4×` `8×`, and the part buttons by title. Level cards are `a[data-level]`.
- The map is a canvas that fills the screen. It publishes `data-cell`, `data-ox` and `data-oy`, and cell `(x, y)` is centered at `(ox + (x + 0.5) * cell, oy + (y + 0.5) * cell)` from the canvas origin.
- Wait for the heading `Level complete` or `Level lost`, never a fixed sleep, to know a level finished.

## Proof

- A level proof is the result card plus the goal counts, in a screenshot.
- Interactions get the drive's recording.
- `results.json` with no `FAIL` and an empty error list covers console errors for the whole drive.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph, then four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with Playwright`, `Gotchas`.

## Features

- [Levels](./levels.md) covers the level list and playing each level's reference solution.
- [Building](./building.md) covers placing, dragging, rotating and removing by hand.
- [Inspector](./inspector.md) covers docs and live facts for buildings, belts, events and palette kinds.
- [Feel](./feel.md) covers what the map animates, the ending, sound and the idle map.
