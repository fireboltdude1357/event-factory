# Writing a domain pack

A pack describes one company's event system as game data: its events, its services and queues, and a few levels that teach how they fit together. The engine has no company knowledge. A new pack needs no engine changes.

`packs/order-processing/pack.ts` is the worked example. Copy it and replace its contents.

## The loop

1. Create `packs/<your-pack>/pack.ts`. Its default export is `definePack({...})`, imported from `@event-factory/engine/author`.
2. Run `pnpm pack:check packs/<your-pack>`.
3. Fix what it reports and run it again. Repeat until it exits 0.

`pack:check` loads the pack, then for every level runs the reference solution, which must win, and every counterexample, which must lose. The bare map with nothing placed is always checked as a counterexample.

| Exit | Meaning | What to do |
| --- | --- | --- |
| 0 | Every solution wins and every counterexample loses. | Done. |
| 1 | A solution lost, or a counterexample won. | Read the reason and the last telemetry lines. Tune the level's numbers, its layout, or its constraints. |
| 2 | The pack did not load. | Every issue is printed with its path, such as `catalog.kinds.Payments.recipes[0].emit[0].produce: unknown event "PaymentCapture"`. Fix all of them in one pass. Loading has two stages. Structural issues come first, such as a missing key or a string where a number belongs, and all of them print at once. References (unknown events, kinds and ports, budgets, map cells) are checked only once the structure is valid, so a second run can print new issues. A placement the engine refuses after load also exits 2, at the overlay's path. |

`--scenario <id>` checks one level. `--json` prints the full result, including each run's metrics and last 50 telemetry records.

The editor catches most mistakes before `pack:check` does: an unknown event in a recipe, an emit on a port that is not in `outputs`, a `copy` field that is missing or has a different type on the produced event, a produced event field that neither `copy` nor `set` supplies, a `key` field the event lacks, a source payload of the wrong type, a goal or `inOrder` `at` that is not an external sink, a hint on a tag that cannot fire it, and an unknown kind in a legend. `pnpm typecheck` shows them. The loader repeats every check, so a pack written as plain JSON fails with the same paths. The loader is the gate. The editor misses a few cases, such as a `set` built by a helper that sometimes leaves a field out, and `pack:check` still reports them.

## Mapping your system onto the four archetypes

Every building is one of four archetypes. Everything else is configuration of one of them. A belt is only the wire between buildings. Rename it with `catalog.belt` (for example "Kafka partition"), but model your transports as brokers.

