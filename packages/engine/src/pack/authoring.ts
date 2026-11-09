// What a pack author (usually an agent) writes. Published as
// `@event-factory/engine/author`.
//
// The three define* functions return their argument unchanged. They exist so
// `const` inference can check cross-references in the editor: a recipe that
// consumes an undeclared event type, a goal that names a machine as a sink, a
// machine that emits on a port it never declared, a produced event missing a
// field neither `copy` nor `set` supplies. pack/load.ts re-checks every
// one of these at runtime, so a pack that was never type-checked still fails
// `pack:check` with the same messages. The types are editor feedback, the
// loader is the gate.

// ---------- events ----------

/** A payload field. A tuple of strings is an enum. */
export type FieldType = "string" | "number" | "boolean" | readonly [string, ...string[]];

export type FieldValue<F extends FieldType> = F extends "string"
  ? string
  : F extends "number"
    ? number
    : F extends "boolean"
      ? boolean
      : F extends readonly (infer L)[]
        ? L
        : never;

export interface EventDecl {
  /** Markdown shown in the inspector. Write it in the company's own words. */
  readonly doc: string;
  readonly fields: { readonly [name: string]: FieldType };
  /**
   * Fields that identify the business operation, e.g. `["orderId"]`. The
   * idempotency key becomes `OrderPlaced:"ord-14"`, the type and the JSON of
   * the value (an array of values for several fields), which is what real
   * systems dedupe on. Omit it and the key is derived from causation instead.
   */
  readonly key?: readonly string[];
  /** Schema version producers stamp on new events. Default 1. */
  readonly version?: number;
  readonly color?: `#${string}`;
}

export type EventDecls = { readonly [type: string]: EventDecl };

type FieldName<E extends EventDecl> = keyof E["fields"] & string;

export type Payload<E extends EventDecl> = {
  readonly [F in FieldName<E>]: FieldValue<E["fields"][F]>;
};

/** A source payload value. `{ seq: "ord-" }` becomes "ord-1", "ord-2", ... per emitted event. */
export type FieldTemplate<F extends FieldType> = FieldValue<F> | (F extends "string" ? { readonly seq: string } : never);

export type PayloadTemplate<E extends EventDecl> = {
  readonly [F in FieldName<E>]: FieldTemplate<E["fields"][F]>;
};

/** Content predicate over one event type's payload. Plain data, so the inspector can print it. */
export type Where<E extends EventDecl> =
  | {
      [F in FieldName<E>]:
        | { readonly field: F; readonly is: FieldValue<E["fields"][F]> }
        | { readonly field: F; readonly oneOf: readonly FieldValue<E["fields"][F]>[] }
        // Written this way round so a generic FieldType (which includes "number") keeps the range form.
        | ("number" extends E["fields"][F] ? { readonly field: F; readonly above: number; readonly below?: number } | { readonly field: F; readonly below: number } : never);
    }[FieldName<E>]
  | { readonly version: number }
  | { readonly all: readonly Where<E>[] }
  | { readonly any: readonly Where<E>[] }
  | { readonly not: Where<E> };

// ---------- kinds ----------

/** Relative to the building's facing. Input is always "back". */
export type Side = "front" | "back" | "left" | "right";
export type OutSide = Exclude<Side, "back">;
export type Facing = "north" | "east" | "south" | "west";

/** The one belt every pack has: the wire between buildings. Packs rename and document it. */
export interface BeltDecl {
  readonly title: string;
  readonly doc: string;
  readonly ticksPerTile: number;
}

interface KindBase {
  readonly title: string;
  readonly doc: string;
  /** One character drawn on the building. */
  readonly glyph?: string;
}

type EventName<Es extends EventDecls> = keyof Es & string;

