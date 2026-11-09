import { describe, expect, it } from "vitest";
import { defineCatalog, definePack } from "../src/pack/authoring.js";
import { belt, load, nothing, play, tagged } from "./helpers.js";

describe("idempotency keys", () => {
  it("two handlers fed by one topic produce events with different keys", () => {
    const handler = (produce: "Paid" | "Shipped", out: "front" | "right") =>
      ({
        archetype: "machine",
        title: produce,
        doc: "",
        outputs: { out },
        workers: 1,
        recipes: [{ consume: "Order", ticks: 1, emit: [{ port: "out", produce, copy: ["id"] }] }],
        unmatched: "refuse",
        failures: { maxAttempts: 1, exhausted: "drop" },
      }) as const;
    const catalog = defineCatalog({
      belt,
      events: {
        Order: { doc: "", fields: { id: "string" } },
        Paid: { doc: "", fields: { id: "string" } },
        Shipped: { doc: "", fields: { id: "string" } },
      },
      kinds: {
        Shop: { archetype: "source", title: "Shop", doc: "", whenBlocked: "wait", emits: [{ type: "Order", every: 4, count: 3, payloads: [{ values: { id: { seq: "o-" } } }] }] },
        Topic: { archetype: "broker", title: "Topic", doc: "", delivery: "fanout", capacity: 4, whenFull: "block" },
        Billing: handler("Paid", "front"),
        Shipping: handler("Shipped", "right"),
        Audit: { archetype: "sink", title: "Audit", doc: "", ticksPerEvent: 1, role: { kind: "external", dedupe: "none" } },
      },
    });
    const map = [".B>>v.", ".^..v.", "STA>v.", "....K."];
    const sim = play(
      load(
        definePack({
          id: "keys",
          title: "",
          doc: "",
          catalog,
          scenarios: [
            {
              id: "fanout",
              title: "",
              brief: "",
              seed: 1,
              maxTicks: 400,
              map,
              legend: {
                S: { kind: "Shop", facing: "east" },
                T: { kind: "Topic", facing: "east" },
                A: { kind: "Billing", facing: "east" },
                B: { kind: "Shipping", facing: "north" },
                K: { kind: "Audit", facing: "south" },
              },
              unlocked: ["belt"],
              goals: [{ deliver: 6, at: "Audit" }],
              constraints: [{ kind: "noDuplicateEffects" }],
              solution: nothing(map),
            },
          ],
        }),
      ),
    );
    const produced = tagged(sim.history, "produced").map((t) => sim.log.get(t.event));
    expect(produced).toHaveLength(6);
    expect(new Set(produced.map((e) => e.idempotencyKey)).size).toBe(6);
    expect(sim.metrics.duplicateApplied).toBe(0);
    expect(sim.status.kind === "finished" && sim.status.outcome).toEqual({ kind: "won" });
  });

  it("composite business keys whose values contain the separator stay distinct", () => {
    const catalog = defineCatalog({
      belt,
      events: { Transfer: { doc: "", fields: { account: "string", operation: "string" }, key: ["account", "operation"] } },
      kinds: {
        Bank: {
          archetype: "source",
          title: "Bank",
          doc: "",
          whenBlocked: "wait",
          emits: [
            { type: "Transfer", every: 2, count: 1, payloads: [{ values: { account: "a|b", operation: "c" } }] },
            { type: "Transfer", every: 2, count: 1, payloads: [{ values: { account: "a", operation: "b|c" } }] },
          ],
        },
        Ledger: { archetype: "sink", title: "Ledger", doc: "", ticksPerEvent: 1, role: { kind: "external", dedupe: "idempotencyKey" } },
      },
    });
    const map = ["S>>K"];
    const sim = play(
      load(
        definePack({
          id: "keys",
          title: "",
          doc: "",
          catalog,
          scenarios: [
            {
              id: "composite",
              title: "",
              brief: "",
              seed: 1,
              maxTicks: 100,
              map,
              legend: { S: { kind: "Bank", facing: "east" }, K: { kind: "Ledger", facing: "east" } },
              unlocked: ["belt"],
              goals: [{ deliver: 2, at: "Ledger" }],
              solution: nothing(map),
            },
          ],
        }),
      ),
    );
    expect(sim.metrics.duplicateIgnored).toBe(0);
    expect(sim.status.kind === "finished" && sim.status.outcome).toEqual({ kind: "won" });
  });

  it("a business key value cannot equal the derived key of another event's child", () => {
    // Child is unkeyed, so its key is "Parent's key + /M.0.0". The second Parent's own value spells that out.
    const catalog = defineCatalog({
      belt,
      events: {
        Parent: { doc: "", fields: { id: "string" }, key: ["id"] },
        Child: { doc: "", fields: { id: "string" } },
      },
      kinds: {
        Shop: {
          archetype: "source",
          title: "Shop",
          doc: "",
          whenBlocked: "wait",
          emits: [
            { type: "Parent", every: 2, count: 1, payloads: [{ values: { id: "x" } }] },
            { type: "Parent", every: 2, count: 1, payloads: [{ values: { id: "x/M.0.0" } }] },
          ],
        },
        M: {
          archetype: "machine",
          title: "M",
          doc: "",
          outputs: { out: "front" },
          workers: 1,
          recipes: [
            { consume: "Parent", where: { field: "id", is: "x" }, ticks: 1, emit: [{ port: "out", produce: "Child", copy: ["id"] }] },
            { consume: "Parent", ticks: 1, emit: [{ forward: "out" }] },
          ],
          unmatched: "refuse",
          failures: { maxAttempts: 1, exhausted: "drop" },
        },
        Ledger: { archetype: "sink", title: "Ledger", doc: "", ticksPerEvent: 1, role: { kind: "external", dedupe: "idempotencyKey" } },
      },
    });
    const map = ["S>M>K"];
    const sim = play(
      load(
        definePack({
          id: "keys",
          title: "",
          doc: "",
          catalog,
          scenarios: [
            {
              id: "derived",
              title: "",
              brief: "",
              seed: 1,
              maxTicks: 100,
              map,
              legend: { S: { kind: "Shop", facing: "east" }, M: { kind: "M", facing: "east" }, K: { kind: "Ledger", facing: "east" } },
              unlocked: ["belt"],
              goals: [{ deliver: 2, at: "Ledger" }],
              solution: nothing(map),
            },
          ],
        }),
      ),
    );
    expect(sim.metrics.duplicateIgnored).toBe(0);
    expect(sim.status.kind === "finished" && sim.status.outcome).toEqual({ kind: "won" });
  });
});
