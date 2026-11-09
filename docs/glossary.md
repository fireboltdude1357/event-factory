# Glossary

- **Event.** A fact, recorded once in the run's event log with a type, version, payload, origin, correlation and idempotency key.
- **Parcel.** One delivery of an event: the thing on a belt. Fanout copies and publisher duplicates are extra parcels of the same event.
- **Idempotency key.** The identity of the business operation behind an event. Built from the event type's `key` fields when declared, otherwise derived from causation: the root's source kind, stream and count, then the machine kind, recipe and emit of each step. A retry after an `afterEffect` fault creates a new event with the same key.
- **Correlation.** The id of the root event that started a chain. Every event a chain produces carries it.
- **Archetype.** One of the four engine behaviours: source, broker, machine, sink. Packs never add one.
- **Kind.** A pack's named configuration of an archetype, such as `PaymentService`. Each building on the map is one kind.
- **Belt.** The one engine-fixed wire between buildings. Packs rename and document it, and model transports as brokers.
- **Pack.** One TypeScript file whose default export describes a company's events, kinds and levels. `loadPack` turns it into the resolved `Pack` the engine runs.
- **Catalog.** The part of a pack that describes the system: the belt, the event types and the kinds.
- **Scenario.** One level: a map, an unlocked palette, faults, goals, constraints, hints, a reference solution and counterexamples.
- **Fault.** Scenario-level chaos on machine kinds: a failure before or after the effect, by chance or always. Rolls depend on the event's key, never on layout.
- **Goal.** A count of first-time deliveries of an event type at an external sink.
- **Constraint.** A monotone count that loses the level once crossed, such as `noLoss` or `maxDeadLettered`.
- **Settled.** Every finite source has emitted its count and no parcel is left on a belt or in a building. A level is won only when settled with every goal met, or at `maxTicks` with every goal met.
- **Counterexample.** A layout that must lose, with the lesson it proves. `pack:check` always adds the bare map.
- **Telemetry.** The single ordered stream of facts about a run. Metrics, goals, hints, the HUD and traces all read it.
- **Stalled.** A building that has work it cannot hand off, usually because its out side is full or has nothing linked.
