// The four building behaviours. Each archetype module exports one `Behaviour`
// and nothing else. `behaviours` is keyed by archetype, so adding a fifth
// archetype is: add it to Kind in pack/model.ts, add a module, and the
// `satisfies` below fails until it is registered. Packs never add archetypes.
//
// Buildings never touch belts or each other. They read their inbox (via
// `accept`) and hand parcels to their own out sides (via `tick` intents);
// movement.ts moves parcels between owners. The only side effects available
// to a behaviour are `ctx.mint` and `ctx.copy`, which create ids and record
// their telemetry, so every parcel in the run is counted.

import type { EntityId, EventId, Tick } from "../../ids.js";
import type { Kind, OutSide, Pack, Predicate, Scenario } from "../../pack/model.js";
import type { EventDraft, EventLog, EventRecord, Parcel } from "../event-log.js";
import type { DropReason } from "../telemetry.js";
import { broker } from "./broker.js";
import { machine } from "./machine.js";
import { sink } from "./sink.js";
import { source } from "./source.js";

export interface TickContext {
  readonly tick: Tick;
  readonly pack: Pack;
  readonly scenario: Scenario;
  readonly entity: EntityId;
  readonly log: Pick<EventLog, "get">;
  /** Out sides that currently have a receiver. */
  readonly linked: readonly OutSide[];
  /** Deterministic roll seeded by the scenario; see rng.ts. Callers pass identity parts only, never positions. */
  roll(...parts: readonly (string | number)[]): number;
  /** Records a new event and returns its first parcel. */
  mint(draft: EventDraft): Parcel;
  /** Another parcel of an existing event. A "duplicate" is drawn as one and counts as a redelivery. */
  copy(event: EventId, why: "fanout" | "duplicate"): Parcel;
}

/** What a building wants done this tick. The sim applies these in order and records telemetry. */
export type Intent =
  | { readonly kind: "send"; readonly parcel: Parcel; readonly side: OutSide }
  | { readonly kind: "drop"; readonly parcel: Parcel; readonly reason: DropReason }
  /** The parcel's work is done and its event lives on in what it produced. */
  | { readonly kind: "consume"; readonly parcel: Parcel }
  | { readonly kind: "deliver"; readonly parcel: Parcel; readonly outcome: "delivered" | "duplicateApplied" | "duplicateIgnored" | "deadLettered" }
  | { readonly kind: "outOfOrder"; readonly parcel: Parcel; readonly expectedAfter: number; readonly seq: number }
  | { readonly kind: "fail"; readonly parcel: Parcel; readonly attempt: number; readonly timing: "beforeEffect" | "afterEffect" }
  | { readonly kind: "retry"; readonly parcel: Parcel; readonly attempt: number; readonly at: Tick };

export type Accepted<S> =
  | { readonly kind: "take"; readonly state: S }
  | { readonly kind: "refuse" }
  | { readonly kind: "discard"; readonly reason: DropReason };

export interface Ticked<S> {
  readonly state: S;
  readonly intents: readonly Intent[];
  /** Has work it could not hand off this tick. The sim turns changes into stalled/unstalled telemetry. */
  readonly stalled: boolean;
}

export interface Behaviour<K extends Kind, S> {
  init(kind: K): S;
  /**
   * Offered `parcel` from the back side. "refuse" leaves it on the belt, which
   * is backpressure. "discard" takes it off the belt and loses it.
   */
  accept(kind: K, state: S, parcel: Parcel, event: EventRecord, ctx: TickContext): Accepted<S>;
  /**
   * Advance one tick. `claim(side)` is true, and reserves the side, when that
   * out side is linked and its buffer is empty. Call it only to send.
   */
  tick(kind: K, state: S, ctx: TickContext, claim: (side: OutSide) => boolean): Ticked<S>;
  /** Parcels this building holds, for drop-on-remove, conservation, and the inspector. */
  holding(state: S): readonly Parcel[];
  /** True once this building will never create another event on its own. Only sources ever say false. */
  done(kind: K, state: S): boolean;
}

type StateOf<B> = B extends Behaviour<infer _, infer S> ? S : never;

export const behaviours = {
  source,
  broker,
  machine,
  sink,
} as const satisfies { readonly [A in Kind["archetype"]]: Behaviour<Extract<Kind, { archetype: A }>, unknown> };

/** Per-entity state, discriminated by archetype. */
export type EntityState = {
  [A in keyof typeof behaviours]: { readonly archetype: A; readonly state: StateOf<(typeof behaviours)[A]> };
}[keyof typeof behaviours];

/** Pure. Evaluates a resolved predicate against an event. Shared by recipes and faults. */
export function matches(predicate: Predicate | null, event: EventRecord): boolean {
  if (predicate === null) return true;
  switch (predicate.kind) {
    case "is":
      return event.payload[predicate.field] === predicate.value;
    case "oneOf": {
      const value = event.payload[predicate.field];
      return value !== undefined && predicate.values.includes(value);
    }
    case "range": {
      const value = event.payload[predicate.field];
      if (typeof value !== "number") return false;
      return (predicate.above === undefined || value > predicate.above) && (predicate.below === undefined || value < predicate.below);
    }
    case "version":
      return event.version === predicate.version;
    case "all":
      return predicate.of.every((p) => matches(p, event));
    case "any":
      return predicate.of.some((p) => matches(p, event));
    case "not":
      return !matches(predicate.of, event);
  }
}
