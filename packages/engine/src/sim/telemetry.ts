// The one stream of facts about a run. Objectives, hints, the UI's counters,
// tutorials, and traces all read this stream; none of them inspects sim state
// to decide what happened. A new metric is a new fold over telemetry, never a
// new hook in an archetype.

import type { EntityId, EventId, ParcelId, Tick } from "../ids.js";

/**
 * Tags of what happens on the factory floor. A hint's `on` names one of
 * these. The run's own records (`objectiveProgress`, `hint`, `finished`) are
 * appended after hints are checked, so a hint on them could never fire.
 */
export const hintTags = [
  "emitted", //         source created a root event
  "accepted", //        a building took a parcel off its input
  "produced", //        a machine minted a caused event
  "failed", //          a work attempt failed
  "retrying", //        a failed attempt was rescheduled
  "deadLettered", //    a deadLetter sink took a parcel
  "dropped", //         a parcel left the factory without arriving anywhere
  "delivered", //       an external sink applied an effect (first time for its key)
  "duplicateApplied", //external sink without dedupe applied a key it had seen
  "duplicateIgnored", //external sink with dedupe skipped a key it had seen
  "outOfOrder", //      a sink saw a root seq lower than one it already saw from that source
  "stalled", //         an entity could not hand off; once per stall episode
  "unstalled",
] as const;

export type HintTag = (typeof hintTags)[number];

/** Every tag. `TelemetryTag` derives from it. */
export const telemetryTags = [...hintTags, "objectiveProgress", "hint", "finished"] as const;

export type TelemetryTag = (typeof telemetryTags)[number];

export type DropReason =
  | "sourceBlocked" //  source with whenBlocked "drop" had nowhere to put an event
  | "brokerFull"
  | "noSubscribers" //  fanout broker with no linked consumers
  | "unmatched" //      machine with unmatched "drop"
  | "exhausted" //      retries ran out with exhausted "drop"
  | "removed"; //       player removed the tile or building holding it

interface Base {
  readonly tick: Tick;
  readonly entity: EntityId;
}

interface OfParcel extends Base {
  readonly parcel: ParcelId;
  readonly event: EventId;
}

export type Telemetry =
  | (OfParcel & { readonly tag: "emitted" | "accepted" | "deadLettered" | "delivered" | "duplicateApplied" | "duplicateIgnored" })
  | (OfParcel & { readonly tag: "produced"; readonly cause: EventId })
  | (OfParcel & { readonly tag: "failed"; readonly attempt: number; readonly timing: "beforeEffect" | "afterEffect" })
  | (OfParcel & { readonly tag: "retrying"; readonly attempt: number; readonly at: Tick })
  | (OfParcel & { readonly tag: "dropped"; readonly reason: DropReason })
  | (OfParcel & { readonly tag: "outOfOrder"; readonly expectedAfter: number; readonly seq: number })
  | (Base & { readonly tag: "stalled" | "unstalled" })
  | { readonly tag: "objectiveProgress"; readonly tick: Tick; readonly goal: number; readonly count: number; readonly target: number }
  | { readonly tag: "hint"; readonly tick: Tick; readonly hint: number; readonly text: string }
  | { readonly tag: "finished"; readonly tick: Tick; readonly outcome: Outcome };

export type Outcome =
  | { readonly kind: "won" }
  | { readonly kind: "lost"; readonly reason: { readonly kind: "constraint"; readonly index: number } | { readonly kind: "outOfTime" } };

/** The record for one tag. Several tags share a union member, so this narrows that member's tag rather than using Extract. */
export type TelemetryOf<T extends TelemetryTag> = Telemetry extends infer U
  ? U extends { readonly tag: infer G }
    ? T extends G
      ? U & { readonly tag: T }
      : never
    : never
  : never;
