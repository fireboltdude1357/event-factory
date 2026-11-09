import { Tick } from "../../ids.js";
import type { Fault, MachineKind, OutSide, Recipe } from "../../pack/model.js";
import type { EventRecord, Parcel } from "../event-log.js";
import { matches, type Behaviour, type Intent, type TickContext } from "./index.js";

type Backoff = { readonly phase: "backoff"; readonly parcel: Parcel; readonly recipe: number; readonly attempt: number; readonly resumeAt: Tick };

/**
 * A worker slot moves through these states. The union is the retry state
 * machine; there is no `isRetrying` flag to get out of sync with `doneAt`.
 */
export type Slot =
  | { readonly phase: "idle" }
  | { readonly phase: "working"; readonly parcel: Parcel; readonly recipe: number; readonly attempt: number; readonly doneAt: Tick }
  | Backoff
  /**
   * Outputs waiting for their sides: emits, a parcel bound for the DLQ port,
   * or both. Already-minted outputs are never re-minted. `then` is where the
   * slot goes once the outbox is empty: a pending retry, or idle.
   */
  | { readonly phase: "sending"; readonly outbox: readonly Outgoing[]; readonly then: Backoff | null };

interface Outgoing {
  readonly side: OutSide;
  readonly parcel: Parcel;
}

export interface MachineState {
  readonly slots: readonly Slot[];
}

const idle: Slot = { phase: "idle" };

/** First recipe whose type and predicate match, or none. Pure; shared with the inspector. */
export function matchRecipe(kind: MachineKind, event: EventRecord): Recipe | null {
  return kind.recipes.find((r) => r.consume === event.type && matches(r.where, event)) ?? null;
}

export const machine: Behaviour<MachineKind, MachineState> = {
  init: (kind) => ({ slots: Array.from({ length: kind.workers }, () => idle) }),

  accept: (kind, state, parcel, event, ctx) => {
    const recipe = matchRecipe(kind, event);
    // Refusing leaves the parcel at the belt head and blocks the line, which
    // is what an unhandled message type does to a strict consumer.
    if (recipe === null && kind.unmatched.kind === "refuse") return { kind: "refuse" };
    if (recipe === null && kind.unmatched.kind === "drop") return { kind: "discard", reason: "unmatched" };
    const free = state.slots.findIndex((s) => s.phase === "idle");
    if (free < 0) return { kind: "refuse" };
    const slot: Slot =
      recipe !== null
        ? { phase: "working", parcel, recipe: recipe.index, attempt: 1, doneAt: Tick(ctx.tick + recipe.ticks) }
        : { phase: "sending", outbox: kind.unmatched.kind === "route" ? [{ side: kind.unmatched.port.side, parcel }] : [], then: null };
    return { kind: "take", state: { slots: state.slots.map((s, i) => (i === free ? slot : s)) } };
  },

  tick: (kind, state, ctx, claim) => {
    const intents: Intent[] = [];
    let stalled = false;

    const flush = (outbox: readonly Outgoing[], then: Backoff | null): Slot => {
      const left = outbox.filter((o) => {
        if (!claim(o.side)) return true;
        intents.push({ kind: "send", parcel: o.parcel, side: o.side });
        return false;
      });
      if (left.length > 0) {
        stalled = true;
        return { phase: "sending", outbox: left, then };
      }
      return then ?? idle;
    };

    const complete = (slot: Extract<Slot, { phase: "working" }>): Slot => {
      const event = ctx.log.get(slot.parcel.event);
      const recipe = kind.recipes[slot.recipe];
      if (recipe === undefined) return idle;
      const fault = faultFor(kind, event, slot.attempt, ctx);
      if (fault === null) {
        if (!recipe.emit.some((e) => e.kind === "forward")) intents.push({ kind: "consume", parcel: slot.parcel });
        return flush(outputs(kind, recipe, slot.parcel, event, ctx, true), null);
      }

      intents.push({ kind: "fail", parcel: slot.parcel, attempt: slot.attempt, timing: fault.timing });
      // After the effect, the outputs already happened. The retry will make them
      // again: new event ids, same idempotency keys.
      const outbox = fault.timing === "afterEffect" ? outputs(kind, recipe, slot.parcel, event, ctx, false) : [];
      if (slot.attempt < kind.failures.maxAttempts) {
        const resumeAt = Tick(ctx.tick + delay(kind, slot.attempt));
        intents.push({ kind: "retry", parcel: slot.parcel, attempt: slot.attempt + 1, at: resumeAt });
        return flush(outbox, { phase: "backoff", parcel: slot.parcel, recipe: slot.recipe, attempt: slot.attempt + 1, resumeAt });
      }
      const exhausted = kind.failures.exhausted;
      if (exhausted.kind === "drop") {
        intents.push({ kind: "drop", parcel: slot.parcel, reason: "exhausted" });
        return flush(outbox, null);
      }
      return flush([...outbox, { side: exhausted.port.side, parcel: slot.parcel }], null);
    };

    // The slot stays occupied during backoff. Retries cost throughput, on purpose.
    const slots = state.slots.map((slot): Slot => {
      switch (slot.phase) {
        case "idle":
          return slot;
        case "working":
          return ctx.tick >= slot.doneAt ? complete(slot) : slot;
        case "backoff": {
          if (ctx.tick < slot.resumeAt) return slot;
          const ticks = kind.recipes[slot.recipe]?.ticks ?? 0;
          return { phase: "working", parcel: slot.parcel, recipe: slot.recipe, attempt: slot.attempt, doneAt: Tick(ctx.tick + ticks) };
        }
        case "sending":
          return flush(slot.outbox, slot.then);
      }
    });
    return { state: { slots }, intents, stalled };
  },

  holding: (state) =>
    state.slots.flatMap((slot) => {
      switch (slot.phase) {
        case "idle":
          return [];
        case "working":
        case "backoff":
          return [slot.parcel];
        case "sending":
          return [...slot.outbox.map((o) => o.parcel), ...(slot.then === null ? [] : [slot.then.parcel])];
      }
    }),
  done: () => true,
};

