// Layout and commands. The placement list is the single source of truth for
// what is built where. Topology (who feeds whom, in what order to pull) is
// derived from it after every accepted command and never edited directly.

import { Data } from "effect";
import { EntityId, type KindId } from "../ids.js";
import { countPlaced, type Facing, type Kind, type OutSide, type Pack, type Placeable, type Placement, type Point, type Scenario, type Side } from "../pack/model.js";

export type Command =
  | { readonly kind: "place"; readonly at: Point; readonly facing: Facing; readonly build: Placeable }
  | { readonly kind: "remove"; readonly at: Point }
  | { readonly kind: "rotate"; readonly at: Point; readonly to: Facing };

export type RejectReason =
  | { readonly kind: "outOfBounds" }
  | { readonly kind: "wall" }
  | { readonly kind: "occupied"; readonly by: EntityId }
  | { readonly kind: "empty" }
  | { readonly kind: "locked" }
  | { readonly kind: "notUnlocked"; readonly build: KindId | "belt" }
  | { readonly kind: "overBudget"; readonly build: KindId; readonly limit: number }
  /** The run is over. Reset to edit again. */
  | { readonly kind: "finished" };

export class CommandRejected extends Data.TaggedError("CommandRejected")<{
  readonly command: Command;
  readonly reason: RejectReason;
}> {}

/** Something that can hand a parcel to a receiver: a belt tile or a building's out side. */
export type Feeder =
  | { readonly kind: "belt"; readonly cell: number }
  | { readonly kind: "port"; readonly entity: EntityId; readonly side: Side };

/** Something that pulls parcels: a belt tile or a building's back side. */
export type Receiver = { readonly kind: "belt"; readonly cell: number } | { readonly kind: "building"; readonly entity: EntityId };

export const receiverKey = (r: Receiver): string => (r.kind === "belt" ? `b${r.cell}` : `e${r.entity}`);

/**
 * Derived from placements. `pullOrder` lists receivers downstream-first so a
 * full, moving line advances one slot per tick instead of leaving gaps.
 * `feeders` per receiver are in priority order: straight-behind, left, right.
 * Round-robin over them lives in the receiver's runtime state.
 */
export interface Topology {
  readonly pullOrder: readonly Receiver[];
  readonly feeders: ReadonlyMap<string, readonly Feeder[]>; // key: receiverKey(r)
  /** Out sides of each building that have a receiver. A fanout broker's subscriber set. */
  readonly linkedSides: ReadonlyMap<EntityId, readonly OutSide[]>;
}

export type PlacedEntity = Placement & { readonly entity: EntityId };

export interface Layout {
  readonly scenario: Scenario;
  readonly placements: ReadonlyMap<EntityId, PlacedEntity>;
  readonly byCell: ReadonlyMap<number, EntityId>;
  readonly topology: Topology;
  /** Next entity id to mint. Ids only grow, so map order is ascending id order. */
  readonly nextEntity: number;
}

const facings: readonly Facing[] = ["north", "east", "south", "west"];
const vectors: Readonly<Record<Facing, Point>> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};
const turns: Readonly<Record<Side, number>> = { front: 0, right: 1, back: 2, left: 3 };

/** Absolute direction of a building's side. */
export function sideDirection(facing: Facing, side: Side): Facing {
  return facings[(facings.indexOf(facing) + turns[side]) % 4] ?? facing;
}

const opposite = (f: Facing): Facing => sideDirection(f, "back");

export const cellOf = (scenario: Scenario, at: Point): number => at.y * scenario.width + at.x;
export const pointOf = (scenario: Scenario, cell: number): Point => ({ x: cell % scenario.width, y: Math.floor(cell / scenario.width) });

function neighbour(scenario: Scenario, cell: number, direction: Facing): number | null {
  const p = pointOf(scenario, cell);
  const x = p.x + vectors[direction].x;
  const y = p.y + vectors[direction].y;
  return x < 0 || y < 0 || x >= scenario.width || y >= scenario.height ? null : y * scenario.width + x;
}

/** Out sides an archetype can send from. Machines send only from their declared ports. */
export function outSides(kind: Kind): readonly OutSide[] {
  switch (kind.archetype) {
    case "source":
      return ["front"];
    case "broker":
      return ["front", "left", "right"];
    case "machine":
      return kind.ports.map((p) => p.side);
    case "sink":
      return [];
  }
}

