// The resolved pack the engine trusts. Only pack/load.ts builds these.
// Every reference is resolved: ports are already sides, event types and
// kinds are branded ids that exist, predicates are tagged unions.

import type { EventTypeId, KindId, PortId, ScenarioId } from "../ids.js";
import type { Facing, FieldType, OutSide } from "./authoring.js";
import type { HintTag } from "../sim/telemetry.js";

export type { Facing, OutSide, Side } from "./authoring.js";

export type FieldValue = string | number | boolean;
export type Payload = Readonly<Record<string, FieldValue>>;

export interface EventType {
  readonly id: EventTypeId;
  readonly doc: string;
  readonly version: number;
  readonly fields: ReadonlyMap<string, FieldType>;
  /** Business key fields. Empty means the key is derived from causation. */
  readonly key: readonly string[];
  readonly color: `#${string}`;
}

export type Predicate =
  | { readonly kind: "is"; readonly field: string; readonly value: FieldValue }
  | { readonly kind: "oneOf"; readonly field: string; readonly values: readonly FieldValue[] }
  | { readonly kind: "range"; readonly field: string; readonly above?: number; readonly below?: number }
  | { readonly kind: "version"; readonly version: number }
  | { readonly kind: "all"; readonly of: readonly Predicate[] }
  | { readonly kind: "any"; readonly of: readonly Predicate[] }
  | { readonly kind: "not"; readonly of: Predicate };

/** An output port, kept by name for the inspector and by side for the sim. */
export interface Port {
  readonly id: PortId;
  readonly side: OutSide;
}

export type Disposal = { readonly kind: "drop" } | { readonly kind: "route"; readonly port: Port };

export type Emit =
  | { readonly kind: "forward"; readonly port: Port }
  | {
      readonly kind: "produce";
      readonly port: Port;
      readonly type: EventTypeId;
      readonly copy: readonly string[];
      readonly set: Payload;
    };

/** `index` is stable within its kind and feeds idempotency keys. */
export interface Recipe {
  readonly index: number;
  readonly consume: EventTypeId;
  readonly where: Predicate | null;
  readonly ticks: number;
  readonly emit: readonly Emit[];
}

interface KindBase {
  readonly id: KindId;
  readonly title: string;
  readonly doc: string;
  readonly glyph: string;
}

export interface SourceKind extends KindBase {
  readonly archetype: "source";
  readonly emits: readonly {
    readonly type: EventTypeId;
    readonly every: number;
    readonly count: number | "endless";
    readonly payloads: readonly { readonly weight: number; readonly values: Readonly<Record<string, FieldValue | { readonly seq: string }>>; readonly version: number }[];
    readonly duplicateChance: number;
  }[];
  readonly whenBlocked: "wait" | "drop";
}

export interface BrokerKind extends KindBase {
  readonly archetype: "broker";
  readonly delivery: "competing" | "fanout";
  readonly capacity: number;
  readonly whenFull: "block" | "drop";
}

export interface MachineKind extends KindBase {
  readonly archetype: "machine";
  readonly ports: readonly Port[];
  readonly workers: number;
  readonly recipes: readonly Recipe[];
  readonly unmatched: { readonly kind: "refuse" } | Disposal;
  readonly failures: {
    readonly maxAttempts: number;
    readonly backoff: { readonly kind: "fixed" | "doubling"; readonly ticks: number };
    readonly exhausted: Disposal;
  };
}

export interface SinkKind extends KindBase {
  readonly archetype: "sink";
  readonly accepts: ReadonlySet<EventTypeId> | "all";
  readonly ticksPerEvent: number;
  readonly role:
    | { readonly kind: "external"; readonly dedupe: "none" | "idempotencyKey" }
    | { readonly kind: "deadLetter" };
}

export type Kind = SourceKind | BrokerKind | MachineKind | SinkKind;

export interface Belt {
  readonly title: string;
  readonly doc: string;
  readonly ticksPerTile: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type Placeable = { readonly kind: "belt" } | { readonly kind: "building"; readonly id: KindId };

export interface Placement {
  readonly at: Point;
  readonly facing: Facing;
  readonly build: Placeable;
  readonly locked: boolean;
}

/**
 * Buildings of one kind that count against the budget: every unlocked one,
 * whether the map put it there with `locked: false` or the player placed it.
 * The loader checks overlays with this and the engine checks place commands
 * with it, so the two cannot disagree.
 */
export function countPlaced(placements: Iterable<Placement>, kind: KindId): number {
  let n = 0;
  for (const p of placements) if (!p.locked && p.build.kind === "building" && p.build.id === kind) n++;
  return n;
}

export type Terrain = "floor" | "wall";

export interface Fault {
  readonly kinds: ReadonlySet<KindId>;
  readonly event: EventTypeId | "any";
  readonly where: Predicate | null;
  readonly chance: number;
  readonly timing: "beforeEffect" | "afterEffect";
}

export type Goal = { readonly deliver: number; readonly type: EventTypeId | "any"; readonly at: KindId | "anyExternal" };

export type Constraint =
  | { readonly kind: "noLoss" }
  | { readonly kind: "noDuplicateEffects" }
  | { readonly kind: "maxDeadLettered"; readonly n: number }
  | { readonly kind: "maxLatency"; readonly ticks: number; readonly type: EventTypeId | "any" }
  | { readonly kind: "inOrder"; readonly at: KindId | "anyExternal" };

export interface Hint {
  readonly text: string;
  readonly when:
    | { readonly kind: "telemetry"; readonly on: HintTag; readonly kindId: KindId | "any" }
    | { readonly kind: "tick"; readonly tick: number };
}

export interface Scenario {
  readonly id: ScenarioId;
  readonly title: string;
  readonly brief: string;
  readonly seed: number;
  readonly maxTicks: number;
  readonly width: number;
  readonly height: number;
  /** Row-major, length width * height. */
  readonly terrain: readonly Terrain[];
  readonly preplaced: readonly Placement[];
  readonly unlocked: ReadonlySet<KindId | "belt">;
  readonly budget: ReadonlyMap<KindId, number>;
  readonly faults: readonly Fault[];
  readonly goals: readonly [Goal, ...Goal[]];
  readonly constraints: readonly Constraint[];
  readonly hints: readonly Hint[];
  /** Derived from the solution overlay at load time. */
  readonly solution: readonly Placement[];
  /** Bare map first, then the pack's own. */
  readonly counterexamples: readonly { readonly why: string; readonly placements: readonly Placement[] }[];
}

/**
 * Set only by pack/load.ts, so a caller cannot hand-build a Pack and skip
 * validation. Not exported from the package entry.
 */
export const packBrand: unique symbol = Symbol("event-factory/Pack");

export interface Pack {
  readonly [packBrand]: true;
  readonly id: string;
  readonly title: string;
  readonly doc: string;
  readonly belt: Belt;
  readonly events: ReadonlyMap<EventTypeId, EventType>;
  readonly kinds: ReadonlyMap<KindId, Kind>;
  readonly scenarios: readonly Scenario[];
}