function delay(kind: MachineKind, attempt: number): number {
  const { backoff } = kind.failures;
  return backoff.kind === "fixed" ? backoff.ticks : backoff.ticks * 2 ** (attempt - 1);
}

/** The first scenario fault that applies to this attempt. Rolls hash the event's key, never its position. */
function faultFor(kind: MachineKind, event: EventRecord, attempt: number, ctx: TickContext): Fault | null {
  for (const [index, fault] of ctx.scenario.faults.entries()) {
    if (!fault.kinds.has(kind.id) || (fault.event !== "any" && fault.event !== event.type) || !matches(fault.where, event)) continue;
    if (ctx.roll("fault", index, event.idempotencyKey, attempt) < fault.chance) return fault;
  }
  return null;
}

/**
 * The recipe's emits as parcels. On success the input parcel itself goes out
 * on the first forward. After an afterEffect fault the input stays for the
 * retry, so every forward is a fresh copy.
 */
function outputs(kind: MachineKind, recipe: Recipe, input: Parcel, event: EventRecord, ctx: TickContext, reuseInput: boolean): Outgoing[] {
  let inputUsed = !reuseInput;
  return recipe.emit.map((emit, index): Outgoing => {
    if (emit.kind === "forward") {
      const parcel = inputUsed ? ctx.copy(event.id, reuseInput ? "fanout" : "duplicate") : input;
      inputUsed = true;
      return { side: emit.port.side, parcel };
    }
    const payload = { ...Object.fromEntries(emit.copy.map((f) => [f, event.payload[f] ?? ""])), ...emit.set };
    const version = ctx.pack.events.get(emit.type)?.version ?? 1;
    const parcel = ctx.mint({ type: emit.type, version, payload, origin: { kind: "caused", by: event.id, machineKind: kind.id, recipe: recipe.index, emit: index } });
    return { side: emit.port.side, parcel };
  });
}
