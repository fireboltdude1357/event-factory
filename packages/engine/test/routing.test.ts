import { describe, expect, it } from "vitest";
import { defineCatalog, definePack } from "../src/pack/authoring.js";
import { belt, deliveredAt, load, nothing, play } from "./helpers.js";

const catalog = defineCatalog({
  belt,
  events: { Order: { doc: "", fields: { id: "string", region: ["us", "eu"] } } },
  kinds: {
    Shop: {
      archetype: "source",
      title: "Shop",
      doc: "",
      whenBlocked: "wait",
      emits: [
        {
          type: "Order",
          every: 2,
          count: 12,
          payloads: [{ values: { id: { seq: "o-" }, region: "us" } }, { values: { id: { seq: "o-" }, region: "eu" } }],
        },
      ],
    },
    Queue: { archetype: "broker", title: "Queue", doc: "", delivery: "competing", capacity: 4, whenFull: "block" },
    Topic: { archetype: "broker", title: "Topic", doc: "", delivery: "fanout", capacity: 4, whenFull: "block" },
    Router: {
      archetype: "machine",
      title: "Router",
      doc: "",
      outputs: { eu: "left", rest: "right" },
      workers: 1,
      recipes: [
        { consume: "Order", where: { field: "region", is: "eu" }, ticks: 0, emit: [{ forward: "eu" }] },
        { consume: "Order", ticks: 0, emit: [{ forward: "rest" }] },
      ],
      unmatched: "refuse",
      failures: { maxAttempts: 1, exhausted: "drop" },
    },
    Out: { archetype: "sink", title: "Out", doc: "", ticksPerEvent: 1, role: { kind: "external", dedupe: "none" } },
  },
});

// The middle building's left side feeds the top sink and its right side the bottom one.
const split = (middle: "Queue" | "Topic" | "Router") => {
  const map = ["..>>X", "..^..", "S>M..", "..v..", "..>>Y"];
  return load(
    definePack({
      id: "routing",
      title: "",
      doc: "",
      catalog,
      scenarios: [
        {
          id: "split",
          title: "",
          brief: "",
          seed: 4,
          maxTicks: 400,
          map,
          legend: {
            S: { kind: "Shop", facing: "east" },
            M: { kind: middle, facing: "east" },
            X: { kind: "Out", facing: "east" },
            Y: { kind: "Out", facing: "east" },
          },
          unlocked: ["belt"],
          goals: [{ deliver: 1 }],
          solution: nothing(map),
        },
      ],
    }),
  );
};

describe("brokers and routers", () => {
  it("a fanout broker does not count a source's back as a consumer", () => {
    // Z is a second source whose back faces the topic's left side. Sources never pull, so only X subscribes.
    const map = ["..Z..", "S>T>X"];
    const sim = play(
      load(
        definePack({
          id: "routing",
          title: "",
          doc: "",
          catalog,
          scenarios: [
            {
              id: "source-behind",
              title: "",
              brief: "",
              seed: 4,
              maxTicks: 400,
              map,
              legend: {
                S: { kind: "Shop", facing: "east" },
                T: { kind: "Topic", facing: "east" },
                Z: { kind: "Shop", facing: "north" },
                X: { kind: "Out", facing: "east" },
              },
              unlocked: ["belt"],
              goals: [{ deliver: 1 }],
              solution: nothing(map),
            },
          ],
        }),
      ),
    );
    expect(deliveredAt(sim, 4, 1)).toHaveLength(12);
  });

  it("a competing broker gives each event to exactly one consumer", () => {
    const sim = play(split("Queue"));
    const top = deliveredAt(sim, 4, 0);
    const bottom = deliveredAt(sim, 4, 4);
    expect(top.length).toBeGreaterThan(0);
    expect(bottom.length).toBeGreaterThan(0);
    expect(top.length + bottom.length).toBe(12);
    expect(new Set([...top, ...bottom].map((e) => e.id)).size).toBe(12);
  });

  it("a fanout broker gives every event to every consumer, as the same event", () => {
    const sim = play(split("Topic"));
    const top = deliveredAt(sim, 4, 0).map((e) => e.id);
    const bottom = deliveredAt(sim, 4, 4).map((e) => e.id);
    expect(top).toHaveLength(12);
    expect(bottom).toEqual(top);
    expect(sim.metrics.duplicateApplied).toBe(0);
  });

  it("a router sends each event to the side its predicate picks", () => {
    const sim = play(split("Router"));
    const eu = deliveredAt(sim, 4, 0);
    const rest = deliveredAt(sim, 4, 4);
    expect(eu.length).toBeGreaterThan(0);
    expect(rest.length).toBeGreaterThan(0);
    expect(eu.length + rest.length).toBe(12);
    expect(eu.every((e) => e.payload.region === "eu")).toBe(true);
    expect(rest.every((e) => e.payload.region === "us")).toBe(true);
  });
});
