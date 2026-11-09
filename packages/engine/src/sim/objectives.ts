// Objectives are a fold over telemetry. `Metrics` is the only thing goals and
// constraints read, and only `observe` writes its counts. The UI's counters
// read the same Metrics, so the scoreboard and the win check cannot disagree.

import type { EntityId, EventId, EventTypeId, KindId, Tick } from "../ids.js";
import type { Constraint, Goal, Scenario } from "../pack/model.js";
import type { EventLog } from "./event-log.js";
import type { Outcome, Telemetry } from "./telemetry.js";

export interface Metrics {
  /** First-time deliveries by sink kind, then event type. */
  readonly delivered: ReadonlyMap<KindId, ReadonlyMap<EventTypeId, number>>;
  readonly dropped: number;
  readonly deadLettered: number;
  readonly duplicateApplied: number;
  readonly duplicateIgnored: number;
  readonly failed: number;
  readonly outOfOrder: ReadonlyMap<KindId, number>;
  /** Worst root-to-effect latency per event type, over first deliveries and applied duplicates. */
  readonly maxLatency: ReadonlyMap<EventTypeId, number>;
  /**
   * Parcel accounting, kept by the sim from its own counts rather than from
   * telemetry. Every parcel minted is live (on a belt, in an out-buffer or a
   * building), or ended: delivered (any outcome), dead-lettered, dropped, or
   * consumed by a machine that produced new events from it. A mismatch is an
   * engine bug, never a level outcome.
   */
  readonly parcels: { readonly minted: number; readonly live: number; readonly consumed: number };
}

export const emptyMetrics: Metrics = {
  delivered: new Map(),
  dropped: 0,
  deadLettered: 0,
  duplicateApplied: 0,
  duplicateIgnored: 0,
  failed: 0,
  outOfOrder: new Map(),
  maxLatency: new Map(),
  parcels: { minted: 0, live: 0, consumed: 0 },
};

/** Sum of every terminal count. `parcels.minted` equals this plus `parcels.live` after every tick. */
export function ended(metrics: Metrics): number {
  let delivered = 0;
  for (const byType of metrics.delivered.values()) for (const n of byType.values()) delivered += n;
  return delivered + metrics.duplicateApplied + metrics.duplicateIgnored + metrics.deadLettered + metrics.dropped + metrics.parcels.consumed;
}

/** Pure. Returns `metrics` itself when the record changes no count, so identity tracks change. */
export function observe(
  metrics: Metrics,
  t: Telemetry,
  lookup: { readonly log: Pick<EventLog, "get">; readonly kindOf: (entity: EntityId) => KindId },
): Metrics {
  switch (t.tag) {
    case "delivered": {
      const kind = lookup.kindOf(t.entity);
      const type = lookup.log.get(t.event).type;
      const byType = metrics.delivered.get(kind);
      return {
        ...metrics,
        delivered: new Map(metrics.delivered).set(kind, new Map(byType).set(type, (byType?.get(type) ?? 0) + 1)),
        maxLatency: withLatency(metrics.maxLatency, t, lookup.log),
      };
    }
    case "dropped":
      return { ...metrics, dropped: metrics.dropped + 1 };
    case "deadLettered":
      return { ...metrics, deadLettered: metrics.deadLettered + 1 };
    case "duplicateApplied":
      return { ...metrics, duplicateApplied: metrics.duplicateApplied + 1, maxLatency: withLatency(metrics.maxLatency, t, lookup.log) };
    case "duplicateIgnored":
      return { ...metrics, duplicateIgnored: metrics.duplicateIgnored + 1 };
    case "failed":
      return { ...metrics, failed: metrics.failed + 1 };
    case "outOfOrder": {
      const kind = lookup.kindOf(t.entity);
      return { ...metrics, outOfOrder: new Map(metrics.outOfOrder).set(kind, (metrics.outOfOrder.get(kind) ?? 0) + 1) };
    }
    default:
      return metrics;
  }
}

