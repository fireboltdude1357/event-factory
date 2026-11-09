import { angles, vectors, type BeltLink, type Facing, type Point } from "../core/geometry"
import { pill, poly } from "./blocks"
import { bad, ink, key, line, mix, rail, rubber, shade, shadow, tread, white } from "./draw"
import { applyMotion, type Motion } from "./motion"

/** A tile's lanes as curves in tile-local units: each feeder side bends through the center to the front. */
function lanes(link: BeltLink): { readonly from: Point; readonly to: Point }[] {
  const out = vectors[link.belt.facing]
  const to = { x: out.x / 2, y: out.y / 2 }
  if (link.from.length === 0) return [{ from: { x: -out.x * 0.18, y: -out.y * 0.18 }, to }]
  return link.from.map((side) => ({ from: { x: vectors[side].x / 2, y: vectors[side].y / 2 }, to }))
}

function lanePath(ctx: CanvasRenderingContext2D, link: BeltLink, c: number) {
  ctx.beginPath()
  for (const lane of lanes(link)) {
    ctx.moveTo(lane.from.x * c, lane.from.y * c)
    ctx.quadraticCurveTo(0, 0, lane.to.x * c, lane.to.y * c)
  }
}

/**
 * Rubber conveyors. Each layer goes down for every tile before the next, so
 * joined tiles read as one run with no seams: shadow, ink edge, rails, rubber,
 * then the treads, which move one tile per `ticksPerTile`.
 */
export function belts(ctx: CanvasRenderingContext2D, links: readonly BeltLink[], c: number, phase: number, motion: ReadonlyMap<string, Motion>) {
  const each = (fn: (link: BeltLink) => void) => {
    for (const link of links) {
      ctx.save()
      ctx.translate((link.belt.at.x + 0.5) * c, (link.belt.at.y + 0.5) * c)
      applyMotion(ctx, motion.get(key(link.belt.at)), c)
      ctx.lineCap = link.from.length === 0 ? "round" : "butt"
      fn(link)
      ctx.restore()
    }
  }
  const layer = (color: string, width: number, dx = 0, dy = 0) =>
    each((link) => {
      ctx.translate(dx, dy)
      lanePath(ctx, link, c)
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.stroke()
    })
  layer(shadow, c * 0.66, c * 0.05, c * 0.07)
  layer(ink, c * 0.66)
  layer(rail, c * 0.56)
  layer(rubber, c * 0.38)

  const shift = ((phase % 1) + 1) % 1
  each((link) => {
    ctx.lineCap = "butt"
    ctx.strokeStyle = tread
    ctx.lineWidth = Math.max(1.5, c * 0.04)
    ctx.beginPath()
    for (const lane of lanes(link)) {
      const n = link.from.length === 0 ? 3 : 4
      for (let i = 0; i < n; i++) {
        const t = (shift + i) / n
        const a = 1 - t
        const x = (a * a * lane.from.x + t * t * lane.to.x) * c
        const y = (a * a * lane.from.y + t * t * lane.to.y) * c
        const dx = -2 * a * lane.from.x + 2 * t * lane.to.x
        const dy = -2 * a * lane.from.y + 2 * t * lane.to.y
        const len = Math.hypot(dx, dy) || 1
        const nx = (-dy / len) * c * 0.16
        const ny = (dx / len) * c * 0.16
        line(ctx, x - nx, y - ny, x + nx, y + ny)
      }
    }
    ctx.stroke()
    // Rail bolts that stay put, so the treads read as moving against them.
    const v = vectors[link.belt.facing]
    ctx.fillStyle = "#9d9384"
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.arc(-v.y * side * c * 0.235, v.x * side * c * 0.235, Math.max(1, c * 0.025), 0, Math.PI * 2)
      ctx.fill()
    }
    if (!link.linked) barrier(ctx, c, link.belt.facing)
  })
}

