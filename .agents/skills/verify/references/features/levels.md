# Levels

The level list shows the pack's title, doc and levels. Opening a level shows its brief, map, palette, goals and rules. `Show solution` loads the pack's reference layout, and playing it finishes the level.

## Sub-features

- `levels-list` lists every scenario of the pack in order with its brief.
- `levels-solution` loads the reference solution.
- `levels-clock` plays, pauses, steps and changes speed.
- `levels-outcome` shows `Level complete` or `Level lost` with the reason.

## How to get to it (user POV)

- Open the app root, then choose `Start level` on a row.
- A URL hash `#/<scenarioId>` opens that level directly.
- A hash that names no level, including malformed percent-encoding such as `#%E0`, shows the level list.

## Driving it with Playwright

Preconditions: the dev server is up and Doctor passes.

- **List.** `page.goto(url)`. The number of `Start level` texts equals the number of scenarios in the pack.
- **Open.** `page.getByText("Start level").nth(i).click()`. A canvas appears.
- **Bad hash.** `page.goto(url + "#%E0")`. The level list still shows every `Start level`.
- **Solve.** Click the `Show solution` button, then `8×`, then `Play`. Wait for text starting `Level complete`. The HUD goals read full, for example `12/12`.
- **Script.** `drive.mjs --flow levels` does all of the above for every level and screenshots each finish.

## Gotchas

- `Play` is disabled once a level has finished. `Reset` re-enables it.
- At `8×` a short level finishes in about a second, so take mid-run screenshots at `1×`.
