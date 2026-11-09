# Event Factory

A factory-building web game whose items are events. A **pack** (one TypeScript file in `packs/<name>/pack.ts`) supplies every event type, building, level and doc string. The engine supplies the behavior, and its four archetypes are source, broker, machine and sink. The web app renders whatever pack it is given.

## Which job you are doing

- **Writing or porting a pack** (a company's real event system, new levels): read `docs/pack-authoring.md` first. Edit only `packs/`. The work is done when `pnpm pack:check packs/<name>` exits 0 and every scenario's solution wins while its counterexamples lose.
- **Changing the engine** (a new archetype, a new fault, a new metric): read `docs/architecture.md` first. The work is done when `pnpm typecheck`, `pnpm test` and `pnpm pack:check packs/order-processing` all pass.
- **Changing the web app**: it reads the engine only through `@event-factory/engine`, and the pack only through `virtual:pack`. Keep the app free of domain names, so any pack renders.

Terms are defined in `docs/glossary.md`. Use those words in code, docs and levels.

## Rules that are easy to miss

- A pack is data. When a company concept does not fit an archetype, model it as configuration of one (see the mapping table in `docs/pack-authoring.md`). Add an archetype only when that is impossible, and record why in `docs/decisions/`.
- Teaching comes from the rules. A level proves its lesson with a counterexample: the wrong layout must lose in `pack:check`.
- Randomness is keyed by event identity, never by position or tick order, so every correct layout sees the same luck as the reference solution.
- `effect` here is version 4. Its API differs from Effect 3. Check `node_modules/effect/AGENTS.md` and `src/Schema.ts` before you use an API from memory.
- The simulation hot path is plain pure TypeScript. Effect is for boundaries, which here are pack loading and the CLI.

To run the app and prove a change works, use the `verify` skill (`.agents/skills/verify/SKILL.md`).
