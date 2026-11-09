import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { loadPack } from "@event-factory/engine";
import { checkLoaded, formatResult } from "../src/pack-check.js";

const pack = Effect.runSync(
  loadPack({
    id: "p",
    title: "",
    doc: "",
    catalog: {
      belt: { title: "belt", doc: "", ticksPerTile: 1 },
      events: { E: { doc: "", fields: { id: "string" } } },
      kinds: {
        S: { archetype: "source", title: "S", doc: "", whenBlocked: "wait", emits: [{ type: "E", every: 1, count: 1, payloads: [{ values: { id: "e" } }] }] },
        K: { archetype: "sink", title: "K", doc: "", ticksPerEvent: 1, role: { kind: "external", dedupe: "none" } },
      },
    },
    scenarios: [
      {
        id: "level",
        title: "",
        brief: "",
        seed: 1,
        maxTicks: 50,
        map: ["S..."],
        legend: { S: { kind: "S", facing: "east" } },
        unlocked: ["belt", "K"],
        budget: { K: 1 },
        goals: [{ deliver: 1 }],
        solution: { map: [".>K."], legend: { K: { kind: "K", facing: "east" } } },
      },
    ],
  }),
);

describe("pack:check", () => {
  it("reports a placement the engine rejects after load as a pack error with a path", () => {
    // Stands in for any loader gap: the engine now refuses a placement the loader accepted.
    const tampered = { ...pack, scenarios: pack.scenarios.map((s) => ({ ...s, budget: new Map([...s.budget].map(([kind]) => [kind, 0])) })) };
    const result = Effect.runSync(Effect.result(checkLoaded(tampered, null)));
    const { text, exitCode } = formatResult(Result.isSuccess(result) ? result.success : { kind: "invalid", error: result.failure }, false);
    expect(exitCode).toBe(2);
    expect(text).toContain('scenarios[0].solution.map[0]: placing "K" at column 2 was rejected after load (overBudget)');
  });
});
