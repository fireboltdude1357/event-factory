// The headless simulation. One Sim owns one run: its layout, entity states,
// belts, out-buffers, event log, metrics, and command log. Nothing outside
// this file mutates them. Node tests, the CLI, and the browser session all
// drive a Sim the same way: apply commands, step ticks, read results.

import { Result } from "effect";
import { KindId, ParcelId, Tick, type EntityId, type EventId, type ScenarioId } from "../ids.js";
import type { Kind, OutSide, Pack, Placement, Scenario, Side } from "../pack/model.js";
import { behaviours, type Behaviour, type EntityState, type Intent, type TickContext } from "./archetypes/index.js";
import { createEventLog, type EventLog, type EventRecord, type Parcel } from "./event-log.js";
import { emptyBelt, moveParcels, type BeltSlot, type OutBuffers } from "./movement.js";
import { emptyMetrics, evaluate, observe, type Metrics, type Status } from "./objectives.js";
import { roll } from "./rng.js";
import type { DropReason, Telemetry } from "./telemetry.js";
import { applyCommand, cellOf, CommandRejected, initialLayout, type Command, type Layout } from "./world.js";

/** Read-only view of the run. Everything the session, inspector, and tests read. */
export interface SimView {
  readonly pack: Pack;
  readonly scenario: Scenario;
  readonly tick: Tick;
  readonly layout: Layout;
  readonly entities: ReadonlyMap<EntityId, EntityState>;
  readonly belts: readonly BeltSlot[];
  readonly out: OutBuffers;
  readonly log: Pick<EventLog, "get" | "children" | "size" | "withKey">;
  readonly metrics: Metrics;
  readonly status: Status;
  /** Entities that have work they cannot hand off right now. */
  readonly stalled: ReadonlySet<EntityId>;
  /** Parcels that are redeliveries: publisher duplicates, and parcels of an event whose key was already produced. */
  readonly duplicates: ReadonlySet<Parcel["id"]>;
  /** Every telemetry record of the run, in order. Levels are short. */
  readonly history: readonly Telemetry[];
  /** Every accepted command with the tick it applied at. Seed + this replays the run exactly. */
  readonly commands: readonly { readonly tick: Tick; readonly command: Command }[];
  /** Where a parcel is right now, or null if it left the factory. */
  locate(parcel: Parcel["id"]): { readonly kind: "belt"; readonly cell: number } | { readonly kind: "entity"; readonly entity: EntityId } | null;
  /** Parcels inside a building, not counting its out-buffers. */
  held(entity: EntityId): readonly Parcel[];
  /** "PaymentService@5,1", also for entities that were since removed. */
  labelOf(entity: EntityId): string;
}

export interface Sim extends SimView {
  /** Validates against layout, unlocks, budget. On success the topology is re-derived and removed parcels drop. */
  apply(command: Command): Result.Result<void, CommandRejected>;
  /**
   * One tick. No-op once status is finished. Returns this tick's telemetry.
   * Order inside a tick, fixed for determinism:
   *   1. entities in ascending EntityId: behaviour.tick -> intents -> sends/telemetry
   *   2. movement.moveParcels (offers call behaviour.accept)
   *   3. metrics = fold(observe, this tick's telemetry); hints; status = evaluate(...)
   *   4. objectiveProgress / hint / finished telemetry appended
   */
  step(): readonly Telemetry[];
}

/** One entity's behaviour bound to its kind and state, so the sim drives all four archetypes the same way. */
interface Runtime {
  readonly kind: Kind;
  view(): EntityState;
  tick(ctx: TickContext, claim: (side: OutSide) => boolean): { readonly intents: readonly Intent[]; readonly stalled: boolean };
  accept(parcel: Parcel, event: EventRecord, ctx: TickContext): { readonly kind: "take" } | { readonly kind: "refuse" } | { readonly kind: "discard"; readonly reason: DropReason };
  holding(): readonly Parcel[];
  done(): boolean;
}