export function initialLayout(pack: Pack, scenario: Scenario): Layout {
  const placements = new Map<EntityId, PlacedEntity>();
  const byCell = new Map<number, EntityId>();
  let next = 0;
  for (const placement of scenario.preplaced) {
    const entity = EntityId(next++);
    placements.set(entity, { ...placement, entity });
    byCell.set(cellOf(scenario, placement.at), entity);
  }
  return { scenario, placements, byCell, nextEntity: next, topology: deriveTopology(pack, scenario, placements, byCell) };
}

type Applied = { readonly layout: Layout; readonly removed: readonly PlacedEntity[]; readonly added: readonly EntityId[] };

/**
 * Pure. Returns the new layout and the entities the command removed, so the
 * sim can drop their parcels with reason "removed". Placing the exact build
 * that is already there with the same facing is a no-op, not an error, so
 * replaying a command log twice is safe.
 */
export function applyCommand(pack: Pack, layout: Layout, command: Command): Applied | CommandRejected {
  const scenario = layout.scenario;
  const reject = (reason: RejectReason) => new CommandRejected({ command, reason });
  const { at } = command;
  if (at.x < 0 || at.y < 0 || at.x >= scenario.width || at.y >= scenario.height) return reject({ kind: "outOfBounds" });
  const cell = cellOf(scenario, at);
  const occupantId = layout.byCell.get(cell);
  const occupant = occupantId === undefined ? undefined : layout.placements.get(occupantId);
  const unchanged: Applied = { layout, removed: [], added: [] };

  switch (command.kind) {
    case "place": {
      if (scenario.terrain[cell] === "wall") return reject({ kind: "wall" });
      if (occupant !== undefined) {
        const same = occupant.facing === command.facing && sameBuild(occupant.build, command.build);
        return same ? unchanged : reject({ kind: "occupied", by: occupant.entity });
      }
      const buildId = command.build.kind === "belt" ? "belt" : command.build.id;
      if (!scenario.unlocked.has(buildId)) return reject({ kind: "notUnlocked", build: buildId });
      if (command.build.kind === "building") {
        const limit = scenario.budget.get(command.build.id);
        if (limit !== undefined && countPlaced(layout.placements.values(), command.build.id) >= limit) {
          return reject({ kind: "overBudget", build: command.build.id, limit });
        }
      }
      const entity = EntityId(layout.nextEntity);
      const placements = new Map(layout.placements).set(entity, { at, facing: command.facing, build: command.build, locked: false, entity });
      const byCell = new Map(layout.byCell).set(cell, entity);
      return { layout: rebuild(pack, layout, placements, byCell, layout.nextEntity + 1), removed: [], added: [entity] };
    }
    case "remove": {
      if (occupant === undefined) return reject({ kind: "empty" });
      if (occupant.locked) return reject({ kind: "locked" });
      const placements = new Map(layout.placements);
      placements.delete(occupant.entity);
      const byCell = new Map(layout.byCell);
      byCell.delete(cell);
      return { layout: rebuild(pack, layout, placements, byCell, layout.nextEntity), removed: [occupant], added: [] };
    }
    case "rotate": {
      if (occupant === undefined) return reject({ kind: "empty" });
      if (occupant.locked) return reject({ kind: "locked" });
      if (occupant.facing === command.to) return unchanged;
      const placements = new Map(layout.placements).set(occupant.entity, { ...occupant, facing: command.to });
      return { layout: rebuild(pack, layout, placements, layout.byCell, layout.nextEntity), removed: [], added: [] };
    }
  }
}

function sameBuild(a: Placeable, b: Placeable): boolean {
  return a.kind === "belt" ? b.kind === "belt" : b.kind === "building" && a.id === b.id;
}

function rebuild(pack: Pack, layout: Layout, placements: Layout["placements"], byCell: Layout["byCell"], nextEntity: number): Layout {
  return { scenario: layout.scenario, placements, byCell, nextEntity, topology: deriveTopology(pack, layout.scenario, placements, byCell) };
}

