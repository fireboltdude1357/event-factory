// The browser seam. A Session owns one Sim plus a clock and listeners. React
// reads `getSnapshot` through useSyncExternalStore; the canvas pulls `frame`
// every animation frame without going through React at all.

import type { Result } from "effect";
import type { EntityId, EventId, EventTypeId, KindId, ScenarioId, Tick } from "./ids.js";
import { inspect as inspectSim, shapeOf, type BuildingShape, type InspectTarget, type Inspection } from "./inspect.js";
import { countPlaced, type Facing, type Kind, type Pack, type Placement, type Point } from "./pack/model.js";
import type { GoalProgress, Metrics, Status } from "./sim/objectives.js";
import { createSim, type Sim } from "./sim/sim.js";
import type { Telemetry, TelemetryOf, TelemetryTag } from "./sim/telemetry.js";
import type { EntityState } from "./sim/archetypes/index.js";
import { cellOf, outSides, pointOf, sideDirection, type Command, type CommandRejected } from "./sim/world.js";

/**
 * Changes identity only when something React shows changes; never per tick of a stalled factory.
 * It has no tick on purpose: read `frame().tick`, which is always current.
 */
export interface SessionSnapshot {
  readonly scenario: { readonly id: ScenarioId; readonly title: string; readonly brief: string };
  /** The tick when the snapshot was built. A live counter reads `RenderFrame.tick`. */
  readonly clock: "paused" | "playing";
  readonly speed: 1 | 2 | 4 | 8;
  readonly status: Status;
  readonly goals: readonly GoalProgress[];
  readonly metrics: Metrics;
  readonly palette: readonly { readonly id: KindId | "belt"; readonly title: string; readonly remaining: number | "unlimited" }[];
  /** Hints fired so far, newest last. */
  readonly hints: readonly string[];
}

/** Everything the canvas draws. Built fresh per call from owned arrays; cheap at a few hundred parcels. */
export interface RenderFrame {
  /** Counts restarts (reset, rewind, loadSolution). Flash ids are unique within one run. */
  readonly run: number;
  readonly tick: Tick;
  /** The tick plus the share of the next one already elapsed. Belt and job animation read this, so a paused game holds still. */
  readonly time: number;
  /** Ticks a parcel spends on one belt tile. */
  readonly ticksPerTile: number;
  readonly width: number;
  readonly height: number;
  readonly terrain: readonly ("floor" | "wall")[];
  readonly buildings: readonly {
    readonly entity: EntityId;
    readonly kind: KindId;
    readonly shape: BuildingShape;
    readonly at: Point;
    readonly facing: Facing;
    readonly glyph: string;
    readonly title: string;
    /** The pack's accent for the kind, or null. */
    readonly color: string | null;
    readonly locked: boolean;
    readonly state: "idle" | "busy" | "stalled" | "failing";
    /** Parcels held, for a small badge. */
    readonly load: number;
    /** Absolute directions this building can send to. `port` is a machine's name for that output. */
    readonly outs: readonly { readonly facing: Facing; readonly port: string | null }[];
    /** How far the current job is, 0 to 1, interpolated between ticks. Null when nothing is being worked on. */
    readonly work: number | null;
    /** A machine waiting to retry: the attempt it will make, the most it makes, and how much of the wait is left (1 to 0). */
    readonly retry: { readonly attempt: number; readonly of: number; readonly wait: number } | null;
    /** A broker's fullest buffer as a share of its capacity, 0 to 1. Null for everything else. */
    readonly fill: number | null;
  }[];
  readonly belts: readonly { readonly entity: EntityId; readonly at: Point; readonly facing: Facing }[];
  /**
   * Position in tile units, already interpolated between tiles: tile (x, y)
   * spans [x, x+1) by [y, y+1), so its center is (x + 0.5, y + 0.5).
   */
  readonly parcels: readonly {
    /** The parcel's own id, stable while it moves. Fanout copies of one event differ here. */
    readonly id: number;
    readonly x: number;
    readonly y: number;
    readonly facing: Facing;
    readonly event: EventId;
    readonly type: EventTypeId;
    readonly color: string;
    readonly duplicate: boolean;
  }[];
  /**
   * Short-lived markers from recent telemetry at the building that recorded it, newest first.
   * `id` is unique within a run, so a renderer can start an animation once per marker.
   * `color` is the event's color.
   */
  readonly flashes: readonly { readonly id: number; readonly at: Point; readonly tag: FlashTag; readonly age: number; readonly color: string }[];
}

export interface Session {
  subscribe(onChange: () => void): () => void;
  getSnapshot(): SessionSnapshot;

