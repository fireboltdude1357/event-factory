import { Tick, type EntityId, type IdempotencyKey } from "../../ids.js";
import type { SinkKind } from "../../pack/model.js";
import type { Parcel } from "../event-log.js";
import type { Behaviour, Intent } from "./index.js";

export interface SinkState {
  readonly busyUntil: Tick;
  /** Every sink remembers keys, even with dedupe "none", so it can label a duplicate as applied. */
  readonly seen: ReadonlySet<IdempotencyKey>;
  /** Highest root seq seen per source entity, for outOfOrder. */
  readonly lastSeq: ReadonlyMap<EntityId, number>;
  /** The parcel being applied. */
  readonly current: Parcel | null;
  /** deadLetter sinks keep what they took so the inspector can list it. */
  readonly kept: readonly Parcel[];
}

export const sink: Behaviour<SinkKind, SinkState> = {
  init: () => ({ busyUntil: Tick(0), seen: new Set(), lastSeq: new Map(), current: null, kept: [] }),

  // Refusing a wrong type blocks the belt. Sinks never drop.
  accept: (kind, state, parcel, event, ctx) =>
    state.current !== null || (kind.accepts !== "all" && !kind.accepts.has(event.type))
      ? { kind: "refuse" }
      : { kind: "take", state: { ...state, current: parcel, busyUntil: Tick(ctx.tick + kind.ticksPerEvent) } },

  tick: (kind, state, ctx) => {
    const parcel = state.current;
    if (parcel === null || ctx.tick < state.busyUntil) return { state, intents: [], stalled: false };
    const done = { ...state, current: null };
    if (kind.role.kind === "deadLetter") {
      return { state: { ...done, kept: [...state.kept, parcel] }, intents: [{ kind: "deliver", parcel, outcome: "deadLettered" }], stalled: false };
    }

    const event = ctx.log.get(parcel.event);
    const key = event.idempotencyKey;
    const intents: Intent[] = [];
    const seen = state.seen.has(key);
    intents.push({ kind: "deliver", parcel, outcome: !seen ? "delivered" : kind.role.dedupe === "idempotencyKey" ? "duplicateIgnored" : "duplicateApplied" });

    // Order is checked per source entity, on the root of the event's chain.
    let lastSeq = state.lastSeq;
    const root = ctx.log.get(event.correlation).origin;
    if (root.kind === "root") {
      const last = state.lastSeq.get(root.source);
      if (last !== undefined && root.seq < last) intents.push({ kind: "outOfOrder", parcel, expectedAfter: last, seq: root.seq });
      if (last === undefined || root.seq > last) lastSeq = new Map(state.lastSeq).set(root.source, root.seq);
    }
    return { state: { ...done, seen: seen ? state.seen : new Set(state.seen).add(key), lastSeq }, intents, stalled: false };
  },

  holding: (state) => (state.current === null ? [] : [state.current]),
  done: () => true,
};
