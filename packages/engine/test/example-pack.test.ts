import { Result } from "effect";
import { describe, expect, it } from "vitest";
import examplePack from "../../../packs/order-processing/pack.js";
import { createSim, runScenario, type Command, type Pack, type Scenario } from "../src/index.js";
import { KindId, ScenarioId } from "../src/ids.js";
import { ended } from "../src/sim/objectives.js";
import { finish, load, tagged } from "./helpers.js";

const pack: Pack = load(examplePack);
const scenario = (id: string): Scenario => {
  const found = pack.scenarios.find((s) => s.id === ScenarioId(id));
  if (found === undefined) throw new Error(`no scenario ${id}`);
  return found;
};

const solutionCommands = (s: Scenario): Command[] => s.solution.map((p) => ({ kind: "place", at: p.at, facing: p.facing, build: p.build }));

/** Which (event key, attempt) pairs failed, and how. The thing that must not depend on layout. */
function failures(s: Scenario, commands: readonly Command[]): string[] {
  const sim = createSim(pack, s);
  for (const c of commands) expect(Result.isSuccess(sim.apply(c))).toBe(true);
  finish(sim);
  return tagged(sim.history, "failed")
    .map((t) => `${sim.log.get(t.event).idempotencyKey}:${t.attempt}:${t.timing}`)
    .sort();
}

describe("example pack", () => {
  it("runs the same pack, scenario and commands to identical telemetry", () => {
    const s = scenario("when-payments-fail");
    const a = createSim(pack, s);
    const b = createSim(pack, s);
    for (const c of solutionCommands(s)) {
      a.apply(c);
      b.apply(c);
    }
    expect(finish(a).history.length).toBeGreaterThan(100);
    expect(a.history).toEqual(finish(b).history);
  });

  it("decides faults by event identity, not layout", () => {
    const s = scenario("when-payments-fail");
    const base = failures(s, solutionCommands(s));
    expect(base.length).toBeGreaterThan(0);

    const unrelatedBelt: Command = { kind: "place", at: { x: 0, y: 3 }, facing: "east", build: { kind: "belt" } };
    expect(failures(s, [unrelatedBelt, ...solutionCommands(s)])).toEqual(base);

    // PaymentService two tiles further east: every event reaches it at a different tick.
    const belt = (x: number, y: number, facing: "east" | "south"): Command => ({ kind: "place", at: { x, y }, facing, build: { kind: "belt" } });
    const moved: Command[] = [
      ...[2, 3, 4, 5, 6].map((x) => belt(x, 1, "east")),
      { kind: "place", at: { x: 7, y: 1 }, facing: "east", build: { kind: "building", id: KindId("PaymentService") } },
      belt(8, 1, "east"),
      belt(9, 1, "east"),
      belt(7, 2, "south"),
      { kind: "place", at: { x: 7, y: 3 }, facing: "south", build: { kind: "building", id: KindId("DeadLetterQueue") } },
    ];
    expect(failures(s, moved)).toEqual(base);
  });

  it("conserves parcels on every run of every level", () => {
    for (const s of pack.scenarios) {
      const layouts = [{ kind: "solution" as const }, ...s.counterexamples.map((_, index) => ({ kind: "counterexample" as const, index }))];
      for (const layout of layouts) {
        const { metrics } = Result.getOrThrow(runScenario(pack, s, layout));
        expect(metrics.parcels.minted).toBe(metrics.parcels.live + ended(metrics));
      }
    }
  });
});
