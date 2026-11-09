// `pnpm pack:check <pack-dir> [--scenario <id>] [--json]`
//
// Proves a pack is playable: it loads, every scenario's solution wins, and
// every counterexample (including the bare map) does not. Exit codes:
//   0  all good
//   1  a solution lost or a counterexample won
//   2  the pack failed to load (PackInvalid; every issue printed with its path)
//
// Runs in Node through tsx so the pack can be TypeScript. The same engine
// code runs here and in the browser.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Result } from "effect";
import { loadPack, PackInvalid, runScenario, type Command, type Pack, type PackIssue, type RunReport, type Scenario } from "@event-factory/engine";

export interface CheckArgs {
  readonly packDir: string;
  readonly scenario: string | null;
  readonly json: boolean;
}

export type ScenarioVerdict =
  | { readonly kind: "ok"; readonly scenario: string; readonly solution: RunReport; readonly counterexamples: readonly RunReport[] }
  | { readonly kind: "solutionLost"; readonly scenario: string; readonly report: RunReport }
  | { readonly kind: "counterexampleWon"; readonly scenario: string; readonly why: string; readonly report: RunReport };

export type CheckResult =
  | { readonly kind: "invalid"; readonly error: PackInvalid }
  | { readonly kind: "checked"; readonly verdicts: readonly ScenarioVerdict[] };

/** Imports `<packDir>/pack.ts` default export as unknown and hands it to loadPack. */
export function checkPack(args: CheckArgs): Effect.Effect<CheckResult> {
  const url = pathToFileURL(resolve(args.packDir, "pack.ts")).href;
  return Effect.tryPromise({
    try: (): Promise<unknown> => import(url),
    catch: (error) => new PackInvalid({ issues: [{ path: "pack.ts", message: `could not import ${url}: ${String(error)}` }] }),
  }).pipe(
    Effect.flatMap((mod) => loadPack(typeof mod === "object" && mod !== null && "default" in mod ? mod.default : undefined)),
    Effect.flatMap((pack) => checkLoaded(pack, args.scenario)),
    Effect.catchTag("PackInvalid", (error) => Effect.succeed<CheckResult>({ kind: "invalid", error })),
  );
}

/** Runs the selected scenarios (all when `scenario` is null) of a loaded pack. */
export function checkLoaded(pack: Pack, scenario: string | null): Effect.Effect<CheckResult, PackInvalid> {
  const scenarios = scenario === null ? pack.scenarios : pack.scenarios.filter((s) => s.id === scenario);
  if (scenarios.length === 0) {
    return Effect.fail(new PackInvalid({ issues: [{ path: "--scenario", message: `no scenario "${scenario}"; have ${pack.scenarios.map((s) => s.id).join(", ")}` }] }));
  }
  const results = scenarios.map((s) => verdict(pack, s, `scenarios[${pack.scenarios.indexOf(s)}]`));
  const [first, ...rest] = results.flatMap((r) => (Result.isFailure(r) ? [r.failure] : []));
  if (first !== undefined) return Effect.fail(new PackInvalid({ issues: [first, ...rest] }));
  return Effect.succeed<CheckResult>({ kind: "checked", verdicts: results.flatMap((r) => (Result.isSuccess(r) ? [r.success] : [])) });
}

const commandText = (command: Command): string =>
  command.kind === "place" ? `placing "${command.build.kind === "belt" ? "belt" : command.build.id}"` : `${command.kind} command`;

/**
 * loadPack validates every overlay, so the engine should accept every
 * placement. If it does not, the overlay at `path` is reported as a pack
 * error rather than crashing the check.
 */
function run(pack: Pack, scenario: Scenario, layout: RunReport["layout"], path: string): Result.Result<RunReport, PackIssue> {
  return Result.mapError(runScenario(pack, scenario, layout), ({ command, reason }) => ({
    path: `${path}.map[${command.at.y}]`,
    message: `${commandText(command)} at column ${command.at.x} was rejected after load (${reason.kind})`,
  }));
}

