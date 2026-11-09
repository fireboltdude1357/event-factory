// Compile-time checks on pack authoring. Each @ts-expect-error must fail to
// compile; if the type stops catching the mistake, tsc reports the unused directive.

import { defineCatalog } from "@event-factory/engine/author";

const base = {
  belt: { title: "belt", doc: "", ticksPerTile: 2 },
  events: {
    A: { doc: "", fields: { id: "string", n: "number" } },
    B: { doc: "", fields: { id: "string" } },
  },
} as const;

// Fine.
defineCatalog({
  ...base,
  kinds: {
    M: {
      archetype: "machine", title: "", doc: "", workers: 1, outputs: { out: "front" }, unmatched: "refuse",
      failures: { maxAttempts: 1, exhausted: "drop" },
      recipes: [{ consume: "A", ticks: 1, emit: [{ port: "out", produce: "B", copy: ["id"] }] }],
    },
  },
});

// Unknown event type consumed.
defineCatalog({
  ...base,
  kinds: {
    M: {
      archetype: "machine", title: "", doc: "", workers: 1, outputs: { out: "front" }, unmatched: "refuse",
      failures: { maxAttempts: 1, exhausted: "drop" },
      // @ts-expect-error "Nope" is not a declared event
      recipes: [{ consume: "Nope", ticks: 1, emit: [{ forward: "out" }] }],
    },
  },
});

// Emitting on an undeclared port.
defineCatalog({
  ...base,
  kinds: {
    M: {
      archetype: "machine", title: "", doc: "", workers: 1, outputs: { out: "front" }, unmatched: "refuse",
      failures: { maxAttempts: 1, exhausted: "drop" },
      // @ts-expect-error "dlq" is not in outputs
      recipes: [{ consume: "A", ticks: 1, emit: [{ forward: "dlq" }] }],
    },
  },
});

// Copying a field the produced event does not have.
defineCatalog({
  ...base,
  kinds: {
    M: {
      archetype: "machine", title: "", doc: "", workers: 1, outputs: { out: "front" }, unmatched: "refuse",
      failures: { maxAttempts: 1, exhausted: "drop" },
      // @ts-expect-error B has no field n
      recipes: [{ consume: "A", ticks: 1, emit: [{ port: "out", produce: "B", copy: ["n"] }] }],
    },
  },
});

// Copying a field whose type differs between the two events.
defineCatalog({
  belt: base.belt,
  events: { A: { doc: "", fields: { n: "number" } }, C: { doc: "", fields: { n: "string" } } },
  kinds: {
    M: {
      archetype: "machine", title: "", doc: "", workers: 1, outputs: { out: "front" }, unmatched: "refuse",
      failures: { maxAttempts: 1, exhausted: "drop" },
      // @ts-expect-error n is a number on A but a string on C
      recipes: [{ consume: "A", ticks: 1, emit: [{ port: "out", produce: "C", copy: ["n"] }] }],
    },
  },
});

// A produced event whose fields copy and set cover between them.
defineCatalog({
  ...base,
  kinds: {
    M: {
      archetype: "machine", title: "", doc: "", workers: 1, outputs: { out: "front" }, unmatched: "refuse",
      failures: { maxAttempts: 1, exhausted: "drop" },
      recipes: [{ consume: "B", ticks: 1, emit: [{ port: "out", produce: "A", copy: ["id"], set: { n: 1 } }] }],
    },
  },
});

// A produced event missing a field that neither copy nor set supplies.
defineCatalog({
  ...base,
  kinds: {
    M: {
      archetype: "machine", title: "", doc: "", workers: 1, outputs: { out: "front" }, unmatched: "refuse",
      failures: { maxAttempts: 1, exhausted: "drop" },
      // @ts-expect-error A needs n, which B cannot copy and set does not supply
      recipes: [{ consume: "B", ticks: 1, emit: [{ port: "out", produce: "A", copy: ["id"] }] }],
    },
  },
});

// An optional set property supplies nothing, so it cannot cover a required field.
const maybeN: { readonly n?: number } = {};
defineCatalog({
  ...base,
  kinds: {
    M: {
      archetype: "machine", title: "", doc: "", workers: 1, outputs: { out: "front" }, unmatched: "refuse",
      failures: { maxAttempts: 1, exhausted: "drop" },
      // @ts-expect-error set may leave out n, which A needs
      recipes: [{ consume: "B", ticks: 1, emit: [{ port: "out", produce: "A", copy: ["id"], set: maybeN }] }],
    },
  },
});