function deriveTopology(pack: Pack, scenario: Scenario, placements: Layout["placements"], byCell: Layout["byCell"]): Topology {
  const feeders = new Map<string, { readonly feeder: Feeder; readonly rank: number }[]>();
  const linkedSides = new Map<EntityId, OutSide[]>();
  // Each belt has at most one downstream belt; buildings end a chain.
  const downstream = new Map<number, number>();

  const kindOf = (p: PlacedEntity): Kind | undefined => (p.build.kind === "building" ? pack.kinds.get(p.build.id) : undefined);

  // Where a parcel leaving `fromCell` towards `direction` lands, if anything takes it.
  const receiverAt = (fromCell: number, direction: Facing): { readonly receiver: Receiver; readonly rank: number } | null => {
    const target = neighbour(scenario, fromCell, direction);
    if (target === null) return null;
    const id = byCell.get(target);
    const placed = id === undefined ? undefined : placements.get(id);
    if (placed === undefined) return null;
    if (placed.build.kind === "belt") {
      if (placed.facing === opposite(direction)) return null;
      // Arriving from straight behind ranks first, then from the belt's left, then its right.
      const rank = placed.facing === direction ? 0 : sideDirection(placed.facing, "right") === direction ? 1 : 2;
      return { receiver: { kind: "belt", cell: target }, rank };
    }
    // Sources have no input, so nothing links to their back.
    if (placed.facing !== direction || kindOf(placed)?.archetype === "source") return null;
    return { receiver: { kind: "building", entity: placed.entity }, rank: 0 };
  };

  const link = (from: Feeder, fromCell: number, direction: Facing): boolean => {
    const found = receiverAt(fromCell, direction);
    if (found === null) return false;
    const key = receiverKey(found.receiver);
    const list = feeders.get(key) ?? [];
    list.push({ feeder: from, rank: found.rank });
    feeders.set(key, list);
    if (from.kind === "belt" && found.receiver.kind === "belt") downstream.set(from.cell, found.receiver.cell);
    return true;
  };

  const receivers: Receiver[] = [];
  for (const placed of placements.values()) {
    const cell = cellOf(scenario, placed.at);
    if (placed.build.kind === "belt") {
      receivers.push({ kind: "belt", cell });
      link({ kind: "belt", cell }, cell, placed.facing);
      continue;
    }
    const kind = kindOf(placed);
    if (kind === undefined) continue;
    if (kind.archetype !== "source") receivers.push({ kind: "building", entity: placed.entity });
    const linked = outSides(kind).filter((side) => link({ kind: "port", entity: placed.entity, side }, cell, sideDirection(placed.facing, side)));
    linkedSides.set(placed.entity, linked);
  }

  const sortedFeeders = new Map<string, readonly Feeder[]>();
  for (const [key, list] of feeders) sortedFeeders.set(key, [...list].sort((a, b) => a.rank - b.rank).map((f) => f.feeder));

  return { pullOrder: downstreamFirst(receivers, downstream), feeders: sortedFeeders, linkedSides };
}

/**
 * Orders receivers so each comes after the receiver it feeds. Buildings end
 * every chain, so they come first. A belt loop has no end: it is cut at its
 * lowest cell index, which costs a one-tick gap at that tile.
 */
function downstreamFirst(receivers: readonly Receiver[], downstream: ReadonlyMap<number, number>): readonly Receiver[] {
  const cut = new Set<number>();
  const state = new Map<number, "visiting" | "done">();
  for (const start of [...downstream.keys()].sort((a, b) => a - b)) {
    const path: number[] = [];
    let at: number | undefined = start;
    while (at !== undefined && state.get(at) === undefined) {
      state.set(at, "visiting");
      path.push(at);
      at = downstream.get(at);
    }
    if (at !== undefined && state.get(at) === "visiting") {
      const loop = path.slice(path.indexOf(at));
      cut.add(Math.min(...loop));
    }
    for (const cell of path) state.set(cell, "done");
  }

  const depth = new Map<number, number>();
  const depthOf = (cell: number): number => {
    const chain: number[] = [];
    let at = cell;
    let base = 0;
    for (;;) {
      const known = depth.get(at);
      if (known !== undefined) {
        base = known;
        break;
      }
      chain.push(at);
      const next = cut.has(at) ? undefined : downstream.get(at);
      if (next === undefined) {
        base = -1;
        break;
      }
      at = next;
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      const c = chain[i];
      if (c === undefined) continue;
      base += 1;
      depth.set(c, base);
    }
    return depth.get(cell) ?? 0;
  };

  const rank = (r: Receiver): number => (r.kind === "building" ? -1 : depthOf(r.cell));
  const index = (r: Receiver): number => (r.kind === "building" ? r.entity : r.cell);
  return [...receivers].sort((a, b) => rank(a) - rank(b) || (a.kind === b.kind ? index(a) - index(b) : a.kind === "building" ? -1 : 1));
}