function verdict(pack: Pack, scenario: Scenario, path: string): Result.Result<ScenarioVerdict, PackIssue> {
  return Result.gen(function* () {
    const solution = yield* run(pack, scenario, { kind: "solution" }, `${path}.solution`);
    if (solution.status.outcome.kind !== "won") return { kind: "solutionLost", scenario: scenario.id, report: solution } as const;
    const counterexamples: { readonly why: string; readonly report: RunReport }[] = [];
    // Index 0 is the bare map pack:check adds; the pack's own counterexamples follow.
    for (const [index, c] of scenario.counterexamples.entries()) {
      counterexamples.push({ why: c.why, report: yield* run(pack, scenario, { kind: "counterexample", index }, `${path}.counterexamples[${index - 1}]`) });
    }
    const won = counterexamples.find((c) => c.report.status.outcome.kind === "won");
    if (won !== undefined) return { kind: "counterexampleWon", scenario: scenario.id, why: won.why, report: won.report } as const;
    return { kind: "ok", scenario: scenario.id, solution, counterexamples: counterexamples.map((c) => c.report) } as const;
  });
}

const goalsText = (report: RunReport): string =>
  report.status.goals
    .map((g) => `${g.count}/${g.goal.deliver} ${g.goal.type === "any" ? "events" : g.goal.type} @ ${g.goal.at === "anyExternal" ? "any sink" : g.goal.at}`)
    .join(", ");

function lossText(report: RunReport): string {
  const { outcome, constraints } = report.status;
  if (outcome.kind === "won") return "won";
  if (outcome.reason.kind === "outOfTime") return `out of time at tick ${report.ticks} (${goalsText(report)})`;
  const state = constraints[outcome.reason.index];
  if (state === undefined) return "constraint violated";
  const c = state.constraint;
  const name = c.kind === "maxDeadLettered" ? `maxDeadLettered(${c.n})` : c.kind === "maxLatency" ? `maxLatency(${c.ticks})` : c.kind;
  return `constraint ${name} violated at tick ${report.ticks}${state.kind === "violated" ? ` (${state.by})` : ""}`;
}

const tailLines = (report: RunReport): string[] => ["    last telemetry:", ...report.tailText.slice(-10).map((line) => `    ${line}`)];

const jsonReplacer = (_key: string, value: unknown): unknown =>
  value instanceof Map ? Object.fromEntries(value) : value instanceof Set ? [...value] : value;

/**
 * Human output. One line per scenario, then details for failures:
 *   ✓ hello-event          won at tick 88 (12/12 PaymentCaptured @ Ledger); bare map lost
 *   ✗ when-payments-fail   solution lost: constraint maxDeadLettered(2) violated at tick 640 (3)
 *       last telemetry:
 *       t=598 failed            PaymentService@5,1  OrderPlaced big-1 attempt 4 beforeEffect
 * With --json, prints CheckResult as JSON so an agent can parse it.
 */
export function formatResult(result: CheckResult, json: boolean): { readonly text: string; readonly exitCode: 0 | 1 | 2 } {
  const exitCode = result.kind === "invalid" ? 2 : result.verdicts.every((v) => v.kind === "ok") ? 0 : 1;
  if (json) {
    const body = result.kind === "invalid" ? { kind: "invalid", issues: result.error.issues } : result;
    return { text: JSON.stringify(body, jsonReplacer, 2), exitCode };
  }
  if (result.kind === "invalid") {
    const issues = result.error.issues;
    return { text: [`✗ pack invalid (${issues.length} issue${issues.length === 1 ? "" : "s"})`, ...issues.map((i) => `  ${i.path}: ${i.message}`)].join("\n"), exitCode };
  }

  const width = Math.max(...result.verdicts.map((v) => v.scenario.length)) + 2;
  const lines = result.verdicts.flatMap((v) => {
    const id = v.scenario.padEnd(width);
    switch (v.kind) {
      case "ok": {
        const extra = v.counterexamples.length - 1;
        const counter = extra === 0 ? "bare map lost" : `bare map and ${extra} counterexample${extra === 1 ? "" : "s"} lost`;
        return [`✓ ${id} won at tick ${v.solution.ticks} (${goalsText(v.solution)}); ${counter}`];
      }
      case "solutionLost":
        return [`✗ ${id} solution lost: ${lossText(v.report)}`, ...tailLines(v.report)];
      case "counterexampleWon":
        return [`✗ ${id} counterexample won at tick ${v.report.ticks} (${goalsText(v.report)}), but it should lose: ${v.why}`, ...tailLines(v.report)];
    }
  });
  return { text: lines.join("\n"), exitCode };
}