export interface SourceDecl<Es extends EventDecls> extends KindBase {
  readonly archetype: "source";
  readonly emits: readonly {
    [T in EventName<Es>]: {
      readonly type: T;
      /** Ticks between emissions. */
      readonly every: number;
      /** Total to emit. Omit for an endless stream. */
      readonly count?: number;
      readonly payloads: readonly {
        readonly weight?: number;
        readonly values: PayloadTemplate<Es[T]>;
        /** Defaults to the event's declared version. Mix versions to teach a version gate. */
        readonly version?: number;
      }[];
      /** At-least-once publisher: chance the same event is sent twice. */
      readonly duplicateChance?: number;
    };
  }[EventName<Es>][];
  /** What happens when the front link is full. "drop" loses events; "wait" pushes back. */
  readonly whenBlocked: "wait" | "drop";
}

/** Queue ("competing") or topic ("fanout"). Input on back, consumers on any linked out side. */
export interface BrokerDecl extends KindBase {
  readonly archetype: "broker";
  readonly delivery: "competing" | "fanout";
  /** Buffered parcels. For fanout, per consumer. */
  readonly capacity: number;
  readonly whenFull: "block" | "drop";
}

type SameType<A extends FieldType, B extends FieldType> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** Fields present on both events with the same FieldType. */
type CopyableField<From extends EventDecl, To extends EventDecl> = {
  [F in FieldName<From> & FieldName<To>]: SameType<From["fields"][F], To["fields"][F]> extends true ? F : never;
}[FieldName<From> & FieldName<To>];

type Disposal<P extends string> = "drop" | { readonly route: P };

type Emit<Es extends EventDecls, In extends EventName<Es>, P extends string> =
  | { readonly forward: P }
  | {
      [Out in EventName<Es>]: {
        readonly port: P;
        readonly produce: Out;
        /** Fields copied from the consumed event. Must exist on both with the same type (checked by CheckKinds). */
        readonly copy?: readonly (FieldName<Es[Out]> & FieldName<Es[In]>)[];
        readonly set?: Partial<Payload<Es[Out]>>;
      };
    }[EventName<Es>];

type Recipe<Es extends EventDecls, P extends string> = {
  [T in EventName<Es>]: {
    readonly consume: T;
    readonly where?: Where<Es[T]>;
    /** Work time. 0 makes the machine a router or filter. */
    readonly ticks: number;
    readonly emit: readonly Emit<Es, T, P>[];
  };
}[EventName<Es>];

export interface MachineDecl<Es extends EventDecls, P extends string> extends KindBase {
  readonly archetype: "machine";
  readonly outputs: { readonly [port in P]: OutSide };
  /** Parallel work slots. */
  readonly workers: number;
  /** First match wins. A recipe with `ticks: 0` and only `forward` emits is a router. */
  readonly recipes: readonly Recipe<Es, P>[];
  /** An input no recipe matches. "refuse" leaves it on the belt and blocks the line. */
  readonly unmatched: "refuse" | Disposal<P>;
  readonly failures: {
    /** 1 means no retry. */
    readonly maxAttempts: number;
    readonly backoff?: { readonly fixed: number } | { readonly doubling: number };
    readonly exhausted: Disposal<P>;
  };
}

export interface SinkDecl<Es extends EventDecls> extends KindBase {
  readonly archetype: "sink";
  /** Omit to accept every type. Others are refused. */
  readonly accepts?: readonly EventName<Es>[];
  readonly ticksPerEvent: number;
  readonly role:
    | { readonly kind: "external"; readonly dedupe: "none" | "idempotencyKey" }
    | { readonly kind: "deadLetter" };
}

export type KindDecl<Es extends EventDecls> =
  | SourceDecl<Es>
  | BrokerDecl
  | MachineDecl<Es, string>
  | SinkDecl<Es>;

export type Archetype = KindDecl<EventDecls>["archetype"];

/**
 * Narrows each machine's port names to the keys of its own `outputs`, and
 * each `copy` to fields both events declare with the same type. The copy
 * check maps over the recipes actually written rather than every pair of
 * event types, so editor time grows with the pack, not with events squared.
 */
