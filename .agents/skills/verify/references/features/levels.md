# Levels

The level list shows the pack's title, doc and levels as cards, each with its starting map, and tracks which levels the player has won. Opening a level shows the board, the parts tray, the clock console and a clipboard work order with the goals, the brief and the rules. `Show solution` loads the pack's reference layout, and playing it finishes the level.

## Sub-features

- `levels-list` lists every scenario of the pack in order with its brief, a thumbnail of its start map, and `N of M levels complete`.
- `levels-progress` marks a level complete with the player's best ticks once they win it with their own layout. A win with the reference solution loaded does not count. Progress is kept in `localStorage` per pack.
- `levels-solution` loads the reference solution.
- `levels-clock` plays, pauses, steps and changes speed.
- `levels-outcome` stamps the work order and shows a result card headed `Level complete` or `Level lost`. A win shows the ticks taken against the reference time and the pack's debrief. A loss shows the reason and the latest hint.
- `levels-retry` (`Fix and retry` on a lost card, `Restart` on the console) returns to tick 0 and keeps the layout. `Clear` returns to the bare map.

## How to get to it (user POV)

- Open the app root, then choose a level card.
- A URL hash `#/<scenarioId>` opens that level directly.
- A hash that names no level, including malformed percent-encoding such as `#%E0`, shows the level list.

## Driving it with Playwright

Preconditions: the dev server is up and Doctor passes. Each browser context starts with no progress.

- **List.** `page.goto(url)`. The number of `a[data-level]` links equals the number of scenarios in the pack.
- **Open.** `page.locator("a[data-level]").nth(i).click()`. `canvas[data-cell]` appears.
- **Bad hash.** `page.goto(url + "#%E0")`. The level list still shows every link.
- **Solve.** Click `Show solution`, then `Play`, then `8×`. Wait for the heading starting `Level complete`. The goals on the work order read full, for example `12/12`.
- **Not progress.** After every solution has been watched, the list still reads `0 of 4 levels complete`.
- **Lose, then fix.** On `Your first event`, drag a belt from `(2, 1)` to `(9, 1)` and play at `8×`. The card reads `Level lost`. Click `Fix and retry`, pick `PaymentService`, click `(5, 1)` and play. The card reads `Level complete`, which proves the belts were kept.
- **Script.** `drive.mjs --flow levels` and `--flow retry`.

## Gotchas

- `Play` is disabled once a level has finished. `Restart` or `Fix and retry` re-enables it.
- At `8×` a short level finishes in about a second, so take mid-run screenshots at `1×`.
- On a phone a finished level hides the tray and console to make room for the result card. `Run it again`, `Fix and retry` and `Clear the map` on the card bring them back.
