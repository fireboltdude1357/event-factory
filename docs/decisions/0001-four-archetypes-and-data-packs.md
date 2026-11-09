# 0001. Four archetypes and data-only packs

Date: 2026-11-09. Status: accepted.

## Context

The game has to teach eventing at a company the authors have never seen. An agent ports it by writing a pack. The engine must cover queues, topics, handlers, routing, retries, dead-letter queues, at-least-once delivery, idempotency and backpressure, and it must do so without engine changes per company.

Two designs were sketched in parallel and compared.

- **Candidate 1 (chosen).** Four archetypes (source, broker, machine, sink). Retry, DLQ, routing and version gates are configuration. The pack is TypeScript data whose generics catch wrong references in the editor. Levels use ASCII maps, scenario-owned faults, counterexample layouts and identity-keyed randomness.
- **Candidate 2.** Six archetypes, including a correlation join. It had a payload expression language, named configuration profiles, sink acknowledgment loss and stricter custody rules. References were strings checked at load time.

## Decision

Build candidate 1, with five rules taken from candidate 2's review.

1. A win is decided only once the factory settles or `maxTicks` arrives.
2. Fault rolls do not depend on position.
3. `Pack` can only be built by `loadPack`.
4. `copy` checks field types.
5. Events can declare business idempotency keys, and parcel conservation is checked.

## Consequences

- A port is usually one file, and most mistakes show up in the editor before `pack:check` runs.
- A service whose behavior the pack can't express (a join, arithmetic on payloads, broker lease redelivery) needs an engine change. Each of these is additive, either a new archetype or a new emit form.
- A configuration change is a different kind, so a level offering "PaymentService with retries" and "PaymentService without" declares two kinds.
- Luck is the same for every layout, so a player cannot reroll a bad seed by rebuilding. That is intended.