| Your system has | Model it as |
| --- | --- |
| Kafka topic, SNS topic, event bus with subscriptions | `broker` with `delivery: "fanout"`. Each linked out side is one subscriber. |
| Service Bus queue, SQS queue, RabbitMQ work queue | `broker` with `delivery: "competing"`. Each event goes to one linked consumer. |
| Consumer service that reacts to an event and publishes another | `machine` with a recipe that `consume`s one type and emits `produce`. |
| Batch job | `machine` with a long `ticks` and several `workers`. If the job runs on a schedule and publishes, model it as a `source` with `every`. |
| Inbound webhook, UI, partner feed | `source`. |
| Outbound webhook, partner API, email provider | `sink` with `role: { kind: "external", dedupe: "none" }`. |
| Database write | `sink` with `role: { kind: "external" }`. Use `dedupe: "idempotencyKey"` for an upsert on a business key and `"none"` for a plain insert. |
| Idempotent API (accepts an idempotency key) | `sink` with `dedupe: "idempotencyKey"`, and declare `key` on the event type it receives. |
| Dead-letter queue | `sink` with `role: { kind: "deadLetter" }`, fed from a machine port named in `failures.exhausted: { route }`. |
| Schema registry version gate | A machine recipe with `where: { version: 2 }`. Use `unmatched: "refuse"` to model a strict consumer that blocks on the old version, or `unmatched: { route: "port" }` to send it elsewhere. |
| Content-based router, filter | `machine` whose recipes have `ticks: 0` and only `forward` emits, picked by `where`. The inspector calls it "Router". |
| Retry policy | `machine.failures`: `maxAttempts`, `backoff`, and `exhausted`. |
| Timeouts, poison messages, crashes after a write | Scenario `faults`, not kinds. See [Faults](#faults). |

A kind describes code. One kind behaves the same in every level. If your company has "PaymentService with retries" and "PaymentService without", declare two kinds.

Not modeled: joins or aggregation across events, per-key partition ordering (`inOrder` checks order per source building), and payload fields that change between versions (`version` is a number tag).

## Events

```ts
events: {
  OrderPlaced: {
    doc: "A customer checked out. `total` is in cents.",
    fields: { orderId: "string", region: ["us", "eu"], total: "number" },
    key: ["orderId"],
  },
}
```

- An event type name is any text without `:`, such as `OrderPlaced`, `orders.v1.placed` or `Order Placed`. Business keys use `:` after the type. The name `any` is reserved, because a goal or fault without `type` means every event type.
- `fields` types are `"string"`, `"number"`, `"boolean"`, or a tuple of strings, which is an enum. Numbers must be finite.
- `doc` is Markdown the player reads in the inspector. Write it in your company's words. The game is documentation.
- `key` names the fields that identify the business operation. The idempotency key is the type, `:`, and the JSON of the value, such as `OrderPlaced:"ord-14"`. With several fields it is the JSON array of their values, such as `Transfer:["acct-1","op-7"]`. JSON keeps a value such as `ord-14/Billing.0.0` from spelling a key derived from causation. Declare it on any event an idempotent sink receives, so a retry that re-creates the event dedupes the way your real system does. Without `key`, the engine derives one from causation: the root event's source kind, stream and count, plus `/Kind.recipe.emit` for each machine step, such as `Storefront#0.3/PaymentService.0.0`. Two kinds that handle the same event produce different keys. Two buildings of one kind on two fanout branches produce the same key, because they perform the same operation.
- `version` (default 1) is stamped on new events. A source payload can override it to mix versions.
- `color` is optional and is a hex color, `"#f97316"` or `"#f93"`. The loader picks one from a palette when it is missing. The game also gives each event type a silhouette by its position in `events`, so the first five types never differ by color alone.

## Kinds

Every kind has `archetype`, `title`, `doc`, an optional one-character `glyph`, and an optional `color` such as `"#f97316"`. The game draws a building from what its kind does (producer, queue, topic, handler, router, external system, dead-letter queue) and colors it to match. Set `color` only when a building should carry a team or system color of its own. A kind's name starts with a letter and uses letters, digits, `_` and `-`. The names `belt`, `any` and `anyExternal` are reserved. Put spaces and punctuation in `title`. Orientation matters for every building. Input is always the back side. `front`, `left` and `right` are relative to the building's facing, so a building facing east has its left side to the north.

### source

```ts
Storefront: {
  archetype: "source", title: "Storefront", doc: "...",
  emits: [{ type: "OrderPlaced", every: 6, count: 12, duplicateChance: 0.1,
            payloads: [{ weight: 3, values: { orderId: { seq: "ord-" }, region: "us", total: 4200 } }] }],
  whenBlocked: "wait",
}
```

- Each `emits` entry is a stream. It emits every `every` ticks, `count` times. Omit `count` for an endless stream. A level with an endless source is decided at `maxTicks`.
- `payloads` are picked by `weight`. `{ seq: "ord-" }` becomes `ord-1`, `ord-2` and so on, counted per stream.
- The source sends from its front side. `whenBlocked: "wait"` holds the event and slips the schedule, which is backpressure. `"drop"` loses the event, which fails `noLoss`.
- `duplicateChance` sends the same event twice, as an at-least-once publisher does after a timeout.
- Two buildings of the same source kind emit identical streams, with the same payloads and keys. Declare a second kind for a second producer.

### broker

```ts
OrdersQueue: { archetype: "broker", delivery: "competing", capacity: 8, whenFull: "block", title: "...", doc: "..." }
```

- `competing` gives each event to one consumer, round-robin over linked sides. A slow consumer gets fewer events. With no consumer linked, events wait in the buffer.
- `fanout` gives each event to every linked side, as the same event. Its subscribers are the out sides that have a belt or building attached, up to three. A subscriber linked later sees only later events. With no subscriber linked, events are dropped.
- `capacity` is the buffer size. For fanout it is per subscriber. `whenFull: "block"` refuses new events, which pushes back. `"drop"` loses them.

### machine

```ts
PaymentService: {
  archetype: "machine", title: "PaymentService", doc: "...",
  outputs: { out: "front", dlq: "right" },
  workers: 1,
  recipes: [{ consume: "OrderPlaced", ticks: 6, emit: [{ port: "out", produce: "PaymentCaptured", copy: ["orderId", "total"] }] }],
  unmatched: "refuse",
  failures: { maxAttempts: 4, backoff: { doubling: 2 }, exhausted: { route: "dlq" } },
}
```

- `outputs` names ports and puts each on a side. Two ports cannot share a side.
- The first recipe whose `consume` and `where` match an event wins. A recipe works for `ticks`, one event per worker.
- `forward: "port"` passes the event on unchanged. `produce` creates a new event: `copy` takes fields from the consumed event, and `set` fixes the rest. Between them they must cover every field of the produced event.
- `unmatched` handles an event no recipe matches. `"refuse"` leaves it at the head of the input belt, which blocks the line, as a strict consumer does. `"drop"` loses it. `{ route: "port" }` sends it out a port.
- `failures.maxAttempts` counts the first try. `backoff` is `{ fixed: n }` or `{ doubling: n }` ticks (n, 2n, 4n...), and a worker stays busy while it waits. When attempts run out, `exhausted` drops the event or routes it to a port. If that port has nothing linked, the machine stalls.
- `where` is plain data: `{ field, is }`, `{ field, oneOf }`, `{ field, above, below }` for numbers (at least one bound, both exclusive, and `above` less than `below`), `{ version }` with a whole version number, and `{ all }`, `{ any }`, `{ not }`.

### sink

```ts
Ledger: { archetype: "sink", accepts: ["PaymentCaptured"], ticksPerEvent: 1, role: { kind: "external", dedupe: "idempotencyKey" }, title: "...", doc: "..." }
```

- `accepts` limits event types. A sink refuses the others, which blocks the belt. Omit it to accept everything.
- An `external` sink applies each event. A key it has already seen is a duplicate: `dedupe: "idempotencyKey"` ignores it, and `"none"` applies it again, which fails `noDuplicateEffects`.
- A `deadLetter` sink parks events. They count against `maxDeadLettered`, not against `noLoss`.

## Levels

`scenarios` lists the levels in play order. A pack needs at least one.

```ts
{
  id: "when-payments-fail", title: "...", brief: "Markdown shown before the level.",
  debrief: "Markdown shown when the level is won.",
  seed: 3, maxTicks: 900,
  map: ["............", ".S........L.", "............"],
  legend: { S: { kind: "FlakyStorefront", facing: "east" }, L: { kind: "Ledger", facing: "east" } },
  unlocked: ["belt", "PaymentService", "DeadLetterQueue"],
  budget: { PaymentService: 1 },
  faults: [...], goals: [...], constraints: [...], hints: [...],
  solution: { map: [...], legend: {...} },
  counterexamples: [{ why: "...", map: [...], legend: {...} }],
}
```

`debrief` is optional. Use it to state the lesson in one or two sentences, in your company's words. The player reads it on the result card right after they win, next to their time and the reference solution's time.

### Maps

Each string is a row, and every row has the same length.

| Character | Meaning |
| --- | --- |
| `.` | Empty floor. |
| `#` | Wall. |
| `>` `<` `^` `v` | A belt facing east, west, north or south. |
| anything else | Looked up in `legend`: `{ kind, facing, locked? }`. Map entries are locked unless `locked: false`. |

A belt passes events to the cell it faces. It accepts from behind and from both sides, alternating between feeders at a merge. Buildings that touch connect directly: an out side that faces another building's back feeds it. Belts move one event per tile, one tile every `belt.ticksPerTile` ticks.

`solution` and each counterexample are overlays the same size as the map. `.` keeps the map cell. The others place onto empty floor and must use `unlocked` kinds within `budget`. A map building with `locked: false` counts against `budget` too, because the player can move it, so the map alone must fit the budget. The solution must win. A counterexample must lose, and its `why` says which mistake it proves the level punishes. Add one for every wrong answer a player is likely to try. A level whose wrong answer also wins teaches nothing.

### Faults

Faults describe the environment, not the code. Each fault names machine `kinds`, and optionally an `event` type and a `where` on it. `chance` defaults to always, which makes a poison message. `timing: "beforeEffect"` fails the attempt with no output. `"afterEffect"` emits the outputs and then fails, so the retry produces them again: new event ids with the same idempotency key.

For each attempt, the first fault in list order whose roll hits applies. Put always-on faults first, so a poison event cannot get a lucky `afterEffect` success.

Rolls hash the seed, the fault's index, the event's idempotency key, and the attempt number. They never depend on where buildings are. A player's layout gets exactly the luck the reference solution got, so a level that passes `pack:check` is fair for every correct layout. Changing `seed` changes the luck. A seed is an integer from 0 to 4294967295 (2^32 - 1), and every seed in that range rolls different luck.

### Goals and constraints

A goal counts first-time deliveries at an external sink: `{ deliver: 20, type: "PaymentCaptured", at: "Ledger" }`. Omit `type` or `at` to count any.

| Constraint | Violated when |
| --- | --- |
| `noLoss` | Any event is dropped. Dead-lettered events are not lost. |
| `noDuplicateEffects` | An external sink without dedupe applies a key twice. |
| `maxDeadLettered`, `n` | More than `n` events are dead-lettered. |
| `maxLatency`, `ticks`, optional `type` | An external sink applies an event more than `ticks` after its root event was created. A duplicate the sink applies counts. A duplicate it ignores applies nothing and does not count. |
| `inOrder`, optional `at` | A sink receives events from one source building out of their publish order. |

A violated constraint loses the level at once. The level is won when every goal is met and the factory has settled: every finite source has emitted its count and no event is left on a belt or in a building. This waits out a late duplicate or drop. A factory that never settles is decided at `maxTicks`: won if every goal is met, lost otherwise.

### Hints

`{ when: { tick: 60 }, text }` fires at a tick. `{ when: { on: "stalled", kind: "PaymentService" }, text }` fires the first time that telemetry tag appears, optionally only for one kind. Tags: `emitted`, `accepted`, `produced`, `failed`, `retrying`, `deadLettered`, `dropped`, `delivered`, `duplicateApplied`, `duplicateIgnored`, `outOfOrder`, `stalled`, `unstalled`. The run's own records (`objectiveProgress`, `hint`, `finished`) are not hint tags, and the editor and loader reject them.

## When a check fails

| Report | Usual fix |
| --- | --- |
| Solution lost, out of time, goals short | Raise `maxTicks`, lower goal counts, or speed up the slowest building (`ticks`, `workers`, `ticksPerEvent`). |
| Solution lost to `maxDeadLettered` or `noLoss` | Read the last telemetry. Raise `maxAttempts`, lower a fault `chance`, or change `seed`. Keep the level's lesson. |
| Counterexample won | The level does not punish that mistake. Tighten a goal or add the constraint the mistake should break. |
| Placement errors at load | The overlay places onto a cell the map already uses, uses a kind missing from `unlocked`, or exceeds `budget`. Unlocked map buildings count against `budget`. |

Use `--json` when the last lines are not enough. Each run's `tailText` names the building as `Title@x,y` and the event by its key field.
