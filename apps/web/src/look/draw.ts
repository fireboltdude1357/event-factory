import type { BuildingShape } from "@event-factory/engine"
import { type Point } from "../core/geometry"
import type { Look } from "../core/level"

export const ink = "#2a1f17"
export const white = "#ffffff"
export const mat = "#fbf4e2"
export const table = "#e9dbbb"
export const peg = "#d8c59c"
export const gridLine = "#ecdfc2"
export const ok = "#1f9d45"
export const warn = "#f59f0b"
export const bad = "#e03b3b"
export const calm = "#2d7ff0"
export const rubber = "#3b3530"
export const tread = "#5e5750"
export const rail = "#d6cdbd"
export const shadow = "rgba(42, 31, 23, 0.22)"
export const display = '"Fredoka", "Nunito", system-ui, sans-serif'

/** One saturated toy color per shape, so a glance tells a queue from a handler. A pack's `color` overrides it. */
const toys: Record<BuildingShape, string> = {
  producer: "#3a86ff",
  queue: "#9b5de5",
  topic: "#f15bb5",
  handler: "#ffbe0b",
  router: "#00b4a8",
  external: "#43aa3b",
  deadLetter: "#f0503a",
}

export const toyColor = (look: Pick<Look, "shape" | "color">): string => look.color ?? toys[look.shape]

export const confettiColors = [toys.producer, toys.handler, toys.topic, toys.router, toys.queue, toys.external]

export const key = (p: Point) => `${p.x},${p.y}`

export function arrowHead(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, s: number, color: string, outlined = false) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.moveTo(s, 0)
  ctx.lineTo(-s * 0.6, -s * 0.85)
  ctx.lineTo(-s * 0.6, s * 0.85)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  if (outlined) {
    ctx.strokeStyle = ink
    ctx.lineWidth = Math.max(1.5, s * 0.25)
    ctx.stroke()
  }
  ctx.restore()
}

export function stroke(ctx: CanvasRenderingContext2D, color: string, width: number, path: () => void) {
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  path()
  ctx.stroke()
}

export function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
}

function rgb(color: string): readonly [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1]
  if (!hex) return null
  const full = hex.length === 3 ? [...hex].map((ch) => ch + ch).join("") : hex
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Blends two hex colors: 0 is all `a`, 1 is all `b`. A color it cannot read comes back as `a`. */
export function mix(a: string, b: string, t: number): string {
  const pa = rgb(a)
  const pb = rgb(b)
  if (!pa || !pb) return a
  const ch = (i: 0 | 1 | 2) => Math.round(pa[i] * (1 - t) + pb[i] * t)
  return `#${((ch(0) << 16) | (ch(1) << 8) | ch(2)).toString(16).padStart(6, "0")}`
}

export const shade = (color: string, by: number) => mix(color, "#2a1f17", by)