function bind<K extends Kind, S>(behaviour: Behaviour<K, S>, kind: K, wrap: (state: S) => EntityState): Runtime {
  let state = behaviour.init(kind);
  return {
    kind,
    view: () => wrap(state),
    tick(ctx, claim) {
      const result = behaviour.tick(kind, state, ctx, claim);
      state = result.state;
      return result;
    },
    accept(parcel, event, ctx) {
      const result = behaviour.accept(kind, state, parcel, event, ctx);
      if (result.kind !== "take") return result;
      state = result.state;
      return { kind: "take" };
    },
    holding: () => behaviour.holding(state),
    done: () => behaviour.done(kind, state),
  };
}

function runtimeFor(kind: Kind): Runtime {
  switch (kind.archetype) {
    case "source":
      return bind(behaviours.source, kind, (state) => ({ archetype: "source", state }));
    case "broker":
      return bind(behaviours.broker, kind, (state) => ({ archetype: "broker", state }));
    case "machine":
      return bind(behaviours.machine, kind, (state) => ({ archetype: "machine", state }));
    case "sink":
      return bind(behaviours.sink, kind, (state) => ({ archetype: "sink", state }));
  }
}

export function createSim(pack: Pack, scenarioRef: ScenarioId | Scenario): Sim {
  const scenario = typeof scenarioRef === "string" ? pack.scenarios.find((s) => s.id === scenarioRef) : scenarioRef;
  if (scenario === undefined) throw new Error(`unknown scenario ${String(scenarioRef)}`);

  let tick = Tick(0);
  let layout = initialLayout(pack, scenario);
  const runtimes = new Map<EntityId, Runtime>();
  const kindOfEntity = new Map<EntityId, KindId>();
  const labels = new Map<EntityId, string>();
  const belts: BeltSlot[] = Array.from({ length: scenario.width * scenario.height }, () => emptyBelt);
  const out = new Map<EntityId, Map<Side, Parcel>>();
  const log = createEventLog(pack.events);
  const history: Telemetry[] = [];
  const commands: { readonly tick: Tick; readonly command: Command }[] = [];
  const stalled = new Set<EntityId>();
  const duplicates = new Set<Parcel["id"]>();
  const firedHints = new Set<number>();
  let metrics = emptyMetrics;
  let settled = false;
  let status = evaluate(scenario, metrics, tick, settled);
  let nextParcel = 0;
  let minted = 0;
  let consumed = 0;
  let pending: Telemetry[] = [];

  const register = (placed: Placement & { readonly entity: EntityId }) => {
    const { x, y } = placed.at;
    if (placed.build.kind === "belt") {
      labels.set(placed.entity, `${pack.belt.title}@${x},${y}`);
      return;
    }
    const kind = pack.kinds.get(placed.build.id);
    if (kind === undefined) return;
    runtimes.set(placed.entity, runtimeFor(kind));
    kindOfEntity.set(placed.entity, kind.id);
    labels.set(placed.entity, `${kind.title}@${x},${y}`);
  };
  for (const placed of layout.placements.values()) register(placed);

  const newParcel = (event: EventId, duplicate: boolean): Parcel => {
    const parcel = { id: ParcelId(nextParcel++), event };
    minted++;
    if (duplicate) duplicates.add(parcel.id);
    return parcel;
  };

  const contextFor = (entity: EntityId): TickContext => ({
    tick,
    pack,
    scenario,
    entity,
    log,
    linked: layout.topology.linkedSides.get(entity) ?? [],
    roll: (...parts) => roll(scenario.seed, ...parts),
    mint: (draft) => {
      const record = log.append(draft, entity, tick);
      const parcel = newParcel(record.id, log.withKey(record.idempotencyKey).length > 1);
      const base = { tick, entity, parcel: parcel.id, event: record.id };
      pending.push(draft.origin.kind === "root" ? { ...base, tag: "emitted" } : { ...base, tag: "produced", cause: draft.origin.by });
      return parcel;
    },
    copy: (event, why) => newParcel(event, why === "duplicate"),
  });

  const drop = (entity: EntityId, parcel: Parcel, reason: DropReason) =>
    pending.push({ tag: "dropped", tick, entity, parcel: parcel.id, event: parcel.event, reason });

  const applyIntent = (entity: EntityId, intent: Intent) => {
    const of = (parcel: Parcel) => ({ tick, entity, parcel: parcel.id, event: parcel.event });
    switch (intent.kind) {
      case "send": {
        const buffers = out.get(entity) ?? new Map<Side, Parcel>();
        buffers.set(intent.side, intent.parcel);
        out.set(entity, buffers);
        return;
      }
      case "drop":
        return drop(entity, intent.parcel, intent.reason);
      case "consume":
        consumed++;
        return;
      case "deliver":
        pending.push({ ...of(intent.parcel), tag: intent.outcome });
        return;
      case "outOfOrder":
        pending.push({ ...of(intent.parcel), tag: "outOfOrder", expectedAfter: intent.expectedAfter, seq: intent.seq });
        return;
      case "fail":
        pending.push({ ...of(intent.parcel), tag: "failed", attempt: intent.attempt, timing: intent.timing });
        return;
      case "retry":
        pending.push({ ...of(intent.parcel), tag: "retrying", attempt: intent.attempt, at: intent.at });
        return;
    }
  };

  const liveParcels = (): number => {
    let n = 0;
    for (const slot of belts) if (slot.kind === "full") n++;
    for (const buffers of out.values()) n += buffers.size;
    for (const runtime of runtimes.values()) n += runtime.holding().length;
    return n;
  };

  /** Phase 3 and 4: fold this tick's telemetry into metrics, fire hints, re-evaluate. */
  const settle = (): readonly Telemetry[] => {
    const lookup = { log, kindOf: (entity: EntityId) => kindOfEntity.get(entity) ?? KindId("") };
    const before = metrics;
    for (const t of pending) metrics = observe(metrics, t, lookup);
    const counted = metrics !== before;
    const live = liveParcels();
    const p = metrics.parcels;
    if (p.minted !== minted || p.live !== live || p.consumed !== consumed) metrics = { ...metrics, parcels: { minted, live, consumed } };

    scenario.hints.forEach((hint, index) => {
      if (firedHints.has(index)) return;
      const when = hint.when;
      const fires =
        when.kind === "tick"
          ? tick >= when.tick
          : pending.some((t) => t.tag === when.on && (when.kindId === "any" || ("entity" in t && kindOfEntity.get(t.entity) === when.kindId)));
      if (!fires) return;
      firedHints.add(index);
      pending.push({ tag: "hint", tick, hint: index, text: hint.text });
    });

    // Status keeps its identity unless something it reads changed, so a stalled factory re-renders nothing.
    const nowSettled = live === 0 && [...runtimes.values()].every((r) => r.done());
    if (status.kind === "running" && (counted || nowSettled !== settled || tick >= scenario.maxTicks)) {
      settled = nowSettled;
      const previous = status;
      status = evaluate(scenario, metrics, tick, settled);
      status.goals.forEach((g, goal) => {
        if (g.count !== previous.goals[goal]?.count) pending.push({ tag: "objectiveProgress", tick, goal, count: g.count, target: g.goal.deliver });
      });
      if (status.kind === "finished") pending.push({ tag: "finished", tick, outcome: status.outcome });
    }

    const emitted = pending;
    pending = [];
    history.push(...emitted);
    return emitted;
  };

  const offer = (entity: EntityId, parcel: Parcel): "taken" | "refused" => {
    const runtime = runtimes.get(entity);
    if (runtime === undefined) return "refused";
    const result = runtime.accept(parcel, log.get(parcel.event), contextFor(entity));
    if (result.kind === "refuse") return "refused";
    if (result.kind === "discard") drop(entity, parcel, result.reason);
    else pending.push({ tag: "accepted", tick, entity, parcel: parcel.id, event: parcel.event });
    return "taken";
  };

  const sim: Sim = {
    pack,
    scenario,
    get tick() {
      return tick;
    },
    get layout() {
      return layout;
    },
    get entities() {
      return new Map([...runtimes].map(([id, r]) => [id, r.view()]));
    },
    belts,
    out,
    log,
    get metrics() {
      return metrics;
    },
    get status() {
      return status;
    },
    stalled,
    duplicates,
    history,
    commands,

    locate(parcel) {
      const cell = belts.findIndex((slot) => slot.kind === "full" && slot.parcel.id === parcel);
      if (cell >= 0) return { kind: "belt", cell };
      for (const [entity, buffers] of out) for (const p of buffers.values()) if (p.id === parcel) return { kind: "entity", entity };
      for (const [entity, runtime] of runtimes) if (runtime.holding().some((p) => p.id === parcel)) return { kind: "entity", entity };
      return null;
    },
    held: (entity) => runtimes.get(entity)?.holding() ?? [],
    labelOf: (entity) => labels.get(entity) ?? `entity ${entity}`,

    apply(command) {
      // The outcome is final, so a later edit could never run.
      if (status.kind === "finished") return Result.fail(new CommandRejected({ command, reason: { kind: "finished" } }));
      const applied = applyCommand(pack, layout, command);
      if (applied instanceof CommandRejected) return Result.fail(applied);
      for (const removed of applied.removed) {
        if (removed.build.kind === "belt") {
          const cell = cellOf(scenario, removed.at);
          const slot = belts[cell];
          if (slot?.kind === "full") drop(removed.entity, slot.parcel, "removed");
          belts[cell] = emptyBelt;
          continue;
        }
        for (const parcel of runtimes.get(removed.entity)?.holding() ?? []) drop(removed.entity, parcel, "removed");
        for (const parcel of out.get(removed.entity)?.values() ?? []) drop(removed.entity, parcel, "removed");
        runtimes.delete(removed.entity);
        out.delete(removed.entity);
        if (stalled.delete(removed.entity)) pending.push({ tag: "unstalled", tick, entity: removed.entity });
      }
      layout = applied.layout;
      for (const id of applied.added) {
        const placed = layout.placements.get(id);
        if (placed !== undefined) register(placed);
      }
      commands.push({ tick, command });
      settle();
      return Result.void;
    },

    step() {
      if (status.kind === "finished") return [];
      tick = Tick(tick + 1);
      for (const [entity, runtime] of runtimes) {
        const linked = layout.topology.linkedSides.get(entity) ?? [];
        const claimed = new Set<OutSide>();
        const claim = (side: OutSide): boolean => {
          if (!linked.includes(side) || claimed.has(side) || out.get(entity)?.has(side) === true) return false;
          claimed.add(side);
          return true;
        };
        const result = runtime.tick(contextFor(entity), claim);
        for (const intent of result.intents) applyIntent(entity, intent);
        if (result.stalled && !stalled.has(entity)) {
          stalled.add(entity);
          pending.push({ tag: "stalled", tick, entity });
        } else if (!result.stalled && stalled.delete(entity)) {
          pending.push({ tag: "unstalled", tick, entity });
        }
      }
      moveParcels(layout.topology, belts, out, pack.belt.ticksPerTile, offer);
      return settle();
    },
  };
  return sim;
}

