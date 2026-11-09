import type { RenderFrame, TelemetryTag } from "@event-factory/engine"

import type { Facing, Point } from "@event-factory/engine"
export type { Facing, Point }
type BuildingState = RenderFrame["buildings"][number]["state"]

const facings = ["north", "east", "south", "west"] as const satisfies readonly Facing[]

const vectors: Record<Facing, Point> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
}

const angles: Record<Facing, number> = { east: 0, south: Math.PI / 2, west: Math.PI, north: -Math.PI / 2 }

export const turn = (facing: Facing, by: 1 | -1): Facing => facings[(facings.indexOf(facing) + by + 4) % 4] ?? facing

export const samePoint = (a: Point | null, b: Point | null) => a !== null && b !== null && a.x === b.x && a.y === b.y

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

const colorTokens = [
  "floor",
  "grid",
  "wall",
  "belt",
  "chevron",
  "machine",
  "rule",
  "ink",
  "dim",
  "faint",
  "busy",
  "amber",
  "alarm",
  "ok",
  "slate",
] as const

export type Colors = Record<(typeof colorTokens)[number], string>

/** Reads the `--color-*` tokens from index.css so the canvas and the chrome share one palette. */
export function readColors(el: Element): Colors {
  const style = getComputedStyle(el)
  return Object.fromEntries(colorTokens.map((t) => [t, style.getPropertyValue(`--color-${t}`).trim() || "#888"])) as Colors
}

const stateColor: Record<BuildingState, keyof Colors> = { idle: "rule", busy: "busy", stalled: "amber", failing: "alarm" }

/**
 * How each telemetry tag flashes its cell, or null for none. An outcome rings
 * the cell's edge. A qualifier that lands on the same cell in the same tick as
 * an outcome (a retry after a failure, a drop after the last failure, an
 * out-of-order arrival beside its delivery) rings inside it, so neither hides
 * the other.
 */
const flashStyle: Record<TelemetryTag, { readonly color: keyof Colors; readonly ring: "edge" | "inset" } | null> = {
  failed: { color: "alarm", ring: "edge" },
  duplicateApplied: { color: "alarm", ring: "edge" },
  deadLettered: { color: "amber", ring: "edge" },
  duplicateIgnored: { color: "amber", ring: "edge" },
  delivered: { color: "ok", ring: "edge" },
  retrying: { color: "amber", ring: "inset" },
  outOfOrder: { color: "amber", ring: "inset" },
  dropped: { color: "dim", ring: "inset" },
  emitted: null,
  accepted: null,
  produced: null,
  stalled: null,
  unstalled: null,
  objectiveProgress: null,
  hint: null,
  finished: null,
}

/** Flash `age` is assumed to count ticks since the telemetry; a flash fades out over this many. */
const flashTicks = 8

export interface View {
  readonly cell: number
  readonly dpr: number
  readonly colors: Colors
  readonly hover: Point | null
  readonly selected: Point | null
  /** What the active tool would place at `hover`. */
  readonly ghost: { readonly facing: Facing; readonly glyph: string | null } | null
}

