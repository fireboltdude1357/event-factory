# Architecture

The engine is a deterministic, headless factory simulation. A pack describes a company's event system as data. `loadPack` validates it once, and the rest of the engine trusts the result. Node tests, the `pack:check` CLI and the browser session drive the same `Sim`.

## Modules

| File | Owns |
| --- | --- |
| `packages/engine/src/ids.ts` | Branded ids and their constructors. |
| `packages/engine/src/pack/authoring.ts` | `defineCatalog`, `definePack`, `defineScenario` and the generic types that check references in the editor. Published as `@event-factory/engine/author`. |
| `packages/engine/src/pack/load.ts` | `loadPack`: the effect/Schema decode, reference resolution, ASCII map parsing, and `PackInvalid` with every issue at its path. |
| `packages/engine/src/pack/model.ts` | The resolved `Pack`. Its private brand is set only by `loadPack`. |
| `packages/engine/src/sim/event-log.ts` | Events, parcels, idempotency key derivation, and the child and key indexes traces read. |
| `packages/engine/src/sim/rng.ts` | Counter-based rolls. |
| `packages/engine/src/sim/world.ts` | Commands, the layout, and topology derived from it. |
| `packages/engine/src/sim/movement.ts` | Belt slots and pull-based movement. |
| `packages/engine/src/sim/archetypes/` | One `Behaviour` per archetype, plus the registry and shared predicate matching. |
| `packages/engine/src/sim/telemetry.ts` | The `Telemetry` union and `telemetryTags`. |
| `packages/engine/src/sim/objectives.ts` | `Metrics`, `observe` and `evaluate`. |
| `packages/engine/src/sim/sim.ts` | `createSim`, `step`, `runScenario`, `trace`, and telemetry formatting. |
| `packages/engine/src/inspect.ts` | Docs, live facts and derived role names for anything the player clicks. |
| `packages/engine/src/session.ts` | The browser seam: clock, snapshot, render frame, listeners, and `rewind`, which returns to tick 0 with the layout as it stands. |
| `apps/web/src/core/` | The game with no look: the level controller (`level.ts`), the canvas host (`board.tsx`), belt joins and parcel paths (`geometry.ts`), timed effects (`fx.ts`), sound, progress and text. |
| `apps/web/src/look/` | How the game looks: the canvas painter (`paint.ts` and the modules it draws with) and the level and level-list screens. It reads the core and draws. Replacing this folder restyles the game without touching a rule. |
| `packages/cli/src/` | `pack:check`. |
| `packs/order-processing/pack.ts` | The example pack. |

The package `exports` map exposes only `.` and `./author`, so engine internals cannot be imported from outside.

## One tick

`step()` advances the tick and runs four phases in a fixed order:

1. Each building, in ascending entity id, runs its behaviour's `tick`. A behaviour is pure over its own state. It returns intents (send, drop, consume, deliver, fail, retry, outOfOrder) and whether it is stalled. It creates events and parcels only through `ctx.mint` and `ctx.copy`, which record their telemetry, and it can send only to an out side that is linked and empty.
2. `moveParcels` runs every receiver in downstream-first order. A belt tile pulls one ready parcel from its feeders, round-robin. A building's back side offers the parcel at its feeder to `accept`, which takes, refuses or discards it. A refusal leaves the parcel where it is, and that is the only backpressure rule. Each slot has one writer in this phase, so merges need no arbitration.
3. `observe` folds this tick's telemetry into `Metrics`. The sim sets the parcel counts, fires hints, and re-evaluates status when a count changed, the factory settled, or `maxTicks` arrived.
4. `objectiveProgress`, `hint` and `finished` records are appended to the history.

Commands (`place`, `remove`, `rotate`) apply between ticks. Each re-derives the topology. Removing a tile or building drops what it held with reason `removed`. A finished run rejects every command with reason `finished`, because its outcome is final.

## What the map draws

`session.frame()` is the only thing a painter reads. Besides positions it reports what each building is doing: its `shape` (derived from the kind by `shapeOf`), its out sides, how far its current job is (`work`), a retry wait with the attempt number (`retry`) and a broker's buffer (`fill`). `time` is the tick plus the share of the next one already elapsed, so belt and job animation hold still while the clock is paused. Every flash carries an id that is unique within a run, and the app starts one short effect per id. Nothing on screen is scripted: an effect exists because a telemetry record does.

The canvas repaints only while the clock plays, an effect is still running, or something changed. The verify drive checks this by counting paints.

## Determinism

A run is a function of the pack, the scenario seed and the command log. There is no RNG state. Every roll hashes the seed with the identity of the decision:

- A fault roll hashes `("fault", faultIndex, idempotencyKey, attempt)`.
- A source's payload and duplicate rolls hash `(kindId, "payload" | "dup", streamIndex, n)`, where `n` counts events in that stream.

No roll names a position or an entity id. Moving a building or adding a belt changes when events arrive, not which ones fail, so the luck the reference solution got in `pack:check` is the luck every layout gets. `example-pack.test.ts` proves this with an extra belt and a moved PaymentService.

Entity ids are minted in placement order, and map order is ascending id order, so phase 1 visits buildings in the same order on every replay.

## Outcomes

A violated constraint loses at once. Constraints are monotone counts, so that is final. A win needs every goal met and a settled factory: every finite source has emitted its count and no parcel is live. A factory that never settles is decided at `maxTicks`.

Conservation holds after every tick: `minted = live + delivered + duplicateApplied + duplicateIgnored + deadLettered + dropped + consumed`, where `consumed` counts parcels a machine retired by producing new events. The tests check it on every tick of every run. A mismatch is an engine bug, never a level outcome.

## Editor checks at pack scale

`pnpm --filter @event-factory/engine bench:types` generates a 200-event, 60-kind pack and type-checks it. It takes about 2.4 s. The `copy` and `set` rules are checked per recipe a pack declares, not per pair of event types, which kept them from growing with the square of the event count. When every emit leaves some fields to `set`, the same pack takes about 2.8 s.
