import type { Facing, Point, RenderFrame } from "@event-factory/engine"

export type { Facing, Point }

export const facings = ["north", "east", "south", "west"] as const satisfies readonly Facing[]

export const vectors: Record<Facing, Point> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
}

export const angles: Record<Facing, number> = { east: 0, south: Math.PI / 2, west: Math.PI, north: -Math.PI / 2 }

export const turn = (facing: Facing, by: 1 | -1): Facing => facings[(facings.indexOf(facing) + by + 4) % 4] ?? facing

export const opposite = (facing: Facing): Facing => facings[(facings.indexOf(facing) + 2) % 4] ?? facing

export const samePoint = (a: Point | null, b: Point | null) => a !== null && b !== null && a.x === b.x && a.y === b.y

export const step = (at: Point, facing: Facing): Point => ({ x: at.x + vectors[facing].x, y: at.y + vectors[facing].y })

/** The facing that steps from `a` to the adjacent cell `b`, or null when they are not neighbours. */
export function facingBetween(a: Point, b: Point): Facing | null {
  return facings.find((f) => a.x + vectors[f].x === b.x && a.y + vectors[f].y === b.y) ?? null
}

/** Cells from `a` (exclusive) to `b` (inclusive), one orthogonal step at a time, x first. */
export function stepsBetween(a: Point, b: Point): Point[] {
  const out: Point[] = []
  let { x, y } = a
  while (x !== b.x) out.push({ x: (x += Math.sign(b.x - x)), y })
  while (y !== b.y) out.push({ x, y: (y += Math.sign(b.y - y)) })
  return out
}

export type Building = RenderFrame["buildings"][number]
export type Belt = RenderFrame["belts"][number]

export interface BeltLink {
  readonly belt: Belt
  /** Sides of this tile that something feeds, as the direction from the tile toward the feeder. */
  readonly from: readonly Facing[]
  /** Whether the front leads into a belt or a building's input. */
  readonly linked: boolean
}

export interface BuildingLink {
  readonly building: Building
  /** Whether something feeds the back side. */
  readonly fed: boolean
  readonly outs: readonly { readonly facing: Facing; readonly port: string | null; readonly linked: boolean }[]
}

export interface Links {
  readonly belts: readonly BeltLink[]
  readonly buildings: readonly BuildingLink[]
  readonly beltAt: ReadonlyMap<number, BeltLink>
}

/**
 * Which tiles feed which, read off the frame. It mirrors the engine's rule:
 * a belt takes from any neighbour that points into it, and a building takes
 * only through its back. Painters use it to join belts into runs and to mark
 * an output that leads nowhere.
 */
export function linksOf(frame: RenderFrame): Links {
  const key = (p: Point) => p.y * frame.width + p.x
  const belts = new Map(frame.belts.map((b) => [key(b.at), b]))
  const buildings = new Map(frame.buildings.map((b) => [key(b.at), b]))

  /** Does a parcel leaving `from` toward `facing` have somewhere to go? */
  const accepts = (from: Point, facing: Facing): boolean => {
    const to = step(from, facing)
    if (to.x < 0 || to.y < 0 || to.x >= frame.width || to.y >= frame.height) return false
    const belt = belts.get(key(to))
    if (belt) return belt.facing !== opposite(facing)
    const building = buildings.get(key(to))
    return building !== undefined && building.shape !== "producer" && building.facing === facing
  }

  /** Does the neighbour on `side` of `at` send into `at`? */
  const feeds = (at: Point, side: Facing): boolean => {
    const from = step(at, side)
    const belt = belts.get(key(from))
    if (belt) return belt.facing === opposite(side)
    const building = buildings.get(key(from))
    return building !== undefined && building.outs.some((o) => o.facing === opposite(side))
  }

  const beltLinks = frame.belts.map(
    (belt): BeltLink => ({
      belt,
      from: facings.filter((side) => side !== belt.facing && feeds(belt.at, side)),
      linked: accepts(belt.at, belt.facing),
    }),
  )
  return {
    belts: beltLinks,
    buildings: frame.buildings.map((building) => ({
      building,
      fed: building.shape !== "producer" && feeds(building.at, opposite(building.facing)),
      outs: building.outs.map((o) => ({ ...o, linked: accepts(building.at, o.facing) })),
    })),
    beltAt: new Map(beltLinks.map((l) => [key(l.belt.at), l])),
  }
}

export interface MovingParcel {
  readonly parcel: RenderFrame["parcels"][number]
  readonly x: number
  readonly y: number
  /** A point a little behind on the same path, for a trail. */
  readonly tail: Point
}

/**
 * The engine reports a parcel on the straight line through its tile. This
 * bends that line through the side the parcel entered by, so a parcel turns a
 * corner instead of jumping across it. It remembers each parcel's last tile to
 * know where it came from.
 */
export function createParcelTracker() {
  let run = -1
  let entered = new Map<number, { readonly cell: number; readonly from: Facing | null }>()

  return (frame: RenderFrame, links: Links): MovingParcel[] => {
    if (frame.run !== run) {
      run = frame.run
      entered = new Map()
    }
    const next = new Map<number, { readonly cell: number; readonly from: Facing | null }>()
    const out = frame.parcels.map((parcel): MovingParcel => {
      const v = vectors[parcel.facing]
      const tile = parcel.at
      const cell = tile.y * frame.width + tile.x
      const before = entered.get(parcel.id)
      let from = before?.cell === cell ? before.from : null
      if (before === undefined || before.cell !== cell) {
        const prev = before === undefined ? null : { x: before.cell % frame.width, y: Math.floor(before.cell / frame.width) }
        const side = prev === null ? null : facingBetween(tile, prev)
        const feeders = links.beltAt.get(cell)?.from ?? []
        from = side ?? (feeders.length === 1 ? (feeders[0] ?? null) : null)
      }
      next.set(parcel.id, { cell, from })

      const cx = tile.x + 0.5
      const cy = tile.y + 0.5
      const u = Math.max(0, Math.min(1, (parcel.x - cx) * v.x + (parcel.y - cy) * v.y + 0.5))
      const entry = from === null || from === opposite(parcel.facing) ? { x: cx - v.x / 2, y: cy - v.y / 2 } : { x: cx + vectors[from].x / 2, y: cy + vectors[from].y / 2 }
      const exit = { x: cx + v.x / 2, y: cy + v.y / 2 }
      // A quadratic curve through the tile, bent at its center.
      const along = (t: number): Point => {
        const a = 1 - t
        return { x: a * a * entry.x + 2 * a * t * cx + t * t * exit.x, y: a * a * entry.y + 2 * a * t * cy + t * t * exit.y }
      }
      const at = along(u)
      return { parcel, x: at.x, y: at.y, tail: along(Math.max(0, u - 0.45)) }
    })
    entered = next
    return out
  }
}
