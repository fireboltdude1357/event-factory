import { describe, expect, it } from "vitest";
import { defineCatalog, definePack, type ScenarioDecl } from "../src/pack/authoring.js";
import { belt, deliveredAt, load, nothing, play, tagged } from "./helpers.js";

const catalog = defineCatalog({
  belt,
  events: {
    Charge: { doc: "", fields: { id: "string", poison: "boolean" } },
    Charged: { doc: "", fields: { id: "string" }, key: ["id"] },
  },
  kinds: {
    Shop: {
      archetype: "source",
      title: "Shop",
      doc: "",
      whenBlocked: "wait",
      emits: [
        { type: "Charge", every: 3, count: 10, payloads: [{ values: { id: { seq: "c-" }, poison: false } }] },
        { type: "Charge", every: 50, count: 1, payloads: [{ values: { id: { seq: "poison-" }, poison: true } }] },
      ],
    },
    Payments: {
      archetype: "machine",
      title: "Payments",
      doc: "",
      outputs: { out: "front", dlq: "right" },
      workers: 1,
      recipes: [{ consume: "Charge", ticks: 2, emit: [{ port: "out", produce: "Charged", copy: ["id"] }] }],
      unmatched: "refuse",
      failures: { maxAttempts: 6, backoff: { fixed: 1 }, exhausted: { route: "dlq" } },
    },
    Ledger: { archetype: "sink", title: "Ledger", doc: "", accepts: ["Charged"], ticksPerEvent: 1, role: { kind: "external", dedupe: "idempotencyKey" } },
    Warehouse: { archetype: "sink", title: "Warehouse", doc: "", accepts: ["Charged"], ticksPerEvent: 1, role: { kind: "external", dedupe: "none" } },
    DLQ: { archetype: "sink", title: "DLQ", doc: "", ticksPerEvent: 1, role: { kind: "deadLetter" } },
  },
});

type Level = ScenarioDecl<typeof catalog>;

const withDlq = ["..........", ".S>>P>>>K.", "....v.....", "....D....."];
const withoutDlq = ["..........", ".S>>P>>>K.", "..........", ".........."];

const level = (map: readonly string[], sink: "Ledger" | "Warehouse", faults: Level["faults"]) =>
  load(
    definePack({
      id: "failures",
      title: "",
      doc: "",
      catalog,
      scenarios: [
        {
          id: "level",
          title: "",
          brief: "",
          seed: 7,
          maxTicks: 600,
          map,
          legend: {
            S: { kind: "Shop", facing: "east" },
            P: { kind: "Payments", facing: "east" },
            K: { kind: sink, facing: "east" },
            D: { kind: "DLQ", facing: "south" },
          },
          unlocked: ["belt"],
          ...(faults === undefined ? {} : { faults }),
          goals: [{ deliver: 10, type: "Charged", at: sink }],
          constraints: [{ kind: "noLoss" }, { kind: "noDuplicateEffects" }],
          solution: nothing(map),
        },
      ],
    }),
  );

const poison: NonNullable<Level["faults"]>[number] = { kinds: ["Payments"], event: "Charge", where: { field: "poison", is: true }, timing: "beforeEffect" };

describe("retries and dead letters", () => {
  it("a beforeEffect fault retries and the event still gets through", () => {
    const sim = play(level(withDlq, "Ledger", [poison, { kinds: ["Payments"], chance: 0.3, timing: "beforeEffect" }]));
    const normal = tagged(sim.history, "failed").filter((t) => sim.log.get(t.event).payload.poison === false);
    expect(normal.length).toBeGreaterThan(0);
    expect(tagged(sim.history, "retrying").length).toBeGreaterThan(0);
    expect(deliveredAt(sim, 8, 1)).toHaveLength(10);
    expect(sim.status.kind === "finished" && sim.status.outcome).toEqual({ kind: "won" });
  });

  it("a poison event exhausts its retries and parks on the dead-letter side", () => {
    const sim = play(level(withDlq, "Ledger", [poison]));
    const parked = tagged(sim.history, "deadLettered").map((t) => sim.log.get(t.event).payload.id);
    expect(parked).toEqual(["poison-1"]);
    expect(tagged(sim.history, "failed").filter((t) => sim.log.get(t.event).payload.id === "poison-1")).toHaveLength(6);
    expect(sim.metrics.dropped).toBe(0);
  });

  it("without a linked dead-letter side the machine stalls and the line stops", () => {
    const sim = play(level(withoutDlq, "Ledger", [poison]));
    expect(tagged(sim.history, "stalled").some((t) => sim.labelOf(t.entity).startsWith("Payments"))).toBe(true);
    expect(deliveredAt(sim, 8, 1).length).toBeLessThan(10);
    expect(sim.status.kind === "finished" && sim.status.outcome).toEqual({ kind: "lost", reason: { kind: "outOfTime" } });
  });
});

describe("at-least-once and idempotency", () => {
  const afterEffect: Level["faults"] = [{ kinds: ["Payments"], chance: 0.4, timing: "afterEffect" }];
  const shop = ["..........", ".S>>P>>>K.", "....v.....", "....D....."];

  it("an afterEffect fault produces two events with one idempotency key", () => {
    const sim = play(level(shop, "Ledger", afterEffect));
    const produced = tagged(sim.history, "produced").map((t) => sim.log.get(t.event));
    const twice = produced.map((e) => produced.filter((other) => other.idempotencyKey === e.idempotencyKey)).find((same) => same.length >= 2);
    expect(twice).toBeDefined();
    expect(new Set(twice?.map((e) => e.id)).size).toBe(twice?.length);
  });

  it("an idempotent sink ignores the duplicate", () => {
    const sim = play(level(shop, "Ledger", afterEffect));
    expect(sim.metrics.duplicateIgnored).toBeGreaterThan(0);
    expect(sim.metrics.duplicateApplied).toBe(0);
    expect(sim.status.kind === "finished" && sim.status.outcome).toEqual({ kind: "won" });
  });

  it("a sink without dedupe applies the duplicate and fails noDuplicateEffects", () => {
    const sim = play(level(shop, "Warehouse", afterEffect));
    expect(sim.metrics.duplicateApplied).toBeGreaterThan(0);
    expect(sim.status.kind === "finished" && sim.status.outcome).toEqual({ kind: "lost", reason: { kind: "constraint", index: 1 } });
  });
});