type CheckKinds<Es extends EventDecls, Ks> = {
  readonly [K in keyof Ks]: Ks[K] extends { readonly archetype: "machine"; readonly outputs: infer O; readonly recipes: infer Rs }
    ? Omit<MachineDecl<Es, keyof O & string>, "recipes"> & { readonly recipes: CheckRecipes<Es, keyof O & string, Rs> }
    : Ks[K];
};

type CheckRecipes<Es extends EventDecls, P extends string, Rs> = {
  readonly [I in keyof Rs]: Rs[I] extends { readonly consume: infer In extends EventName<Es>; readonly emit: infer Em }
    ? {
        readonly consume: In;
        readonly where?: Where<Es[In]>;
        readonly ticks: number;
        readonly emit: { readonly [J in keyof Em]: CheckEmit<Es, In, P, Em[J]> };
      }
    : Recipe<Es, P>;
};

type CheckEmit<Es extends EventDecls, In extends EventName<Es>, P extends string, E> = E extends { readonly produce: infer Out extends EventName<Es> }
  ? {
      readonly port: P;
      readonly produce: Out;
      readonly copy?: readonly CopyableField<Es[In], Es[Out]>[];
    } & CoveringSet<Es[Out], Exclude<FieldName<Es[Out]>, CopiedField<E> | SetField<E>>>
  : Emit<Es, In, P>;

type CopiedField<E> = E extends { readonly copy: readonly (infer F)[] } ? F : never;
type SetField<E> = E extends { readonly set: infer S } ? RequiredKey<S> : never;
type RequiredKey<S> = { [K in keyof S]-?: {} extends Pick<S, K> ? never : K }[keyof S];

/** `set` becomes required, with every field that `copy` leaves out. */
type CoveringSet<Out extends EventDecl, Missing extends string> = [Missing] extends [never]
  ? { readonly set?: Partial<Payload<Out>> }
  : { readonly set: Partial<Payload<Out>> & Pick<Payload<Out>, Missing> };

export interface CatalogDecl<Es extends EventDecls, Ks extends { readonly [id: string]: KindDecl<Es> }> {
  readonly belt: BeltDecl;
  readonly events: Es;
  readonly kinds: Ks;
}

export type AnyCatalog = CatalogDecl<EventDecls, { readonly [id: string]: KindDecl<EventDecls> }>;

/** Narrows each event's `key` to its own field names. */
type CheckEvents<Es extends EventDecls> = {
  readonly [T in keyof Es]: { readonly key?: readonly FieldName<Es[T]>[] };
};

export function defineCatalog<
  const Es extends EventDecls,
  const Ks extends { readonly [id: string]: KindDecl<NoInfer<Es>> },
>(catalog: {
  readonly belt: BeltDecl;
  readonly events: Es & CheckEvents<NoInfer<Es>>;
  readonly kinds: Ks & CheckKinds<NoInfer<Es>, Ks>;
}): CatalogDecl<Es, Ks> {
  return catalog;
}

// ---------- scenarios ----------

type EventsOf<C> = C extends CatalogDecl<infer Es, infer _> ? Es : never;
type KindsOf<C> = C extends CatalogDecl<infer _, infer Ks> ? Ks : never;

export type KindName<C, A extends Archetype = Archetype> = {
  [K in keyof KindsOf<C>]: KindsOf<C>[K] extends { readonly archetype: A } ? K : never;
}[keyof KindsOf<C>] &
  string;

/** Sinks with `role: { kind: "external" }`. Goals and `inOrder` count only what these apply. */
export type ExternalSinkName<C> = {
  [K in keyof KindsOf<C>]: KindsOf<C>[K] extends { readonly archetype: "sink"; readonly role: { readonly kind: "external" } } ? K : never;
}[keyof KindsOf<C>] &
  string;