// A business key naming a field the event does not have.
defineCatalog({
  belt: base.belt,
  // @ts-expect-error B has no field orderId
  events: { B: { doc: "", fields: { id: "string" }, key: ["orderId"] } },
  kinds: {},
});

// Source payload of the wrong type.
defineCatalog({
  ...base,
  kinds: {
    S: {
      archetype: "source", title: "", doc: "", whenBlocked: "wait",
      // @ts-expect-error n must be a number
      emits: [{ type: "A", every: 1, payloads: [{ values: { id: { seq: "a-" }, n: "x" } }] }],
    },
  },
});

// ---------- scenarios ----------

import { definePack } from "@event-factory/engine/author";

const catalog = defineCatalog({
  ...base,
  kinds: {
    Src: { archetype: "source", title: "", doc: "", whenBlocked: "wait", emits: [{ type: "B", every: 1, payloads: [{ values: { id: "x" } }] }] },
    Out: { archetype: "sink", title: "", doc: "", ticksPerEvent: 1, role: { kind: "external", dedupe: "none" } },
    Dlq: { archetype: "sink", title: "", doc: "", ticksPerEvent: 1, role: { kind: "deadLetter" } },
  },
});

const level = {
  id: "l", title: "", brief: "", seed: 1, maxTicks: 10,
  map: [".S.O."], legend: { S: { kind: "Src", facing: "east" }, O: { kind: "Out", facing: "east" } },
  unlocked: ["belt"], goals: [{ deliver: 1, at: "Out" }],
  solution: { map: ["..>.."], legend: {} },
} as const;

definePack({ id: "p", title: "", doc: "", catalog, scenarios: [level] });

// @ts-expect-error a goal must name a sink kind
definePack({ id: "p", title: "", doc: "", catalog, scenarios: [{ ...level, goals: [{ deliver: 1, at: "Src" }] }] });

// @ts-expect-error a goal must name an external sink, not a dead-letter sink
definePack({ id: "p", title: "", doc: "", catalog, scenarios: [{ ...level, goals: [{ deliver: 1, at: "Dlq" }] }] });

// @ts-expect-error inOrder watches an external sink, not a dead-letter sink
definePack({ id: "p", title: "", doc: "", catalog, scenarios: [{ ...level, constraints: [{ kind: "inOrder", at: "Dlq" }] }] });

// @ts-expect-error unknown kind in a legend
definePack({ id: "p", title: "", doc: "", catalog, scenarios: [{ ...level, legend: { S: { kind: "Nope", facing: "east" } } }] });

// @ts-expect-error unknown event type in a goal
definePack({ id: "p", title: "", doc: "", catalog, scenarios: [{ ...level, goals: [{ deliver: 1, type: "C" }] }] });

// @ts-expect-error a hint cannot wait for the run's own records
definePack({ id: "p", title: "", doc: "", catalog, scenarios: [{ ...level, hints: [{ text: "", when: { on: "finished" } }] }] });

// @ts-expect-error a pack needs at least one level
definePack({ id: "p", title: "", doc: "", catalog, scenarios: [] });

// ---------- loader schema ----------

import type { AnyCatalog, PackDecl } from "@event-factory/engine/author";
import type { PackSource } from "../src/pack/load.js";

// Every pack the authoring types accept decodes structurally.
type Assert<T extends true> = T;
export type PackDeclDecodes = Assert<PackDecl<AnyCatalog> extends PackSource ? true : false>;

// A range predicate needs at least one bound; either bound alone, or both, is fine.
defineCatalog({
  ...base,
  kinds: {
    M: {
      archetype: "machine", title: "", doc: "", workers: 1, outputs: { out: "front" }, unmatched: "refuse",
      failures: { maxAttempts: 1, exhausted: "drop" },
      recipes: [
        { consume: "A", where: { field: "n", above: 1 }, ticks: 1, emit: [{ forward: "out" }] },
        { consume: "A", where: { field: "n", below: 1 }, ticks: 1, emit: [{ forward: "out" }] },
        { consume: "A", where: { field: "n", above: 1, below: 9 }, ticks: 1, emit: [{ forward: "out" }] },
        {
          consume: "A",
          // @ts-expect-error a range with neither bound matches nothing
          where: { field: "n" },
          ticks: 1,
          emit: [{ forward: "out" }],
        },
      ],
    },
  },
});
