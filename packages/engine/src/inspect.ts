// Docs and live facts for anything the player clicks. Docs text comes only
// from the pack, so a ported game documents the company's real system.

import type { EntityId, EventId, EventTypeId, KindId } from "./ids.js";
import type { Kind, Point } from "./pack/model.js";
import type { EntityState } from "./sim/archetypes/index.js";
import type { EventRecord } from "./sim/event-log.js";
import { trace, type SimView, type Trace } from "./sim/sim.js";
import { cellOf } from "./sim/world.js";

export type InspectTarget =
  | { readonly kind: "cell"; readonly at: Point } //       whatever is there: building, belt, parcel
  | { readonly kind: "entity"; readonly entity: EntityId }
  | { readonly kind: "event"; readonly event: EventId }
  | { readonly kind: "kind"; readonly id: KindId } //      palette tooltip
  | { readonly kind: "eventType"; readonly id: EventTypeId };

export type Fact =
  | { readonly kind: "text"; readonly label: string; readonly value: string }
  | { readonly kind: "count"; readonly label: string; readonly value: number }
  | { readonly kind: "event"; readonly label: string; readonly event: EventId } //  clickable
  | { readonly kind: "payload"; readonly fields: readonly { readonly name: string; readonly value: string }[] };

export interface Inspection {
  readonly title: string;
  /** Markdown from the pack. */
  readonly doc: string;
  /** e.g. "Handler", "Queue", "Topic", "Dead-letter queue": the engine's name for the archetype config. */
  readonly role: string;
  readonly facts: readonly Fact[];
  /** Present when the target is an event, or a cell holding one. */
  readonly trace: Trace | null;
}

/** What a kind does, one step finer than its archetype. The map draws a building from this. */
export type BuildingShape = "producer" | "queue" | "topic" | "handler" | "router" | "external" | "deadLetter";

/** Derived, never declared, so the shape always matches what the kind does. */
export function shapeOf(kind: Kind): BuildingShape {
  switch (kind.archetype) {
    case "source":
      return "producer";
    case "broker":
      return kind.delivery === "competing" ? "queue" : "topic";
    case "machine":
      return kind.recipes.length > 0 && kind.recipes.every((r) => r.ticks === 0 && r.emit.every((e) => e.kind === "forward")) ? "router" : "handler";
    case "sink":
      return kind.role.kind === "deadLetter" ? "deadLetter" : "external";
  }
}

const roleNames: Readonly<Record<BuildingShape, string>> = {
  producer: "Producer",
  queue: "Queue",
  topic: "Topic",
  handler: "Handler",
  router: "Router",
  external: "External system",
  deadLetter: "Dead-letter queue",
};

export const roleOf = (kind: Kind): string => roleNames[shapeOf(kind)];

/** A probability in whole percent that never rounds a possible outcome to 0% or a possible miss to 100%. */
function percent(p: number): string {
  const rounded = Math.round(p * 100);
  return rounded === 0 && p > 0 ? "<1%" : rounded === 100 && p < 1 ? ">99%" : `${rounded}%`;
}

function kindFacts(kind: Kind): Fact[] {
  switch (kind.archetype) {
    case "source":
      return kind.emits.map((s) => ({
        kind: "text",
        label: "Publishes",
        value: `${s.type} every ${s.every} ticks${s.count === "endless" ? "" : `, ${s.count} total`}${s.duplicateChance > 0 ? `, ${percent(s.duplicateChance)} sent twice` : ""}`,
      }));
    case "broker":
      return [
        { kind: "text", label: "Delivery", value: kind.delivery === "competing" ? "each event to one consumer" : "each event to every linked consumer" },
        { kind: "count", label: "Capacity", value: kind.capacity },
        { kind: "text", label: "When full", value: kind.whenFull === "block" ? "pushes back" : "drops" },
      ];
    case "machine":
      return [
        ...kind.recipes.map((r): Fact => ({
          kind: "text",
          label: `Consumes ${r.consume}`,
          value: r.emit.map((e) => (e.kind === "forward" ? `forwards to ${e.port.id}` : `produces ${e.type} on ${e.port.id}`)).join(", ") + ` (${r.ticks} ticks)`,
        })),
        { kind: "count", label: "Workers", value: kind.workers },
        { kind: "count", label: "Max attempts", value: kind.failures.maxAttempts },
        { kind: "text", label: "When retries run out", value: kind.failures.exhausted.kind === "drop" ? "drops the event" : `sends it to ${kind.failures.exhausted.port.id}` },
      ];
    case "sink":
      return [
        { kind: "text", label: "Accepts", value: kind.accepts === "all" ? "everything" : [...kind.accepts].join(", ") },
        ...(kind.role.kind === "external" ? [{ kind: "text" as const, label: "Dedupe", value: kind.role.dedupe === "idempotencyKey" ? "by idempotency key" : "none" }] : []),
        { kind: "count", label: "Ticks per event", value: kind.ticksPerEvent },
      ];
  }
}

