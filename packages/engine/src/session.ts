// The browser seam. A Session owns one Sim plus a clock and listeners. React
// reads `getSnapshot` through useSyncExternalStore; the canvas pulls `frame`
// every animation frame without going through React at all.

import type { Result } from "effect";
import type { EventId, KindId, ScenarioId, Tick } from "./ids.js";
import { inspect as inspectSim, type InspectTarget, type Inspection } from "./inspect.js";
import { countPlaced, type Facing, type Pack, type Point } from "./pack/model.js";
import type { GoalProgress, Metrics, Status } from "./sim/objectives.js";
import { createSim, type Sim } from "./sim/sim.js";
import type { Telemetry, TelemetryOf, TelemetryTag } from "./sim/telemetry.js";
import { pointOf, type Command, type CommandRejected } from "./sim/world.js";

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
  readonly tick: Tick;
  readonly width: number;
  readonly height: number;
  readonly terrain: readonly ("floor" | "wall")[];
  readonly buildings: readonly {
    readonly at: Point;
    readonly facing: Facing;
    readonly glyph: string;
    readonly title: string;
    readonly locked: boolean;
    readonly state: "idle" | "busy" | "stalled" | "failing";
    /** Parcels held, for a small badge. */
    readonly load: number;
  }[];
  readonly belts: readonly { readonly at: Point; readonly facing: Facing }[];
  /**
   * Position in tile units, already interpolated between tiles: tile (x, y)
   * spans [x, x+1) by [y, y+1), so its center is (x + 0.5, y + 0.5).
   */
  readonly parcels: readonly { readonly x: number; readonly y: number; readonly event: EventId; readonly color: string; readonly duplicate: boolean }[];
  /** Short-lived markers from recent telemetry at the building that recorded it, newest first. */
  readonly flashes: readonly { readonly at: Point; readonly tag: FlashTag; readonly age: number }[];
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
  /** Loads the reference solution; used by the "show me" button and the e2e smoke. */
  loadSolution(): void;

  /** Current picture, interpolated between ticks from the session's own clock. */
  frame(): RenderFrame;
  /** Docs, live facts, and (for events) the causation trace. The only way to get a trace. */
  inspect(target: InspectTarget): Inspection | null;

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
const flashTags = ["failed", "retrying", "dropped", "deadLettered", "delivered", "duplicateApplied", "duplicateIgnored", "outOfOrder"] as const satisfies readonly TelemetryTag[];

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
          belts.push({ at: placed.at, facing: placed.facing });
          continue;
        }
        const kind = pack.kinds.get(placed.build.id);
        if (kind === undefined) continue;
        const load = sim.held(placed.entity).length + (sim.out.get(placed.entity)?.size ?? 0);
        const entity = sim.entities.get(placed.entity);
        const failing = entity?.archetype === "machine" && entity.state.slots.some((s) => s.phase === "backoff");
        const state = sim.stalled.has(placed.entity) ? "stalled" : failing ? "failing" : load > 0 ? "busy" : "idle";
        buildings.push({ at: placed.at, facing: placed.facing, glyph: kind.glyph, title: kind.title, locked: placed.locked, state, load });
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
          x: p.x + 0.5 + dx * along,
          y: p.y + 0.5 + dy * along,
          event: event.id,
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
        if (placed !== undefined) flashes.push({ at: placed.at, tag: t.tag, age: sim.tick - t.tick });
      }

      return { tick: sim.tick, width: scenario.width, height: scenario.height, terrain: scenario.terrain, buildings, belts, parcels, flashes };
    },

    inspect: (target) => inspectSim(sim, target),

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