export type RunLayout =
  | { readonly kind: "solution" }
  | { readonly kind: "counterexample"; readonly index: number }
  | { readonly kind: "commands"; readonly commands: readonly Command[] };

export interface RunReport {
  readonly scenario: ScenarioId;
  readonly layout: RunLayout;
  readonly status: Extract<Status, { kind: "finished" }>;
  readonly metrics: Metrics;
  readonly ticks: Tick;
  /** Last 50 telemetry records, so a failing check can say what went wrong. */
  readonly tail: readonly Telemetry[];
  /** `tail` as one line each, with entity and event labels resolved. */
  readonly tailText: readonly string[];
}

const placeAll = (placements: readonly Placement[]): readonly Command[] =>
  placements.map((p) => ({ kind: "place", at: p.at, facing: p.facing, build: p.build }));

/**
 * Runs a scenario to completion headlessly. Solution and counterexample
 * placements become tick-0 place commands. A rejected command there is a pack
 * bug that load.ts should have caught, so it fails the run rather than skipping.
 */
export function runScenario(pack: Pack, scenario: Scenario, layout: RunLayout): Result.Result<RunReport, CommandRejected> {
  const sim = createSim(pack, scenario);
  const commands =
    layout.kind === "solution"
      ? placeAll(scenario.solution)
      : layout.kind === "counterexample"
        ? placeAll(scenario.counterexamples[layout.index]?.placements ?? [])
        : layout.commands;
  for (const command of commands) {
    const applied = sim.apply(command);
    if (Result.isFailure(applied)) return Result.fail(applied.failure);
  }
  let status = sim.status;
  while (status.kind !== "finished") {
    sim.step();
    status = sim.status;
  }
  const tail = sim.history.slice(-50);
  return Result.succeed({
    scenario: scenario.id,
    layout,
    status,
    metrics: sim.metrics,
    ticks: sim.tick,
    tail,
    tailText: tail.map((t) => describeTelemetry(sim, t)),
  });
}

