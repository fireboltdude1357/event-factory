import { Tick } from "../../ids.js";
import type { FieldValue, Payload, SourceKind } from "../../pack/model.js";
import type { Parcel } from "../event-log.js";
import { pickWeighted } from "../rng.js";
import type { Behaviour, Intent } from "./index.js";

/** One entry per `emits` stream. */
export interface SourceState {
  readonly streams: readonly { readonly sent: number; readonly nextAt: Tick; readonly waiting: boolean }[];
  /** Order across streams; feeds order checks. */
  readonly seq: number;
  /** Publisher duplicates waiting for the front side. They go before new events. */
  readonly redeliver: readonly Parcel[];
}

export const source: Behaviour<SourceKind, SourceState> = {
  init: (kind) => ({ streams: kind.emits.map(() => ({ sent: 0, nextAt: Tick(0), waiting: false })), seq: 0, redeliver: [] }),
  // Sources have no back input.
  accept: () => ({ kind: "refuse" }),
  tick: (kind, state, ctx, claim) => {
    const intents: Intent[] = [];
    const redeliver = [...state.redeliver];
    let seq = state.seq;
    let frontUsed = false;
    const head = redeliver[0];
    if (head !== undefined && claim("front")) {
      redeliver.shift();
      intents.push({ kind: "send", parcel: head, side: "front" });
      frontUsed = true;
    }

    const streams = state.streams.map((stream, index) => {
      const spec = kind.emits[index];
      if (spec === undefined || (spec.count !== "endless" && stream.sent >= spec.count) || ctx.tick < stream.nextAt) return stream;
      const send = !frontUsed && claim("front");
      if (!send && kind.whenBlocked === "wait") return { ...stream, waiting: true };

      const n = stream.sent + 1;
      const [first, ...rest] = spec.payloads.map((p) => ({ weight: p.weight, value: p }));
      if (first === undefined) return stream;
      const picked = pickWeighted(ctx.roll(kind.id, "payload", index, n), [first, ...rest]);
      const payload: Payload = Object.fromEntries(
        Object.entries(picked.values).map(([field, value]): [string, FieldValue] => [field, typeof value === "object" ? `${value.seq}${n}` : value]),
      );
      seq += 1;
      const parcel = ctx.mint({
        type: spec.type,
        version: picked.version,
        payload,
        origin: { kind: "root", source: ctx.entity, sourceKind: kind.id, stream: index, n, seq },
      });
      if (send) {
        frontUsed = true;
        intents.push({ kind: "send", parcel, side: "front" });
        if (ctx.roll(kind.id, "dup", index, n) < spec.duplicateChance) redeliver.push(ctx.copy(parcel.event, "duplicate"));
      } else {
        // Minting before dropping means the lost event has an id the player can trace.
        intents.push({ kind: "drop", parcel, reason: "sourceBlocked" });
      }
      return { sent: n, nextAt: Tick(ctx.tick + spec.every), waiting: false };
    });

    return { state: { streams, seq, redeliver }, intents, stalled: streams.some((s) => s.waiting) || (redeliver.length > 0 && !frontUsed) };
  },
  holding: (state) => state.redeliver,
  done: (kind, state) =>
    state.redeliver.length === 0 && kind.emits.every((spec, i) => spec.count !== "endless" && (state.streams[i]?.sent ?? 0) >= spec.count),
};
