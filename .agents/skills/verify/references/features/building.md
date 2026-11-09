# Building

The player builds a layout by hand from the palette. Placed belts and buildings connect, and a correct layout wins the same way the reference solution does.

## Sub-features

- `build-place` places the selected palette tool on a cell.
- `build-drag` lays a belt run by dragging, turning at corners.
- `build-rotate` rotates the tool before placing (`R`, `Shift+R`), or the thing under the pointer when no tool is selected.
- `build-remove` removes with right-click.
- `build-reject` shows a toast for a rejected command, such as an occupied cell or a spent budget.

## How to get to it (user POV)

- Click a palette item, then click or drag on the map. `Esc` drops the tool.

## Driving it with Playwright

Preconditions: level `Your first event` open at tick 0.

- **Belts.** Click `Kafka partition` in the palette. Drag from cell `(2, 1)` to `(4, 1)`. Three east belts appear.
- **Service.** Click `PaymentService`, then click cell `(5, 1)`. The palette shows `0 left` for it.
- **Belts.** Select the belt again and drag `(6, 1)` to `(9, 1)`. Press `Escape`.
- **Run.** Click `8×`, then `Play`. The banner reads `Level complete`.
- **Script.** `drive.mjs --flow build`.

## Gotchas

- Placing a belt over a belt that faces another way is rejected as occupied, and during a drag only the first toast shows.
- Locked map buildings cannot be moved or removed.