/** A short label for an event: its business key, else its first text field, else its id. */
export function eventLabel(sim: Pick<SimView, "pack">, event: EventRecord): string {
  const type = sim.pack.events.get(event.type);
  const field = type?.key[0] ?? [...(type?.fields ?? new Map()).entries()].find(([, t]) => t === "string")?.[0];
  const value = field === undefined ? undefined : event.payload[field];
  return value === undefined ? `${event.type}#${event.id}` : `${event.type} ${String(value)}`;
}

/** One telemetry record as a line, e.g. `t=598 failed  PaymentService@5,1  OrderPlaced big-1 attempt 4 beforeEffect`. */
export function describeTelemetry(sim: SimView, t: Telemetry): string {
  const head = `t=${t.tick} ${t.tag.padEnd(17)}`;
  switch (t.tag) {
    case "objectiveProgress":
      return `${head} goal ${t.goal}: ${t.count}/${t.target}`;
    case "hint":
      return `${head} ${t.text}`;
    case "finished":
      return `${head} ${t.outcome.kind === "won" ? "won" : t.outcome.reason.kind === "outOfTime" ? "lost: out of time" : `lost: constraint ${t.outcome.reason.index}`}`;
    case "stalled":
    case "unstalled":
      return `${head} ${sim.labelOf(t.entity)}`;
    default: {
      const where = sim.labelOf(t.entity).padEnd(24);
      const what = eventLabel(sim, sim.log.get(t.event));
      const detail =
        t.tag === "failed"
          ? ` attempt ${t.attempt} ${t.timing}`
          : t.tag === "retrying"
            ? ` attempt ${t.attempt} at t=${t.at}`
            : t.tag === "dropped"
              ? ` ${t.reason}`
              : t.tag === "outOfOrder"
                ? ` seq ${t.seq} after ${t.expectedAfter}`
                : "";
      return `${head} ${where} ${what}${detail}`;
    }
  }
}