/** A striped road barrier across a belt's front: this run leads nowhere. */
function barrier(ctx: CanvasRenderingContext2D, c: number, facing: Facing) {
  ctx.save()
  ctx.rotate(angles[facing])
  const x = c * 0.33
  const w = c * 0.14
  const h = c * 0.8
  ctx.beginPath()
  ctx.roundRect(x, -h / 2, w, h, c * 0.04)
  ctx.save()
  ctx.clip()
  ctx.fillStyle = white
  ctx.fillRect(x, -h / 2, w, h)
  ctx.fillStyle = bad
  for (let y = -h / 2 - w; y < h / 2; y += w * 1.6) {
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + w, y + w * 0.8)
    ctx.lineTo(x + w, y + w * 1.6)
    ctx.lineTo(x, y + w * 0.8)
    ctx.fill()
  }
  ctx.restore()
  ctx.strokeStyle = ink
  ctx.lineWidth = Math.max(1.5, c * 0.035)
  ctx.stroke()
  ctx.restore()
}

const eventShapes = 5

/** Events of one type share a silhouette as well as a color, so color is never the only cue. */
export function shapeIndex(type: string): number {
  let h = 0
  for (let i = 0; i < type.length; i++) h = (h * 31 + type.charCodeAt(i)) >>> 0
  return h % eventShapes
}

function tokenPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, shape: number) {
  ctx.beginPath()
  switch (shape) {
    case 0:
      ctx.roundRect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8, r * 0.22)
      return
    case 1:
      ctx.arc(x, y, r, 0, Math.PI * 2)
      return
    case 2:
      poly(ctx, [
        [x, y - r * 1.15],
        [x + r * 1.15, y + r * 0.85],
        [x - r * 1.15, y + r * 0.85],
      ])
      return
    case 3:
      poly(ctx, [0, 1, 2, 3, 4, 5].map((k) => [x + Math.cos((k * Math.PI) / 3 + Math.PI / 6) * r * 1.08, y + Math.sin((k * Math.PI) / 3 + Math.PI / 6) * r * 1.08] as const))
      return
    default:
      poly(ctx, [
        [x, y - r * 1.2],
        [x + r * 1.05, y],
        [x, y + r * 1.2],
        [x - r * 1.05, y],
      ])
  }
}

/** An event on the belt: a little crate, coin, wedge, nut or gem in the event's color. */
export function token(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, color: string, shape: number) {
  const r = c * 0.15
  const lw = Math.max(1.5, c * 0.032)
  tokenPath(ctx, x + c * 0.04, y + c * 0.05, r, shape)
  ctx.fillStyle = shadow
  ctx.fill()
  tokenPath(ctx, x, y, r, shape)
  ctx.fillStyle = color
  ctx.fill()
  ctx.strokeStyle = ink
  ctx.lineWidth = lw
  ctx.stroke()
  // Detail that sells the material: planks on a crate, a rim on a coin, a hole in a nut.
  ctx.lineWidth = Math.max(1, lw * 0.6)
  ctx.strokeStyle = shade(color, 0.4)
  ctx.beginPath()
  if (shape === 0) {
    line(ctx, x - r * 0.9, y, x + r * 0.9, y)
    line(ctx, x - r * 0.55, y - r * 0.9, x - r * 0.55, y + r * 0.9)
  } else if (shape === 1) ctx.arc(x, y, r * 0.6, 0, Math.PI * 2)
  else if (shape === 3) ctx.arc(x, y, r * 0.38, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = "rgba(255,255,255,0.55)"
  ctx.beginPath()
  ctx.arc(x - r * 0.35, y - r * 0.38, r * 0.22, 0, Math.PI * 2)
  ctx.fill()
}

export function crate(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, color: string, shape: number, duplicate: boolean) {
  if (!duplicate) return token(ctx, x, y, c, color, shape)
  // A redelivery rides as a stack of two, with a "2" sticker: the same thing, sent again.
  token(ctx, x - c * 0.07, y - c * 0.1, c, mix(color, white, 0.35), shape)
  token(ctx, x + c * 0.04, y + c * 0.03, c, color, shape)
  if (c >= 28) pill(ctx, x + c * 0.17, y - c * 0.16, c * 0.8, "2", white, ink)
}