  dispatch(command: Command): Result.Result<void, CommandRejected>;
  play(): void;
  pause(): void;
  setSpeed(speed: SessionSnapshot["speed"]): void;
  /** One tick while paused. */
  step(): void;
  /** Back to the scenario's preplaced layout at tick 0. Keeps nothing. */
  reset(): void;
  /** Back to tick 0 with the layout as it stands, so a lost run can be fixed and played again. */
  rewind(): void;
  /** Loads the reference solution; used by the "show me" button and the e2e smoke. */
  loadSolution(): void;

  /** Current picture, interpolated between ticks from the session's own clock. */
  frame(): RenderFrame;
  /** Docs, live facts, and (for events) the causation trace. The only way to get a trace. */
  inspect(target: InspectTarget): Inspection | null;
  /** The type of an event a telemetry record names, or null for an id this run never minted. */
  typeOf(event: EventId): EventTypeId | null;

  /** For tutorials: typed by tag. Returns unsubscribe. */
  on<T extends TelemetryTag>(tag: T, listener: (t: TelemetryOf<T>) => void): () => void;
  onAny(listener: (t: Telemetry) => void): () => void;

  dispose(): void;
}

export interface SessionOptions {
  /** Sim ticks per second at speed 1. Default 10. */
  readonly ticksPerSecond?: number;
  /** Injected so tests can drive time. Default: requestAnimationFrame. */
  readonly frames?: (onFrame: (nowMs: number) => void) => () => void;
}

/** Most ticks one frame may run. A slow frame skips time instead of spiralling. */
const maxTicksPerFrame = 8;
const flashTicks = 8;
const flashTags = ["emitted", "produced", "failed", "retrying", "dropped", "deadLettered", "delivered", "duplicateApplied", "duplicateIgnored", "outOfOrder"] as const satisfies readonly TelemetryTag[];

/** Telemetry the map flashes. The canvas maps each one to a color. */
export type FlashTag = (typeof flashTags)[number];

const isFlash = (t: Telemetry): t is TelemetryOf<FlashTag> => (flashTags as readonly TelemetryTag[]).includes(t.tag);

// A frame that finishes the level stops the loop from inside its own callback,
// where cancelAnimationFrame is a no-op, so the flag keeps it from re-arming.
const animationFrames = (onFrame: (nowMs: number) => void): (() => void) => {
  let stopped = false;
  let id = requestAnimationFrame(function loop(now) {
    onFrame(now);
    if (!stopped) id = requestAnimationFrame(loop);
  });
  return () => {
    stopped = true;
    cancelAnimationFrame(id);
  };
};

type Progress = Pick<RenderFrame["buildings"][number], "work" | "retry" | "fill">;

const share = (n: number) => Math.max(0, Math.min(1, n));

/** Job progress, retry wait and buffer fill at `now`, which is the tick plus the fraction of the next one already elapsed. */
function progress(kind: Kind, entity: EntityState | undefined, now: number): Progress {
  const none: Progress = { work: null, retry: null, fill: null };
  if (entity === undefined) return none;
  if (kind.archetype === "broker" && entity.archetype === "broker") {
    const s = entity.state;
    const fullest = s.delivery === "competing" ? s.buffer.length : Math.max(0, ...[...s.buffers.values()].map((b) => b.length));
    return { ...none, fill: share(fullest / kind.capacity) };
  }
  if (kind.archetype === "sink" && entity.archetype === "sink") {
    return entity.state.current === null ? none : { ...none, work: share(1 - (entity.state.busyUntil - now) / Math.max(1, kind.ticksPerEvent)) };
  }
  if (kind.archetype === "machine" && entity.archetype === "machine") {
    let work: number | null = null;
    let retry: Progress["retry"] = null;
    for (const slot of entity.state.slots) {
      if (slot.phase === "working") {
        const ticks = kind.recipes[slot.recipe]?.ticks ?? 0;
        work = Math.max(work ?? 0, ticks === 0 ? 1 : share(1 - (slot.doneAt - now) / ticks));
      } else if (slot.phase === "backoff" && retry === null) {
        const { backoff, maxAttempts } = kind.failures;
        const total = backoff.kind === "fixed" ? backoff.ticks : backoff.ticks * 2 ** (slot.attempt - 2);
        retry = { attempt: slot.attempt, of: maxAttempts, wait: share((slot.resumeAt - now) / Math.max(1, total)) };
      }
    }
    return { work, retry, fill: null };
  }
  return none;
}

