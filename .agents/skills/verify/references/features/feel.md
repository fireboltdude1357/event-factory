# Feel

What the map shows while a level runs and when it ends. Every animation comes from a telemetry record or from the frame's own clock. None is scripted.

## Sub-features

- `feel-belts` moves each belt's treads at parcel speed and bends parcels around corners.
- `feel-buildings` shows each building's work: a handler's gear and progress ring, a broker's buffer window, a retry timer with a `try n/m` tag, a dashed outline and warning sign when stalled. Each building shape has its own silhouette and color.
- `feel-effects` plays one short effect per fact: stars and `+1` for a delivery, `fail!` and a shake for a failure, `retry`, `dead-lettered`, `dupe skipped`, `applied twice!`, `lost!` and `out of order` labels. A placed part squashes and settles.
- `feel-ending` throws confetti on a win and rims the map red on a loss, and stamps the work order `SHIPPED`, `SAMPLE` (the reference solution won) or `RETURNED`.
- `feel-sound` plays a short synthesized cue per effect. The speaker button mutes it, and the choice is kept.
- `feel-idle` stops painting when the clock is paused and the last effect has ended.

## How to get to it (user POV)

- Play any level. `When payments fail` shows failures, retries, dead letters and skipped duplicates in one run.

## Driving it with Playwright

Preconditions: a level open with `Show solution` loaded.

- **Running.** Click `Play`. `canvas[data-cell]`'s `data-paints` rises by more than 20 in a second.
- **Idle.** Click `Pause`, move the pointer off the map and wait 2 seconds. `data-paints` must not change over the next 2 seconds.
- **Look.** Screenshot `When payments fail` at `1×` about 5 to 7 seconds in, and any level half a second after it ends.
- **Script.** `drive.mjs --flow idle`. `--flow levels` takes the mid-run and ending screenshots.

## Gotchas

- Sound cannot be asserted from a headless drive. Check the mute button's `aria-pressed` and listen by hand.
- An effect lasts under a second, so a screenshot shows only the ones in flight.
