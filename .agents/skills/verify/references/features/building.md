# Building

The player builds a layout by hand from the parts tray. Placed belts and buildings connect, and a correct layout wins the same way the reference solution does.

## Sub-features

- `build-place` places the selected part on a cell. A ghost shows what will land, green on a free cell and red otherwise.
- `build-drag` lays a belt run by dragging, turning at corners. Dragging over a belt re-aims it.
- `build-replace` drops a building onto a belt, which replaces the belt.
- `build-rotate` rotates the tool before placing (`R`, `Shift+R`, or the `Rotate` button), or the thing under the pointer when no tool is selected.
- `build-remove` removes with right-click, with the `Remove` tool (`X`, click or drag), or with `Remove` on the spec sheet for the selected cell.
- `build-keys` picks a part with its digit key, `1` to `9`. `Esc` drops the tool.
- `build-reject` shakes the cell and shows a toast for a rejected command, such as a locked building or a spent budget.
- `build-broken-run` ends a belt whose front leads nowhere in a red and white barrier, and draws an unlinked building output as a dashed stub.

## How to get to it (user POV)

- Click a part in the tray under the board, then click or drag on the map.

## Driving it with Playwright

Preconditions: level `Your first event` open at tick 0. Turn a cell into a click position with the canvas's `data-cell`, `data-ox` and `data-oy`: cell `(x, y)` is centered at `(ox + (x + 0.5) * cell, oy + (y + 0.5) * cell)` from the canvas origin.

- **Belts.** Click the `Kafka partition` button. Drag from cell `(2, 1)` to `(4, 1)`. Three east belts appear.
- **Service.** Click `PaymentService`, then click cell `(5, 1)`. Its button shows `×0` and is disabled.
- **Belts.** Press `1` and drag `(6, 1)` to `(9, 1)`. Press `Escape`.
- **Run.** Click `Play`, then `8×`. The card reads `Level complete` and offers `Next level`.
- **Phone.** At 390x844 with touch, tap the part, then tap each cell. The same layout wins.
- **Script.** `drive.mjs --flow build` and `--flow phone`.

## Gotchas

- A tap with a part selected always tries to place it. Press `Escape` or tap the part again before tapping a cell to inspect it.
- Locked map buildings cannot be moved or removed.
