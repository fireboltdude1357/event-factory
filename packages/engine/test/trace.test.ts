import { describe, expect, it } from "vitest";
import examplePack from "../../../packs/order-processing/pack.js";
import { createSim } from "../src/index.js";
import { EventId } from "../src/ids.js";
import type { EventRecord } from "../src/sim/event-log.js";
import { inspect } from "../src/inspect.js";
import { defineCatalog, definePack } from "../src/pack/authoring.js";
import { trace } from "../src/sim/sim.js";
import { belt, finish, load, nothing, play, tagged } from "./helpers.js";

const handler = (consume: "Order" | "Paid" | "Shipped", produce: "Paid" | "Booked" | "Shipped" | "Packed") =>
  ({
    archetype: "machine",
    title: produce,
    doc: "",
    outputs: { out: "front" },
    workers: 1,
    recipes: [{ consume, ticks: 1, emit: [{ port: "out", produce, copy: ["id"] }] }],
    unmatched: "refuse",
    failures: { maxAttempts: 1, exhausted: "drop" },
  }) as const;

// One order fans out to two branches, and each branch handles it twice: a causation tree two levels deep.
const catalog = defineCatalog({
  belt,
  events: {
    Order: { doc: "", fields: { id: "string" } },
    Paid: { doc: "", fields: { id: "string" } },
    Booked: { doc: "", fields: { id: "string" } },
    Shipped: { doc: "", fields: { id: "string" } },
    Packed: { doc: "", fields: { id: "string" } },
  },
  kinds: {
    Shop: { archetype: "source", title: "Shop", doc: "", whenBlocked: "wait", emits: [{ type: "Order", every: 4, count: 1, payloads: [{ values: { id: { seq: "o-" } } }] }] },
    Topic: { archetype: "broker", title: "Topic", doc: "", delivery: "fanout", capacity: 4, whenFull: "block" },
    Billing: handler("Order", "Paid"),
    Booker: handler("Paid", "Booked"),
    Shipping: handler("Order", "Shipped"),
    Packer: handler("Shipped", "Packed"),
    Audit: { archetype: "sink", title: "Audit", doc: "", ticksPerEvent: 1, role: { kind: "external", dedupe: "none" } },
  },
});

const map = [".....", "STACK", ".B...", ".D...", ".L..."];
const sim = play(
  load(
    definePack({
      id: "trace",
      title: "",
      doc: "",
      catalog,
      scenarios: [
        {
          id: "tree",
          title: "",
          brief: "",
          seed: 1,
          maxTicks: 200,
          map,
          legend: {
            S: { kind: "Shop", facing: "east" },
            T: { kind: "Topic", facing: "east" },
            A: { kind: "Billing", facing: "east" },
            C: { kind: "Booker", facing: "east" },
            K: { kind: "Audit", facing: "east" },
            B: { kind: "Shipping", facing: "south" },
            D: { kind: "Packer", facing: "south" },
            L: { kind: "Audit", facing: "south" },
          },
          unlocked: ["belt"],
          goals: [{ deliver: 2 }],
          solution: nothing(map),
        },
      ],
    }),
  ),
);

describe("trace", () => {
  const root = tagged(sim.history, "emitted")[0];
  if (root === undefined) throw new Error("no root event");

  it("lists each descendant right after its own parent", () => {
    const { descendants } = trace(sim, root.event);
    expect(descendants.map((d) => d.depth)).toEqual([1, 2, 1, 2]);
    descendants.forEach((d, i) => {
      if (d.depth === 1) return expect(d.event.origin).toMatchObject({ kind: "caused", by: root.event });
      expect(d.event.origin).toMatchObject({ kind: "caused", by: descendants[i - 1]?.event.id });
    });
  });

  it("lists a duplicate once, in the trace's siblings, not again as an event fact", () => {
    const pack = load(examplePack);
    const failing = pack.scenarios.find((s) => s.id === "when-payments-fail");
    if (failing === undefined) throw new Error("no when-payments-fail level");
    const run = createSim(pack, failing);
    for (const placement of failing.solution) run.apply({ kind: "place", at: placement.at, facing: placement.facing, build: placement.build });
    finish(run);
    const duplicated = tagged(run.history, "duplicateIgnored")[0];
    if (duplicated === undefined) throw new Error("the level produced no duplicate");
    const inspection = inspect(run, { kind: "event", event: duplicated.event });
    const siblings = inspection?.trace?.siblings ?? [];
    expect(siblings.length).toBeGreaterThan(0);
    const linked = (inspection?.facts ?? []).flatMap((f) => (f.kind === "event" ? [f.event] : []));
    expect(linked.filter((id) => siblings.includes(id))).toEqual([]);
  });

  it("walks a causation chain deeper than the call stack", () => {
    const sample = trace(sim, root.event).descendants[0]?.event;
    if (sample === undefined || sample.origin.kind !== "caused") throw new Error("no caused event to copy");
    const origin = sample.origin;
    const length = 100_000;
    const chain: EventRecord[] = Array.from({ length }, (_, i) => ({
      ...sample,
      id: EventId(i),
      origin: i === 0 ? sim.log.get(root.event).origin : { ...origin, by: EventId(i - 1) },
    }));
    const log = {
      ...sim.log,
      get: (id: EventId) => chain[id] ?? sample,
      children: (id: EventId) => (id + 1 < length ? [EventId(id + 1)] : []),
      withKey: () => [],
    };
    expect(trace({ log, history: [] }, EventId(0)).descendants).toHaveLength(length - 1);
  });
});
