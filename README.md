<img src="assets/icon.svg" width="64" height="64" alt="">

# Event Factory

A factory-building web game where the items are events. Belts carry events between services, queues, topics and external systems. Players learn how an event-driven system behaves by building one: a queue splits work while a topic copies it, a retry can charge a card twice, an idempotency key prevents that, and a poison message needs a dead-letter queue.

This repo is the engine and game shell. The teaching content lives in a **pack**: one TypeScript file that describes a company's events, services and levels, with the company's own docs on every item. Swap the pack and the same game teaches a different system. `packs/order-processing` is an invented example with four levels.

## Run it

```sh
pnpm install
pnpm dev                                   # the game, at http://localhost:5173
pnpm pack:check packs/order-processing     # prove every level is winnable and teaches its lesson
pnpm test
pnpm typecheck
```

To play another pack, set `EVENT_FACTORY_PACK=packs/<name> pnpm dev`.

## Port it to your system

Write `packs/<your-company>/pack.ts` and run `pnpm pack:check` on it until it exits 0. [`docs/pack-authoring.md`](docs/pack-authoring.md) maps common infrastructure onto the four building archetypes: Kafka topics, service-bus queues, consumers, batch jobs, webhooks, database writes, DLQs and schema versions. A coding agent can do the port by following [`AGENTS.md`](AGENTS.md).

## How it works

- **Four archetypes.** Every building is a source, broker, machine or sink. Queues, topics, handlers, routers, retry policies and dead-letter queues are configuration of these four.
- **Events and parcels.** An event is a fact with an id, correlation and idempotency key. A parcel is one delivery of it. That split lets the game tell a duplicate delivery from a duplicate side effect.
- **Deterministic.** A run is a function of the pack, the seed and the player's commands. Failure rolls are keyed by event identity, so every correct layout gets the same luck as the reference solution.
- **Proven levels.** `pack:check` runs each level's reference solution, which must win, and its counterexamples, which must lose. A level whose wrong answer also wins fails the check.
- **Telemetry.** One ordered stream records what happened. Goals, hints, the HUD, tutorials and the causation trace in the inspector all read it.

More detail is in [`docs/architecture.md`](docs/architecture.md), [`docs/glossary.md`](docs/glossary.md) and [`docs/decisions/`](docs/decisions/).

## Layout

| Path | Contents |
| --- | --- |
| `packages/engine` | The simulation, pack loader, inspector and browser session. Pack authors import `@event-factory/engine/author`. |
| `packages/cli` | `pack:check`. |
| `apps/web` | The React game. It renders whatever pack it is given. |
| `packs/` | Domain packs. |

## License

MIT. See [`LICENSE`](LICENSE).
