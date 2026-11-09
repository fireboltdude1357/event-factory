// Moves parcels between owners. Pull-based: every receiver (a belt tile or a
// building's back side) pulls from its own feeders, in topology.pullOrder.
// Each slot therefore has exactly one writer in this phase, its own pull, so
// merges and side-loads need no conflict rule beyond the receiver's
// round-robin cursor. Per separate-before-serializing-shared-state.

import type { EntityId } from "../ids.js";
import type { Side } from "../pack/model.js";
import type { Parcel } from "./event-log.js";
import { receiverKey, type Feeder, type Topology } from "./world.js";

/**
 * One parcel per belt tile. `progress` counts ticks spent on this tile; a
 * parcel is at the head and can be pulled once progress >= belt.ticksPerTile.
 * Render interpolates position from progress.
 */
export type BeltSlot =
  | { readonly kind: "empty"; readonly cursor: number }
  | { readonly kind: "full"; readonly parcel: Parcel; readonly progress: number; readonly cursor: number };

/** One slot per building out side. A building can only send into an empty one. */
export type OutBuffers = ReadonlyMap<EntityId, ReadonlyMap<Side, Parcel>>;

export const emptyBelt: BeltSlot = { kind: "empty", cursor: 0 };

/**
 * Phase two of a tick. Mutates the sim's own `belts` and `out` in place.
 * `offer` runs the building's `accept`; a discard counts as taken, since the
 * parcel left the belt.
 */
export function moveParcels(
  topology: Topology,
  belts: BeltSlot[],
  out: Map<EntityId, Map<Side, Parcel>>,
  ticksPerTile: number,
  offer: (entity: EntityId, parcel: Parcel) => "taken" | "refused",
): void {
  for (let cell = 0; cell < belts.length; cell++) {
    const slot = belts[cell];
    if (slot?.kind === "full" && slot.progress < ticksPerTile) belts[cell] = { ...slot, progress: slot.progress + 1 };
  }

  const ready = (feeder: Feeder): Parcel | null => {
    if (feeder.kind === "port") return out.get(feeder.entity)?.get(feeder.side) ?? null;
    const slot = belts[feeder.cell];
    return slot?.kind === "full" && slot.progress >= ticksPerTile ? slot.parcel : null;
  };
  const clear = (feeder: Feeder): void => {
    if (feeder.kind === "port") out.get(feeder.entity)?.delete(feeder.side);
    else belts[feeder.cell] = { kind: "empty", cursor: belts[feeder.cell]?.cursor ?? 0 };
  };

  // Downstream first, so a line moving at full speed frees and refills each
  // slot in the same tick and a full belt keeps moving.
  for (const receiver of topology.pullOrder) {
    const feeders = topology.feeders.get(receiverKey(receiver)) ?? [];
    if (feeders.length === 0) continue;

    if (receiver.kind === "building") {
      const feeder = feeders[0];
      const parcel = feeder === undefined ? null : ready(feeder);
      // A refused head blocks that whole line. Backpressure is this rule and nothing else.
      if (feeder !== undefined && parcel !== null && offer(receiver.entity, parcel) === "taken") clear(feeder);
      continue;
    }

    const slot = belts[receiver.cell];
    if (slot === undefined || slot.kind === "full") continue;
    for (let i = 0; i < feeders.length; i++) {
      const at = (slot.cursor + i) % feeders.length;
      const feeder = feeders[at];
      const parcel = feeder === undefined ? null : ready(feeder);
      if (feeder === undefined || parcel === null) continue;
      clear(feeder);
      belts[receiver.cell] = { kind: "full", parcel, progress: 0, cursor: (at + 1) % feeders.length };
      break;
    }
  }
}
