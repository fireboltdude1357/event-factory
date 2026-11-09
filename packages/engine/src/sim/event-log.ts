// Events are facts; parcels are deliveries of a fact. The log owns every
// event ever created in a run. Parcels on belts and in buildings hold only an
// EventId, so a fanout copy, a redelivered duplicate, and a retry all point at
// the same record. That split is what makes duplicates visible: two parcels,
// one event id.

import { EventId, IdempotencyKey, type EntityId, type EventTypeId, type KindId, type ParcelId, type Tick } from "../ids.js";
import type { EventType, Payload } from "../pack/model.js";

export type Origin =
  /**
   * `n` counts events within one `emits` stream of the source kind. Keys and
   * rolls use (kind, stream, n), never the entity or its position, so luck
   * and keys do not change with layout. `seq` is the order across all of the
   * entity's streams, for order checks.
   */
  | { readonly kind: "root"; readonly source: EntityId; readonly sourceKind: KindId; readonly stream: number; readonly n: number; readonly seq: number }
  /**
   * `machineKind` is part of the key, so two handlers of one event produce
   * different keys. Two buildings of the same kind on two fanout branches
   * share a key: they perform the same operation.
   */
  | { readonly kind: "caused"; readonly by: EventId; readonly machineKind: KindId; readonly recipe: number; readonly emit: number };

export interface EventRecord {
  readonly id: EventId;
  readonly type: EventTypeId;
  readonly version: number;
  readonly payload: Payload;
  readonly origin: Origin;
  /** Id of the root event of this chain. */
  readonly correlation: EventId;
  /**
   * With a declared `key` on the event type: `${type}:${JSON of the value}` for one
   * field, `${type}:${JSON of the values}` for several. Otherwise root:
   * `${sourceKind}#${stream}.${n}`, caused: `${parent.idempotencyKey}/${machineKind}.${recipe}.${emit}`.
   * The forms cannot collide. Only business keys contain ":", the type before
   * it has none, and a JSON value followed by "/..." is not JSON, so no value
   * can spell a derived key.
   * A machine that crashes after its side effect and retries produces a new
   * event id with the same key, which is what an idempotent sink dedupes on.
   */
  readonly idempotencyKey: IdempotencyKey;
  readonly createdAt: Tick;
  readonly producer: EntityId;
}

/** What an archetype asks the sim to mint. Ids, key, correlation are derived. */
export interface EventDraft {
  readonly type: EventTypeId;
  readonly version: number;
  readonly payload: Payload;
  readonly origin: Origin;
}

/**
 * One delivery of one event. Retry attempts live on the machine's work slot,
 * not here: an attempt count only means something at the machine doing the work.
 */
export interface Parcel {
  readonly id: ParcelId;
  readonly event: EventId;
}

/**
 * Append-only and owned by one Sim. `children` and `withKey` read indexes the
 * log keeps itself, so a trace never scans.
 */
export interface EventLog {
  readonly size: number;
  append(draft: EventDraft, producer: EntityId, at: Tick): EventRecord;
  get(id: EventId): EventRecord;
  children(id: EventId): readonly EventId[];
  /** Every event with this key, in creation order. */
  withKey(key: IdempotencyKey): readonly EventId[];
}

export function createEventLog(events: ReadonlyMap<EventTypeId, EventType>): EventLog {
  const records: EventRecord[] = [];
  const children = new Map<EventId, EventId[]>();
  const byKey = new Map<IdempotencyKey, EventId[]>();

  const get = (id: EventId): EventRecord => {
    const record = records[id];
    if (record === undefined) throw new Error(`unknown event ${id}`);
    return record;
  };

  const keyFor = (draft: EventDraft): IdempotencyKey => {
    const fields = events.get(draft.type)?.key ?? [];
    if (fields.length > 0) {
      const values = fields.map((f) => draft.payload[f]);
      return IdempotencyKey(`${draft.type}:${JSON.stringify(values.length === 1 ? values[0] : values)}`);
    }
    const origin = draft.origin;
    return origin.kind === "root"
      ? IdempotencyKey(`${origin.sourceKind}#${origin.stream}.${origin.n}`)
      : IdempotencyKey(`${get(origin.by).idempotencyKey}/${origin.machineKind}.${origin.recipe}.${origin.emit}`);
  };

  return {
    get size() {
      return records.length;
    },
    append(draft, producer, at) {
      const id = EventId(records.length);
      const origin = draft.origin;
      const record: EventRecord = {
        id,
        type: draft.type,
        version: draft.version,
        payload: draft.payload,
        origin,
        correlation: origin.kind === "root" ? id : get(origin.by).correlation,
        idempotencyKey: keyFor(draft),
        createdAt: at,
        producer,
      };
      records.push(record);
      if (origin.kind === "caused") push(children, origin.by, id);
      push(byKey, record.idempotencyKey, id);
      return record;
    },
    get,
    children: (id) => children.get(id) ?? [],
    withKey: (key) => byKey.get(key) ?? [],
  };
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}
