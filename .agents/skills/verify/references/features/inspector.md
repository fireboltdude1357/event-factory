# Inspector

Clicking anything shows what it is in the company's own words, plus what it is doing now. Every doc string comes from the pack, which is what makes the game documentation.

## Sub-features

- `inspect-building` shows the kind's title, role (Handler, Queue, Topic, Router, External system, Dead-letter queue), doc and live facts such as worker state and attempt number.
- `inspect-event` shows the event type doc, payload fields, idempotency key, correlation root, producer and creation tick, plus the causation trace with clickable event ids.
- `inspect-belt` shows the pack's belt title and doc.
- `inspect-kind` shows a palette kind's doc before it is placed.

## How to get to it (user POV)

- With no tool selected, click a map cell. Click a palette item to read its docs.

## Driving it with Playwright

Preconditions: level `When payments fail` open, `Show solution` loaded.

- **Run then pause.** Right after clicking `Show solution`, press Space. The clock plays even though that button still has focus. Wait about 5 seconds at `1×`, then press Space again to pause.
- **Event.** Click belt cells left of the PaymentService at `(5, 1)` until the panel shows `Idempotency key`. The panel title is `OrderPlaced v1`.
- **Building.** Click `(5, 1)`. The panel shows `Handler`, `PaymentService` and the doc beginning `Charges the card`, with a worker's current attempt.
- **Step.** Click belt cell `(4, 1)`, press `.` to step, and read the panel. Click the same cell again. The panel text must not change, which proves Step refreshed it.
- **Script.** `drive.mjs --flow inspect`.

## Gotchas

- Parcels move while the clock runs, so pause before clicking a parcel.
- The inspector refreshes four times a second while playing. Read it after `Pause` for a stable assertion.