export interface LegendEntry<C> {
  readonly kind: KindName<C>;
  readonly facing: Facing;
  /** Map entries default to locked (the player cannot move them). Ignored in solution and counterexample overlays. */
  readonly locked?: boolean;
}

/**
 * Map rows. `.` floor, `#` wall, `> < ^ v` belt, any other character is looked up in `legend`.
 * All rows have the same length.
 */
export type AsciiMap = readonly string[];

export type Goal<C> = {
  readonly deliver: number;
  readonly type?: keyof EventsOf<C> & string;
  readonly at?: ExternalSinkName<C>;
};

/** Constraints are monotone counts: once violated, violated for good. */
export type Constraint<C> =
  | { readonly kind: "noLoss" }
  | { readonly kind: "noDuplicateEffects" }
  | { readonly kind: "maxDeadLettered"; readonly n: number }
  | { readonly kind: "maxLatency"; readonly ticks: number; readonly type?: keyof EventsOf<C> & string }
  | { readonly kind: "inOrder"; readonly at?: ExternalSinkName<C> };

/** Scenario-level chaos. Kinds describe the code; faults describe the environment. */
export type Fault<C> = {
  [T in keyof EventsOf<C> & string]: {
    readonly kinds: readonly [KindName<C, "machine">, ...KindName<C, "machine">[]];
    readonly event?: T;
    readonly where?: Where<EventsOf<C>[T]>;
    /** Omit for "always" (a poison message). */
    readonly chance?: number;
    /** "afterEffect" emits the outputs and then fails, so a retry duplicates them. */
    readonly timing: "beforeEffect" | "afterEffect";
  };
}[keyof EventsOf<C> & string];

export type { HintTag } from "../sim/telemetry.js";
import type { HintTag } from "../sim/telemetry.js";

export interface Hint<C> {
  readonly text: string;
  /** Shown the first time this happens. */
  readonly when: { readonly on: HintTag; readonly kind?: KindName<C> } | { readonly tick: number };
}

export interface ScenarioDecl<C> {
  readonly id: string;
  readonly title: string;
  /** Markdown shown before the level starts. */
  readonly brief: string;
  /** An integer from 0 to 2^32 - 1. Changing it changes the level's luck. */
  readonly seed: number;
  readonly maxTicks: number;
  readonly map: AsciiMap;
  readonly legend: { readonly [char: string]: LegendEntry<C> };
  readonly unlocked: readonly (KindName<C> | "belt")[];
  readonly budget?: { readonly [K in KindName<C>]?: number };
  readonly faults?: readonly Fault<C>[];
  readonly goals: readonly [Goal<C>, ...Goal<C>[]];
  readonly constraints?: readonly Constraint<C>[];
  readonly hints?: readonly Hint<C>[];
  /** Overlay of the same size as `map`. `.` keeps the map cell. Must win. */
  readonly solution: { readonly map: AsciiMap; readonly legend: { readonly [char: string]: LegendEntry<C> } };
  /**
   * Layouts that must NOT win, each with the lesson it proves. pack:check
   * always adds the bare map (nothing placed) as an implicit counterexample.
   * A level whose wrong answer also wins teaches nothing; this is how the
   * check catches that.
   */
  readonly counterexamples?: readonly {
    readonly why: string;
    readonly map: AsciiMap;
    readonly legend: { readonly [char: string]: LegendEntry<C> };
  }[];
}

/** For levels in their own files. `catalog` is only used for inference. */
export function defineScenario<const C extends AnyCatalog>(_catalog: C, scenario: ScenarioDecl<C>): ScenarioDecl<C> {
  return scenario;
}

export interface PackDecl<C> {
  readonly id: string;
  readonly title: string;
  readonly doc: string;
  readonly catalog: C;
  /** Play order. */
  readonly scenarios: readonly [ScenarioDecl<C>, ...ScenarioDecl<C>[]];
}

export function definePack<const C extends AnyCatalog>(pack: PackDecl<C>): PackDecl<C> {
  return pack;
}
