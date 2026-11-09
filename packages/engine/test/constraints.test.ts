import { describe, expect, it } from "vitest";
import { defineCatalog, definePack } from "../src/pack/authoring.js";
import { belt, load, nothing, play, tagged } from "./helpers.js";

describe("maxLatency", () => {
  // Every event is published twice, and the sink takes 20 ticks per event, so the copy is applied about 20 ticks after the original.
  const catalog = defineCatalog({
    belt,
    events: { Order: { doc: "", fields: { id: "string" } } },
    kinds: {
      Shop: { archetype: "source", title: "Shop", doc: "", whenBlocked: "wait", emits: [{ type: "Order", every: 1, count: 1, duplicateChance: 1, payloads: [{ values: { id: { seq: "o-" } } }] }] },
      Insert: { archetype: "sink", title: "Insert", doc: "", ticksPerEvent: 20, role: { kind: "external", dedupe: "none" } },
      Upsert: { archetype: "sink", title: "Upsert", doc: "", ticksPerEvent: 20, role: { kind: "external", dedupe: "idempotencyKey" } },
    },
  });
  const map = ["S>K"];
  const run = (sink: "Insert" | "Upsert") =>
    play(
      load(
        definePack({
          id: "latency",
          title: "",
          doc: "",
          catalog,
          scenarios: [
            {
              id: "slow-sink",
              title: "",
              brief: "",
              seed: 1,
              maxTicks: 200,
              map,
              legend: { S: { kind: "Shop", facing: "east" }, K: { kind: sink, facing: "east" } },
              unlocked: ["belt"],
              goals: [{ deliver: 1, at: sink }],
              constraints: [{ kind: "maxLatency", ticks: 25 }],
              solution: nothing(map),
            },
          ],
        }),
      ),
    );

  it("a duplicate applied after the limit loses the level", () => {
    const sim = run("Insert");
    const [first] = tagged(sim.history, "delivered");
    const [duplicate] = tagged(sim.history, "duplicateApplied");
    expect(first !== undefined && first.tick <= 25).toBe(true);
    expect(duplicate !== undefined && duplicate.tick > 25).toBe(true);
    expect(sim.status.kind === "finished" && sim.status.outcome).toEqual({ kind: "lost", reason: { kind: "constraint", index: 0 } });
  });

  it("a duplicate the sink ignores applies nothing, so it does not count", () => {
    const sim = run("Upsert");
    const [duplicate] = tagged(sim.history, "duplicateIgnored");
    expect(duplicate !== undefined && duplicate.tick > 25).toBe(true);
    expect(sim.status.kind === "finished" && sim.status.outcome).toEqual({ kind: "won" });
  });
});
