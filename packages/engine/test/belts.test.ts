import { describe, expect, it } from "vitest";
import { defineCatalog, definePack } from "../src/pack/authoring.js";
import { createSim } from "../src/index.js";
import { ParcelId, ScenarioId } from "../src/ids.js";
import { belt, deliveredAt, load, nothing, play, tagged } from "./helpers.js";

const catalog = defineCatalog({
  belt,
  events: { Ping: { doc: "", fields: { id: "string" } } },
  kinds: {
    Fast: { archetype: "source", title: "Fast", doc: "", whenBlocked: "wait", emits: [{ type: "Ping", every: 1, count: 6, payloads: [{ values: { id: { seq: "a-" } } }] }] },
    Other: { archetype: "source", title: "Other", doc: "", whenBlocked: "wait", emits: [{ type: "Ping", every: 1, count: 6, payloads: [{ values: { id: { seq: "b-" } } }] }] },
    Lossy: { archetype: "source", title: "Lossy", doc: "", whenBlocked: "drop", emits: [{ type: "Ping", every: 1, count: 6, payloads: [{ values: { id: { seq: "c-" } } }] }] },
    Out: { archetype: "sink", title: "Out", doc: "", ticksPerEvent: 1, role: { kind: "external", dedupe: "none" } },
    Slow: { archetype: "sink", title: "Slow", doc: "", ticksPerEvent: 10, role: { kind: "external", dedupe: "none" } },
  },
});

const line = (source: "Fast" | "Lossy", sink: "Out" | "Slow") => {
  const map = [".S>>>>K."];
  return load(
    definePack({
      id: "belts",
      title: "",
      doc: "",
      catalog,
      scenarios: [
        {
          id: "line",
          title: "",
          brief: "",
          seed: 1,
          maxTicks: 300,
          map,
          legend: { S: { kind: source, facing: "east" }, K: { kind: sink, facing: "east" } },
          unlocked: ["belt"],
          goals: [{ deliver: 6, type: "Ping", at: sink }],
          constraints: [{ kind: "noLoss" }],
          solution: nothing(map),
        },
      ],
    }),
  );
};

describe("belts", () => {
  it("delivers every event down a straight line, one tile per ticksPerTile", () => {
    const sim = createSim(line("Fast", "Out"), ScenarioId("line"));
    const entered = new Map<number, number>();
    while (sim.status.kind === "running") {
      sim.step();
      const where = sim.locate(ParcelId(0));
      if (where?.kind === "belt" && !entered.has(where.cell)) entered.set(where.cell, sim.tick);
    }
    expect(sim.status.kind === "finished" && sim.status.outcome).toEqual({ kind: "won" });
    expect(deliveredAt(sim, 6, 0)).toHaveLength(6);
    const ticks = [...entered.values()];
    expect(ticks.slice(1).map((t, i) => t - (ticks[i] ?? 0))).toEqual([2, 2, 2]);
  });

  it("keeps a full line moving: deliveries arrive every ticksPerTile with no gaps", () => {
    const sim = play(line("Fast", "Out"));
    const ticks = tagged(sim.history, "delivered").map((t) => t.tick);
    expect(ticks.slice(1).map((t, i) => t - (ticks[i] ?? 0))).toEqual([2, 2, 2, 2, 2]);
  });

  it("backpressure with whenBlocked wait stalls the source and loses nothing", () => {
    const sim = play(line("Fast", "Slow"));
    expect(tagged(sim.history, "stalled").some((t) => sim.labelOf(t.entity).startsWith("Fast"))).toBe(true);
    expect(sim.metrics.dropped).toBe(0);
    expect(sim.status.kind === "finished" && sim.status.outcome).toEqual({ kind: "won" });
  });

  it("backpressure with whenBlocked drop loses events and fails noLoss", () => {
    const sim = play(line("Lossy", "Slow"));
    const drops = tagged(sim.history, "dropped");
    expect(drops.length).toBeGreaterThan(0);
    expect(drops.every((d) => d.reason === "sourceBlocked")).toBe(true);
    expect(sim.status.kind === "finished" && sim.status.outcome).toEqual({ kind: "lost", reason: { kind: "constraint", index: 0 } });
  });

  it("a merge alternates between its two feeders", () => {
    const map = ["..A....", "B>>>>>K"];
    const pack = load(
      definePack({
        id: "merge",
        title: "",
        doc: "",
        catalog,
        scenarios: [
          {
            id: "merge",
            title: "",
            brief: "",
            seed: 1,
            maxTicks: 300,
            map,
            legend: { A: { kind: "Fast", facing: "south" }, B: { kind: "Other", facing: "east" }, K: { kind: "Out", facing: "east" } },
            unlocked: ["belt"],
            goals: [{ deliver: 12 }],
            solution: nothing(map),
          },
        ],
      }),
    );
    const sim = play(pack);
    const from = deliveredAt(sim, 6, 1).map((e) => String(e.payload.id).charAt(0));
    expect(from).toHaveLength(12);
    expect(from.join("")).toMatch(/^(ab|ba){6}$/);
  });
});
