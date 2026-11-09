import type { Painter, Scene } from "../core/board"
import type { IconSubject } from "../core/icon"
import { belts, crate, shapeIndex } from "./belts"
import { block, building, tab, tags, woodBlock } from "./blocks"
import { arrowHead, bad, gridLine, ink, key, line, mat, peg, rail, rubber, shadow, stroke, table, toyColor, tread, white } from "./draw"
import { cursor, effects, ending } from "./effects"
import { applyMotion, motionOf } from "./motion"

/** The toy-line map: a cream mat on a pegboard, chunky plastic blocks, rubber belts and little crates. */
export const paint: Painter = (ctx, scene) => {
  const { frame, cell: c, ox, oy } = scene
  ctx.lineJoin = "round"
  ctx.lineCap = "butt"
  floor(ctx, scene)

  ctx.save()
  ctx.translate(ox, oy)
  const motion = motionOf(scene.fx)
  belts(ctx, scene.links.belts, c, frame.time / frame.ticksPerTile, motion)

  for (const link of scene.links.buildings) {
    const b = link.building
    ctx.save()
    ctx.translate((b.at.x + 0.5) * c, (b.at.y + 0.5) * c)
    applyMotion(ctx, motion.get(key(b.at)), c)
    building(ctx, c, link, frame.time)
    ctx.restore()
  }
  cursor(ctx, scene)
  for (const p of scene.parcels) crate(ctx, p.x * c, p.y * c, c, p.parcel.color, shapeIndex(p.parcel.type), p.parcel.duplicate)
  for (const link of scene.links.buildings) tags(ctx, link, c)
  effects(ctx, scene.fx, c)
  ctx.restore()

  if (scene.ending) ending(ctx, scene, scene.ending)
}

/** One palette tile's picture: the block, belt piece or eraser, centered in a square of `size`. */
export function paintIcon(ctx: CanvasRenderingContext2D, size: number, what: IconSubject) {
  ctx.clearRect(0, 0, size, size)
  ctx.save()
  ctx.lineJoin = "round"
  ctx.translate(size / 2, size / 2)
  if (what === "belt") {
    ctx.rotate(-Math.PI / 4)
    const c = size * 0.95
    const run = () => line(ctx, -c * 0.36, 0, c * 0.36, 0)
    ctx.lineCap = "round"
    ctx.save()
    ctx.translate(c * 0.05, c * 0.07)
    stroke(ctx, shadow, c * 0.62, run)
    ctx.restore()
    stroke(ctx, ink, c * 0.62, run)
    stroke(ctx, rail, c * 0.52, run)
    stroke(ctx, rubber, c * 0.36, run)
    ctx.lineCap = "butt"
    for (let i = -2; i <= 2; i++) stroke(ctx, tread, Math.max(1.5, c * 0.04), () => line(ctx, i * c * 0.12, -c * 0.15, i * c * 0.12, c * 0.15))
    arrowHead(ctx, c * 0.06, 0, 0, c * 0.14, white)
  } else if (what === "erase") {
    ctx.lineCap = "round"
    const x = () => {
      line(ctx, -size * 0.22, -size * 0.22, size * 0.22, size * 0.22)
      line(ctx, size * 0.22, -size * 0.22, -size * 0.22, size * 0.22)
    }
    ctx.save()
    ctx.translate(size * 0.04, size * 0.05)
    stroke(ctx, shadow, size * 0.2, x)
    ctx.restore()
    stroke(ctx, ink, size * 0.2, x)
    stroke(ctx, bad, size * 0.11, x)
  } else {
    const c = size * 0.86
    tab(ctx, c, "east", toyColor(what), true)
    block(ctx, c, what, "idle", null)
  }
  ctx.restore()
}

function floor(ctx: CanvasRenderingContext2D, scene: Scene) {
  const { frame, cell: c, ox, oy, width, height } = scene
  ctx.fillStyle = table
  ctx.fillRect(0, 0, width, height)

  // Pegboard holes around the mat, on the map's own grid.
  const step = Math.max(12, c / 2)
  const r = Math.max(1, c * 0.035)
  ctx.fillStyle = peg
  ctx.beginPath()
  for (let x = ((ox % step) + step) % step; x < width; x += step)
    for (let y = ((oy % step) + step) % step; y < height; y += step) {
      ctx.moveTo(x + r, y)
      ctx.arc(x, y, r, 0, Math.PI * 2)
    }
  ctx.fill()

  const w = frame.width * c
  const h = frame.height * c
  const pad = Math.max(6, c * 0.2)
  const radius = Math.max(6, c * 0.22)
  ctx.fillStyle = shadow
  ctx.beginPath()
  ctx.roundRect(ox - pad + c * 0.08, oy - pad + c * 0.1, w + pad * 2, h + pad * 2, radius)
  ctx.fill()
  ctx.fillStyle = mat
  ctx.strokeStyle = ink
  ctx.lineWidth = Math.max(2, c * 0.045)
  ctx.beginPath()
  ctx.roundRect(ox - pad, oy - pad, w + pad * 2, h + pad * 2, radius)
  ctx.fill()
  ctx.stroke()

  ctx.strokeStyle = gridLine
  ctx.lineWidth = Math.max(1, c * 0.02)
  ctx.beginPath()
  for (let x = 1; x < frame.width; x++) line(ctx, ox + x * c, oy, ox + x * c, oy + h)
  for (let y = 1; y < frame.height; y++) line(ctx, ox, oy + y * c, ox + w, oy + y * c)
  ctx.stroke()

  // Ruler ticks along the mat's top and left edges, like a cutting mat.
  if (c >= 20) {
    ctx.strokeStyle = "#cdb98f"
    ctx.lineWidth = Math.max(1, c * 0.022)
    ctx.beginPath()
    for (let x = 0; x <= frame.width * 2; x++) {
      const len = x % 2 === 0 ? pad * 0.6 : pad * 0.32
      line(ctx, ox + (x * c) / 2, oy - pad, ox + (x * c) / 2, oy - pad + len)
    }
    for (let y = 0; y <= frame.height * 2; y++) {
      const len = y % 2 === 0 ? pad * 0.6 : pad * 0.32
      line(ctx, ox - pad, oy + (y * c) / 2, ox - pad + len, oy + (y * c) / 2)
    }
    ctx.stroke()
  }

  frame.terrain.forEach((t, i) => {
    if (t !== "wall") return
    ctx.save()
    ctx.translate(ox + ((i % frame.width) + 0.5) * c, oy + (Math.floor(i / frame.width) + 0.5) * c)
    woodBlock(ctx, c)
    ctx.restore()
  })
}
