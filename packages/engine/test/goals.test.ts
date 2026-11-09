import { describe, expect, it } from "vitest";
import { belt, load, nothing, play } from "./helpers.js";

/** A source of `type` feeding an external sink, with one typed goal. Plain data, like a JSON pack. */
const oneLine = (type: string, goalType: string) => {
  const map = ["S>K"];
  return {
    id: "goals",
    title: "",
    doc: "",
    catalog: {
      belt,
      events: { [type]: { doc: "", fields: { id: "string" } } },
      kinds: {
        Shop: { archetype: "source", title: "", doc: "", whenBlocked: "wait", emits: [{ type, every: 1, count: 2, payloads: [{ values: { id: { seq: "o-" } } }] }] },
        Sink: { archetype: "sink", title: "", doc: "", ticksPerEvent: 1, role: { kind: "external", dedupe: "none" } },
      },
    },
    scenarios: [
      {
        id: "l",
        title: "",
        brief: "",
        seed: 1,
        maxTicks: 50,
        map,
        legend: { S: { kind: "Shop", facing: "east" }, K: { kind: "Sink", facing: "east" } },
        unlocked: ["belt"],
        goals: [{ deliver: 2, type: goalType }],
        solution: nothing(map),
      },
    ],
  };
};

describe("goals", () => {
  it("count an event type whose name contains a bar", () => {
    const sim = play(load(oneLine("orders|placed", "orders|placed")));
    expect(sim.status.kind === "finished" && sim.status.outcome).toEqual({ kind: "won" });
  });
});