function isTag<T extends TelemetryTag>(t: Telemetry, tag: T): t is TelemetryOf<T> {
  return t.tag === tag;
}

export function createSession(pack: Pack, scenarioId: ScenarioId, options: SessionOptions = {}): Session {
  const scenario = pack.scenarios.find((s) => s.id === scenarioId);
  if (scenario === undefined) throw new Error(`unknown scenario ${scenarioId}`);
  const ticksPerSecond = options.ticksPerSecond ?? 10;
  const frames = options.frames ?? animationFrames;

  let sim: Sim = createSim(pack, scenario);
  let clock: SessionSnapshot["clock"] = "paused";
  let speed: SessionSnapshot["speed"] = 1;
  let stopFrames: (() => void) | null = null;
  let lastFrame: number | null = null;
  // Fraction of the next tick already elapsed; drives interpolation.
  let pendingTicks = 0;
  let run = 0;
  let hints: readonly string[] = [];
  const subscribers = new Set<() => void>();
  const listeners = new Set<(t: Telemetry) => void>();

  const build = (): SessionSnapshot => ({
    scenario: { id: scenario.id, title: scenario.title, brief: scenario.brief },
    clock,
    speed,
    status: sim.status,
    goals: sim.status.goals,
    metrics: sim.metrics,
    palette: [...scenario.unlocked].map((id) => {
      const limit = id === "belt" ? undefined : scenario.budget.get(id);
      return {
        id,
        title: id === "belt" ? pack.belt.title : (pack.kinds.get(id)?.title ?? id),
        remaining: limit === undefined || id === "belt" ? "unlimited" : limit - countPlaced(sim.layout.placements.values(), id),
      };
    }),
    hints,
  });

  const visible = () => [sim, sim.status, sim.metrics, sim.layout, hints, clock, speed] as const;
  let shown = visible();
  let snapshot = build();

  const refresh = () => {
    const now = visible();
    if (now.every((v, i) => v === shown[i])) return;
    shown = now;
    snapshot = build();
    for (const notify of subscribers) notify();
  };

  const publish = (records: readonly Telemetry[]) => {
    for (const t of records) {
      if (t.tag === "hint") hints = [...hints, t.text];
      for (const listener of listeners) listener(t);
    }
  };

  const halt = () => {
    stopFrames?.();
    stopFrames = null;
    lastFrame = null;
    pendingTicks = 0;
    clock = "paused";
  };

  const advance = (ticks: number) => {
    for (let i = 0; i < ticks && sim.status.kind === "running"; i++) publish(sim.step());
    if (sim.status.kind === "finished") halt();
  };

  const onFrame = (now: number) => {
    const elapsed = lastFrame === null ? 0 : now - lastFrame;
    lastFrame = now;
    pendingTicks += (elapsed / 1000) * ticksPerSecond * speed;
    let ticks = Math.floor(pendingTicks);
    if (ticks > maxTicksPerFrame) {
      ticks = maxTicksPerFrame;
      pendingTicks = 0;
    } else pendingTicks -= ticks;
    advance(ticks);
    refresh();
  };

  const restart = () => {
    halt();
    sim = createSim(pack, scenario);
    hints = [];
    run++;
  };

  const sameBuild = (a: Placement, b: Placement) =>
    a.build.kind === b.build.kind && (a.build.kind === "belt" || (b.build.kind === "building" && a.build.id === b.build.id));

  /** Makes the fresh sim's layout match `wanted`: only unlocked cells can differ, and those the player may change. */
  const restore = (wanted: readonly Placement[]) => {
    const want = new Map(wanted.map((p) => [cellOf(scenario, p.at), p]));
    for (const p of [...sim.layout.placements.values()]) {
      const target = want.get(cellOf(scenario, p.at));
      if (target === undefined || !sameBuild(p, target)) sim.apply({ kind: "remove", at: p.at });
      else if (target.facing !== p.facing) sim.apply({ kind: "rotate", at: p.at, to: target.facing });
    }
    for (const [cell, p] of want) if (!sim.layout.byCell.has(cell)) sim.apply({ kind: "place", at: p.at, facing: p.facing, build: p.build });
  };

  const dispatch = (command: Command) => {
    const before = sim.history.length;
    const result = sim.apply(command);
    publish(sim.history.slice(before));
    refresh();
    return result;
  };

  return {
    subscribe(onChange) {
      subscribers.add(onChange);
      return () => subscribers.delete(onChange);
    },
    getSnapshot: () => snapshot,
    dispatch,
    play() {
      if (clock === "playing" || sim.status.kind === "finished") return;
      clock = "playing";
      stopFrames = frames(onFrame);
      refresh();
    },
    pause() {
      halt();
      refresh();
    },
    setSpeed(next) {
      speed = next;
      refresh();
    },
    step() {
      if (clock === "playing") return;
      advance(1);
      refresh();
    },
    reset() {
      restart();
      refresh();
    },
    rewind() {
      const layout = [...sim.layout.placements.values()];
      restart();
      restore(layout);
      refresh();
    },
    loadSolution() {
      restart();
      for (const p of scenario.solution) {
        const before = sim.history.length;
        sim.apply({ kind: "place", at: p.at, facing: p.facing, build: p.build });
        publish(sim.history.slice(before));
      }
      refresh();
    },

    frame() {
      const tpt = pack.belt.ticksPerTile;
      const fraction = clock === "playing" ? pendingTicks : 0;
      const buildings: RenderFrame["buildings"][number][] = [];
      const belts: RenderFrame["belts"][number][] = [];
      for (const placed of sim.layout.placements.values()) {
        if (placed.build.kind === "belt") {
          belts.push({ entity: placed.entity, at: placed.at, facing: placed.facing });
          continue;
        }
        const kind = pack.kinds.get(placed.build.id);
        if (kind === undefined) continue;
        const load = sim.held(placed.entity).length + (sim.out.get(placed.entity)?.size ?? 0);
        const entity = sim.entities.get(placed.entity);
        const failing = entity?.archetype === "machine" && entity.state.slots.some((s) => s.phase === "backoff");
        const state = sim.stalled.has(placed.entity) ? "stalled" : failing ? "failing" : load > 0 ? "busy" : "idle";
        buildings.push({
          entity: placed.entity,
          kind: kind.id,
          shape: shapeOf(kind),
          at: placed.at,
          facing: placed.facing,
          glyph: kind.glyph,
          title: kind.title,
          color: kind.color,
          locked: placed.locked,
          state,
          load,
          outs: outSides(kind).map((side) => ({
            facing: sideDirection(placed.facing, side),
            port: kind.archetype === "machine" ? (kind.ports.find((p) => p.side === side)?.id ?? null) : null,
          })),
          ...progress(kind, entity, sim.tick + fraction),
        });
      }

      const parcels: RenderFrame["parcels"][number][] = [];
      sim.belts.forEach((slot, cell) => {
        if (slot.kind === "empty") return;
        const id = sim.layout.byCell.get(cell);
        const placed = id === undefined ? undefined : sim.layout.placements.get(id);
        if (placed === undefined) return;
        const p = pointOf(scenario, cell);
        const along = Math.min(slot.progress + (slot.progress < tpt ? fraction : 0), tpt) / tpt - 0.5;
        const dx = placed.facing === "east" ? 1 : placed.facing === "west" ? -1 : 0;
        const dy = placed.facing === "south" ? 1 : placed.facing === "north" ? -1 : 0;
        const event = sim.log.get(slot.parcel.event);
        parcels.push({
          id: slot.parcel.id,
          x: p.x + 0.5 + dx * along,
          y: p.y + 0.5 + dy * along,
          facing: placed.facing,
          event: event.id,
          type: event.type,
          color: pack.events.get(event.type)?.color ?? "#888888",
          duplicate: sim.duplicates.has(slot.parcel.id),
        });
      });

      const flashes: RenderFrame["flashes"][number][] = [];
      for (let i = sim.history.length - 1; i >= 0; i--) {
        const t = sim.history[i];
        if (t === undefined || sim.tick - t.tick >= flashTicks) break;
        if (!isFlash(t)) continue;
        const placed = sim.layout.placements.get(t.entity);
        if (placed !== undefined)
          flashes.push({ id: i, at: placed.at, tag: t.tag, age: sim.tick - t.tick, color: pack.events.get(sim.log.get(t.event).type)?.color ?? "#888888" });
      }

      return { run, tick: sim.tick, time: sim.tick + fraction, ticksPerTile: tpt, width: scenario.width, height: scenario.height, terrain: scenario.terrain, buildings, belts, parcels, flashes };
    },

    inspect: (target) => inspectSim(sim, target),
    typeOf: (event) => (event >= 0 && event < sim.log.size ? sim.log.get(event).type : null),

    on(tag, listener) {
      const wrapped = (t: Telemetry) => {
        if (isTag(t, tag)) listener(t);
      };
      listeners.add(wrapped);
      return () => listeners.delete(wrapped);
    },
    onAny(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    dispose() {
      halt();
      subscribers.clear();
      listeners.clear();
    },
  };
}
