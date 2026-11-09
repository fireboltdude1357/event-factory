import type { BrokerKind, OutSide } from "../../pack/model.js";
import type { Parcel } from "../event-log.js";
import type { Behaviour, Intent } from "./index.js";

/**
 * Queue and topic share one archetype because they share everything except
 * who gets a parcel. The state union keeps the two buffer shapes apart.
 */
export type BrokerState =
  | { readonly delivery: "competing"; readonly buffer: readonly Parcel[]; readonly cursor: number }
  | {
      readonly delivery: "fanout";
      readonly buffers: ReadonlyMap<OutSide, readonly Parcel[]>;
      /** Copies a full subscriber missed under whenFull "drop"; dropped on the next tick. */
      readonly missed: readonly Parcel[];
    };

const sides: readonly OutSide[] = ["front", "left", "right"];

export const broker: Behaviour<BrokerKind, BrokerState> = {
  init: (kind) =>
    kind.delivery === "competing" ? { delivery: "competing", buffer: [], cursor: 0 } : { delivery: "fanout", buffers: new Map(), missed: [] },

  accept: (kind, state, parcel, event, ctx) => {
    if (state.delivery === "competing") {
      // A queue with no consumer yet holds messages until one arrives.
      if (state.buffer.length < kind.capacity) return { kind: "take", state: { ...state, buffer: [...state.buffer, parcel] } };
      return kind.whenFull === "block" ? { kind: "refuse" } : { kind: "discard", reason: "brokerFull" };
    }

    // A subscriber linked later sees only events published after it linked.
    const subscribers = ctx.linked;
    if (subscribers.length === 0) return { kind: "discard", reason: "noSubscribers" };
    const hasRoom = (side: OutSide) => (state.buffers.get(side)?.length ?? 0) < kind.capacity;
    if (kind.whenFull === "block" && !subscribers.every(hasRoom)) return { kind: "refuse" };

    const buffers = new Map(state.buffers);
    const missed = [...state.missed];
    subscribers.forEach((side, i) => {
      const copy = i === 0 ? parcel : ctx.copy(event.id, "fanout");
      if (hasRoom(side)) buffers.set(side, [...(buffers.get(side) ?? []), copy]);
      else missed.push(copy);
    });
    return { kind: "take", state: { delivery: "fanout", buffers, missed } };
  },

  tick: (_kind, state, ctx, claim) => {
    const intents: Intent[] = [];
    if (state.delivery === "competing") {
      // One parcel per consumer side per tick. A slow consumer's side is full
      // more often, so it gets fewer: load balancing emerges.
      const buffer = [...state.buffer];
      let cursor = state.cursor;
      for (let i = 0; i < sides.length && buffer.length > 0; i++) {
        const at = (state.cursor + i) % sides.length;
        const side = sides[at];
        if (side === undefined || !claim(side)) continue;
        const parcel = buffer.shift();
        if (parcel !== undefined) intents.push({ kind: "send", parcel, side });
        cursor = (at + 1) % sides.length;
      }
      return { state: { ...state, buffer, cursor }, intents, stalled: buffer.length > 0 && intents.length === 0 };
    }

    const buffers = new Map<OutSide, readonly Parcel[]>();
    for (const [side, queue] of state.buffers) {
      const [head, ...rest] = queue;
      if (head !== undefined && claim(side)) {
        intents.push({ kind: "send", parcel: head, side });
        buffers.set(side, rest);
      } else buffers.set(side, queue);
    }
    for (const parcel of state.missed) intents.push({ kind: "drop", parcel, reason: "brokerFull" });
    const holding = [...buffers.values()].some((q) => q.length > 0);
    return { state: { delivery: "fanout", buffers, missed: [] }, intents, stalled: holding && intents.length === 0 };
  },

  holding: (state) => (state.delivery === "competing" ? state.buffer : [...[...state.buffers.values()].flat(), ...state.missed]),
  done: () => true,
};