function liveFacts(sim: SimView, entity: EntityId, state: EntityState): Fact[] {
  const facts: Fact[] = [];
  if (sim.stalled.has(entity)) facts.push({ kind: "text", label: "Status", value: "stalled: cannot hand off" });
  switch (state.archetype) {
    case "source":
      facts.push({ kind: "count", label: "Published", value: state.state.streams.reduce((n, s) => n + s.sent, 0) });
      break;
    case "broker":
      facts.push({
        kind: "count",
        label: "Buffered",
        value: state.state.delivery === "competing" ? state.state.buffer.length : [...state.state.buffers.values()].reduce((n, b) => n + b.length, 0),
      });
      break;
    case "machine":
      state.state.slots.forEach((slot, i) => {
        if (slot.phase === "idle") return;
        const parcel = slot.phase === "sending" ? (slot.outbox[0]?.parcel ?? slot.then?.parcel) : slot.parcel;
        const attempt = slot.phase === "sending" ? "" : ` (attempt ${slot.attempt})`;
        if (parcel !== undefined) facts.push({ kind: "event", label: `Worker ${i + 1}: ${slot.phase}${attempt}`, event: parcel.event });
      });
      break;
    case "sink":
      if (state.state.current !== null) facts.push({ kind: "event", label: "Applying", event: state.state.current.event });
      facts.push({ kind: "count", label: "Keys seen", value: state.state.seen.size });
      state.state.kept.slice(-5).forEach((p) => facts.push({ kind: "event", label: "Parked", event: p.event }));
      break;
  }
  return facts;
}

function eventInspection(sim: SimView, record: EventRecord): Inspection {
  const type = sim.pack.events.get(record.type);
  const t = trace(sim, record.id);
  return {
    title: `${record.type} v${record.version}`,
    doc: type?.doc ?? "",
    role: "Event",
    facts: [
      { kind: "payload", fields: Object.entries(record.payload).map(([name, value]) => ({ name, value: String(value) })) },
      { kind: "text", label: "Idempotency key", value: record.idempotencyKey },
      { kind: "event", label: "Correlation (root)", event: record.correlation },
      { kind: "text", label: "Produced by", value: sim.labelOf(record.producer) },
      { kind: "count", label: "Created at tick", value: record.createdAt },
    ],
    trace: t,
  };
}

export function inspect(sim: SimView, target: InspectTarget): Inspection | null {
  switch (target.kind) {
    case "kind": {
      const kind = sim.pack.kinds.get(target.id);
      return kind === undefined ? null : { title: kind.title, doc: kind.doc, role: roleOf(kind), facts: kindFacts(kind), trace: null };
    }
    case "eventType": {
      const type = sim.pack.events.get(target.id);
      if (type === undefined) return null;
      const fields = [...type.fields].map(([name, t]): Fact => ({ kind: "text", label: name, value: typeof t === "string" ? t : t.join(" | ") }));
      const key: Fact[] = type.key.length > 0 ? [{ kind: "text", label: "Business key", value: type.key.join(", ") }] : [];
      return { title: type.id, doc: type.doc, role: "Event type", facts: [...fields, ...key], trace: null };
    }
    case "event":
      return target.event >= 0 && target.event < sim.log.size ? eventInspection(sim, sim.log.get(target.event)) : null;
    case "entity": {
      const placed = sim.layout.placements.get(target.entity);
      if (placed === undefined) return null;
      if (placed.build.kind === "belt") return beltInspection(sim, cellOf(sim.scenario, placed.at));
      const kind = sim.pack.kinds.get(placed.build.id);
      const state = sim.entities.get(target.entity);
      if (kind === undefined || state === undefined) return null;
      return { title: kind.title, doc: kind.doc, role: roleOf(kind), facts: [...liveFacts(sim, target.entity, state), ...kindFacts(kind)], trace: null };
    }
    case "cell": {
      const { x, y } = target.at;
      if (x < 0 || y < 0 || x >= sim.scenario.width || y >= sim.scenario.height) return null;
      const entity = sim.layout.byCell.get(cellOf(sim.scenario, target.at));
      return entity === undefined ? null : inspect(sim, { kind: "entity", entity });
    }
  }
}

/** A belt shows the event on it, if any; otherwise the pack's belt doc. */
function beltInspection(sim: SimView, cell: number): Inspection {
  const slot = sim.belts[cell];
  if (slot?.kind === "full") {
    const inspection = eventInspection(sim, sim.log.get(slot.parcel.event));
    return sim.duplicates.has(slot.parcel.id) ? { ...inspection, facts: [{ kind: "text", label: "Delivery", value: "redelivery of an earlier copy" }, ...inspection.facts] } : inspection;
  }
  return { title: sim.pack.belt.title, doc: sim.pack.belt.doc, role: "Channel", facts: [{ kind: "count", label: "Ticks per tile", value: sim.pack.belt.ticksPerTile }], trace: null };
}
