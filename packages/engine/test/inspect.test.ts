import { describe, expect, it } from "vitest";
import { createSim } from "../src/index.js";
import { KindId } from "../src/ids.js";
import { inspect } from "../src/inspect.js";
import { belt, load, nothing } from "./helpers.js";

const publishes = (duplicateChance: number) => {
  const map = ["S>K"];
  const pack = load({
    id: "inspect",
    title: "",
    doc: "",
    catalog: {
      belt,
      events: { Order: { doc: "", fields: { id: "string" } } },
      kinds: {
        Shop: { archetype: "source", title: "", doc: "", whenBlocked: "wait", emits: [{ type: "Order", every: 2, duplicateChance, payloads: [{ values: { id: "o" } }] }] },
        K: { archetype: "sink", title: "", doc: "", ticksPerEvent: 1, role: { kind: "external", dedupe: "none" } },
      },
    },
    scenarios: [
      {
        id: "l",
        title: "",
        brief: "",
        seed: 1,
        maxTicks: 10,
        map,
        legend: { S: { kind: "Shop", facing: "east" }, K: { kind: "K", facing: "east" } },
        unlocked: ["belt"],
        goals: [{ deliver: 1 }],
        solution: nothing(map),
      },
    ],
  });
  const scenario = pack.scenarios[0];
  if (scenario === undefined) throw new Error("no scenario");
  const fact = inspect(createSim(pack, scenario), { kind: "kind", id: KindId("Shop") })?.facts.find((f) => f.kind === "text" && f.label === "Publishes");
  return fact?.kind === "text" ? fact.value : null;
};

describe("inspect", () => {
  it("never rounds a duplicate chance to 0% or 100% when it is neither", () => {
    expect(publishes(0)).toBe("Order every 2 ticks");
    expect(publishes(0.004)).toBe("Order every 2 ticks, <1% sent twice");
    expect(publishes(0.25)).toBe("Order every 2 ticks, 25% sent twice");
    expect(publishes(0.996)).toBe("Order every 2 ticks, >99% sent twice");
    expect(publishes(1)).toBe("Order every 2 ticks, 100% sent twice");
  });
});