/** Causation tree around one event, for the inspector's trace view. */
export interface Trace {
  readonly root: EventRecord;
  /** Path from root down to the requested event. */
  readonly path: readonly EventRecord[];
  /** Everything caused by the requested event, transitively. */
  readonly descendants: readonly { readonly event: EventRecord; readonly depth: number }[];
  /** Telemetry for every event in path and descendants, in tick order. */
  readonly timeline: readonly Telemetry[];
  /** Other events with the same idempotency key: the duplicates. */
  readonly siblings: readonly EventId[];
}

/** Internal to the engine; reached from outside through inspect(). */
export function trace(sim: Pick<SimView, "log" | "history">, event: EventId): Trace {
  const target = sim.log.get(event);
  const path: EventRecord[] = [target];
  for (let at = target; at.origin.kind === "caused"; ) {
    at = sim.log.get(at.origin.by);
    path.unshift(at);
  }
  // Depth-first, so each descendant follows its own parent when drawn as an indented tree.
  const descendants: { readonly event: EventRecord; readonly depth: number }[] = [];
  // An explicit stack, since a causation chain can be longer than the call stack is deep.
  const stack = sim.log.children(event).map((id) => ({ id, depth: 1 })).reverse();
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    descendants.push({ event: sim.log.get(next.id), depth: next.depth });
    const depth = next.depth + 1;
    const children = sim.log.children(next.id);
    for (let i = children.length - 1; i >= 0; i--) {
      const id = children[i];
      if (id !== undefined) stack.push({ id, depth });
    }
  }
  const ids = new Set<EventId>([...path.map((e) => e.id), ...descendants.map((d) => d.event.id)]);
  return {
    root: path[0] ?? target,
    path,
    descendants,
    timeline: sim.history.filter((t) => "event" in t && ids.has(t.event)),
    siblings: sim.log.withKey(target.idempotencyKey).filter((id) => id !== event),
  };
}