/** Pure: paints one frame. The caller sizes the canvas to `frame.width * view.cell` CSS pixels. */
export function drawFrame(ctx: CanvasRenderingContext2D, frame: RenderFrame, view: View): void {
  const { cell: c, colors } = view
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
  ctx.fillStyle = colors.floor
  ctx.fillRect(0, 0, frame.width * c, frame.height * c)

  ctx.strokeStyle = colors.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 1; x < frame.width; x++) line(ctx, x * c + 0.5, 0, x * c + 0.5, frame.height * c)
  for (let y = 1; y < frame.height; y++) line(ctx, 0, y * c + 0.5, frame.width * c, y * c + 0.5)
  ctx.stroke()

  frame.terrain.forEach((t, i) => {
    if (t !== "wall") return
    const x = (i % frame.width) * c
    const y = Math.floor(i / frame.width) * c
    ctx.fillStyle = colors.wall
    ctx.fillRect(x, y, c, c)
    ctx.strokeStyle = colors.grid
    ctx.beginPath()
    for (let d = c / 4; d < c * 2; d += c / 4) line(ctx, x + Math.max(0, d - c), y + Math.min(c, d), x + Math.min(c, d), y + Math.max(0, d - c))
    ctx.stroke()
  })

  for (const belt of frame.belts) {
    const x = belt.at.x * c
    const y = belt.at.y * c
    ctx.fillStyle = colors.belt
    ctx.fillRect(x + 1, y + 1, c - 2, c - 2)
    chevron(ctx, belt.at, belt.facing, c, colors.chevron, 0.18)
  }

  for (const b of frame.buildings) {
    const x = b.at.x * c
    const y = b.at.y * c
    const inset = c * 0.08
    ctx.fillStyle = colors.machine
    roundRect(ctx, x + inset, y + inset, c - inset * 2, c - inset * 2, c * 0.1)
    ctx.fill()
    ctx.lineWidth = Math.max(1.5, c * 0.05)
    ctx.strokeStyle = colors[stateColor[b.state]]
    ctx.stroke()
    if (b.locked) {
      ctx.lineWidth = 1
      ctx.strokeStyle = colors.faint
      roundRect(ctx, x + inset * 2.2, y + inset * 2.2, c - inset * 4.4, c - inset * 4.4, c * 0.06)
      ctx.stroke()
    }
    frontNotch(ctx, b.at, b.facing, c, colors[stateColor[b.state]])
    glyph(ctx, b.glyph, b.at, c, colors.ink)
    if (b.load > 0) badge(ctx, b.at, c, String(b.load), colors)
  }

  // The frame lists flashes newest first, so walk it backwards to paint the newest on top.
  for (const f of [...frame.flashes].reverse()) {
    const style = flashStyle[f.tag]
    if (!style) continue
    const width = Math.max(2, c * 0.08)
    const pad = style.ring === "edge" ? 2 : 2 + width * 1.5
    ctx.globalAlpha = Math.max(0, 1 - f.age / flashTicks) * 0.8
    ctx.strokeStyle = colors[style.color]
    ctx.lineWidth = width
    ctx.strokeRect(f.at.x * c + pad, f.at.y * c + pad, c - pad * 2, c - pad * 2)
  }
  ctx.globalAlpha = 1

  const r = c * 0.17
  for (const p of frame.parcels) {
    const cx = p.x * c
    const cy = p.y * c
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = p.color
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = colors.slate
    ctx.stroke()
    if (p.duplicate) {
      ctx.beginPath()
      ctx.arc(cx, cy, r * 1.65, 0, Math.PI * 2)
      ctx.lineWidth = 2
      ctx.strokeStyle = colors.amber
      ctx.stroke()
    }
  }

  if (view.selected) outline(ctx, view.selected, c, colors.ink, 2)
  if (view.hover) {
    outline(ctx, view.hover, c, colors.dim, 1)
    if (view.ghost) {
      ctx.globalAlpha = 0.55
      if (view.ghost.glyph === null) chevron(ctx, view.hover, view.ghost.facing, c, colors.ink, 0.22)
      else {
        frontNotch(ctx, view.hover, view.ghost.facing, c, colors.ink)
        glyph(ctx, view.ghost.glyph, view.hover, c, colors.ink)
      }
      ctx.globalAlpha = 1
    }
  }
}

/** Pixel offset inside the canvas (CSS pixels) to a cell, or null outside the grid. */
export function cellAt(frame: { readonly width: number; readonly height: number }, cell: number, px: number, py: number): Point | null {
  const x = Math.floor(px / cell)
  const y = Math.floor(py / cell)
  return x >= 0 && y >= 0 && x < frame.width && y < frame.height ? { x, y } : null
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

function outline(ctx: CanvasRenderingContext2D, at: Point, c: number, color: string, width: number) {
  ctx.lineWidth = width
  ctx.strokeStyle = color
  ctx.strokeRect(at.x * c + width / 2, at.y * c + width / 2, c - width, c - width)
}

function centered(ctx: CanvasRenderingContext2D, at: Point, facing: Facing, c: number, draw: () => void) {
  ctx.save()
  ctx.translate((at.x + 0.5) * c, (at.y + 0.5) * c)
  ctx.rotate(angles[facing])
  draw()
  ctx.restore()
}

function chevron(ctx: CanvasRenderingContext2D, at: Point, facing: Facing, c: number, color: string, size: number) {
  centered(ctx, at, facing, c, () => {
    const s = c * size
    ctx.beginPath()
    ctx.moveTo(-s * 0.6, -s)
    ctx.lineTo(s * 0.6, 0)
    ctx.lineTo(-s * 0.6, s)
    ctx.lineWidth = Math.max(1.5, c * 0.07)
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.strokeStyle = color
    ctx.stroke()
  })
}

/** A small triangle on the building's front edge, where its main output leaves. */
function frontNotch(ctx: CanvasRenderingContext2D, at: Point, facing: Facing, c: number, color: string) {
  centered(ctx, at, facing, c, () => {
    const edge = c * 0.42
    const s = c * 0.1
    ctx.beginPath()
    ctx.moveTo(edge - s, -s)
    ctx.lineTo(edge, 0)
    ctx.lineTo(edge - s, s)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
  })
}

function glyph(ctx: CanvasRenderingContext2D, text: string, at: Point, c: number, color: string) {
  ctx.fillStyle = color
  ctx.font = `600 ${Math.round(c * 0.42)}px "Barlow Semi Condensed", system-ui, sans-serif`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(text, (at.x + 0.5) * c, (at.y + 0.53) * c)
}

function badge(ctx: CanvasRenderingContext2D, at: Point, c: number, text: string, colors: Colors) {
  const r = Math.max(7, c * 0.16)
  const cx = (at.x + 1) * c - r * 0.9
  const cy = at.y * c + r * 0.9
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = colors.slate
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = colors.rule
  ctx.stroke()
  ctx.fillStyle = colors.ink
  ctx.font = `500 ${Math.round(r * 1.15)}px "Barlow", system-ui, sans-serif`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(text, cx, cy + 0.5)
}