/** Every applied effect counts toward latency. An ignored duplicate applies nothing, so it does not. */
function withLatency(
  maxLatency: Metrics["maxLatency"],
  t: { readonly tick: Tick; readonly event: EventId },
  log: Pick<EventLog, "get">,
): Metrics["maxLatency"] {
  const event = log.get(t.event);
  const latency = t.tick - log.get(event.correlation).createdAt;
  return latency > (maxLatency.get(event.type) ?? -1) ? new Map(maxLatency).set(event.type, latency) : maxLatency;
}

export interface GoalProgress {
  readonly goal: Goal;
  readonly count: number;
  readonly met: boolean;
}

export type ConstraintState =
  | { readonly constraint: Constraint; readonly kind: "ok" }
  | { readonly constraint: Constraint; readonly kind: "violated"; readonly by: number };

export type Status =
  | { readonly kind: "running"; readonly goals: readonly GoalProgress[]; readonly constraints: readonly ConstraintState[] }
  | { readonly kind: "finished"; readonly at: Tick; readonly outcome: Outcome; readonly goals: readonly GoalProgress[]; readonly constraints: readonly ConstraintState[] };

export function goalCount(goal: Goal, metrics: Metrics): number {
  let n = 0;
  for (const [kind, byType] of metrics.delivered) {
    if (goal.at !== "anyExternal" && goal.at !== kind) continue;
    for (const [type, count] of byType) if (goal.type === "any" || goal.type === type) n += count;
  }
  return n;
}

/** The count a constraint watches, and whether it crossed its limit. */
function constraintState(constraint: Constraint, metrics: Metrics): ConstraintState {
  const over = (value: number, limit: number): ConstraintState =>
    value > limit ? { constraint, kind: "violated", by: value } : { constraint, kind: "ok" };
  switch (constraint.kind) {
    case "noLoss":
      return over(metrics.dropped, 0);
    case "noDuplicateEffects":
      return over(metrics.duplicateApplied, 0);
    case "maxDeadLettered":
      return over(metrics.deadLettered, constraint.n);
    case "maxLatency": {
      const latencies = constraint.type === "any" ? [...metrics.maxLatency.values()] : [metrics.maxLatency.get(constraint.type) ?? 0];
      return over(Math.max(0, ...latencies), constraint.ticks);
    }
    case "inOrder": {
      const counts = constraint.at === "anyExternal" ? [...metrics.outOfOrder.values()] : [metrics.outOfOrder.get(constraint.at) ?? 0];
      return over(counts.reduce((a, b) => a + b, 0), 0);
    }
  }
}

/**
 * Pure. A violated constraint loses at once, and constraints are monotone
 * counts, so that is final. A win needs every goal met and a settled
 * factory: every finite source done and no parcel live. That stops a level
 * passing before a late duplicate or drop arrives. A factory that never
 * settles (an endless source, a stuck line) is decided at maxTicks. "noLoss"
 * counts drops only: dead-lettered events are not lost, they are parked
 * where someone can look at them.
 */
export function evaluate(scenario: Scenario, metrics: Metrics, tick: Tick, settled: boolean): Status {
  const goals = scenario.goals.map((goal): GoalProgress => {
    const count = goalCount(goal, metrics);
    return { goal, count, met: count >= goal.deliver };
  });
  const constraints = scenario.constraints.map((c) => constraintState(c, metrics));
  const finish = (outcome: Outcome): Status => ({ kind: "finished", at: tick, outcome, goals, constraints });

  const violated = constraints.findIndex((c) => c.kind === "violated");
  if (violated >= 0) return finish({ kind: "lost", reason: { kind: "constraint", index: violated } });
  const met = goals.every((g) => g.met);
  if (met && settled) return finish({ kind: "won" });
  if (tick >= scenario.maxTicks) return finish(met ? { kind: "won" } : { kind: "lost", reason: { kind: "outOfTime" } });
  return { kind: "running", goals, constraints };
}
