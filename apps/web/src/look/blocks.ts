import type { BuildingShape } from "@event-factory/engine"
import { angles, opposite, vectors, type Building, type BuildingLink, type Facing } from "../core/geometry"
import type { Look } from "../core/level"
import { arrowHead, bad, display, ink, line, rubber, shade, shadow, toyColor, warn, white } from "./draw"

/** A wall: a wooden building block with grain on its face. */
export function woodBlock(ctx: CanvasRenderingContext2D, c: number) {
  const s = c * 0.9
  const d = Math.max(2, Math.round(c * 0.1))
  const lw = Math.max(1.5, c * 0.035)
  const path = () => {
    ctx.beginPath()
    ctx.roundRect(-s / 2, -s / 2, s, s, c * 0.1)
  }
  extrude(ctx, path, d, lw, "#9a7550", "#c9a171")
  ctx.save()
  ctx.translate(0, -d / 2)
  path()
  ctx.clip()
  ctx.strokeStyle = "#b58b5c"
  ctx.lineWidth = Math.max(1, c * 0.022)
  ctx.beginPath()
  for (let k = -2; k <= 2; k++) {
    const y = k * s * 0.18
    ctx.moveTo(-s / 2, y)
    ctx.bezierCurveTo(-s * 0.15, y - s * 0.07, s * 0.15, y + s * 0.07, s / 2, y)
  }
  ctx.stroke()
  ctx.restore()
}

/**
 * Draws a block: a hard shadow, a side face `d` pixels deep and a top face, all
 * outlined in ink. `path` traces the silhouette centered on the origin; the top
 * face ends up centered on (0, -d/2) so the block as a whole sits on the cell.
 */
function extrude(ctx: CanvasRenderingContext2D, path: () => void, d: number, lw: number, sideColor: string, topColor: string) {
  ctx.save()
  ctx.translate(d * 0.7, d * 1.3)
  path()
  ctx.fillStyle = shadow
  ctx.fill()
  ctx.restore()

  ctx.strokeStyle = ink
  for (let i = d; i >= 0; i--) {
    ctx.save()
    ctx.translate(0, i - d / 2)
    path()
    ctx.lineWidth = lw * 2
    ctx.stroke()
    ctx.fillStyle = i === 0 ? topColor : sideColor
    ctx.fill()
    ctx.restore()
  }
}

/** A building's silhouette, centered on the origin. Each shape reads differently before color or glyph. */
export function silhouette(ctx: CanvasRenderingContext2D, shape: BuildingShape, s: number) {
  ctx.beginPath()
  switch (shape) {
    case "producer":
      ctx.arc(0, 0, s * 0.5, 0, Math.PI * 2)
      return
    case "queue":
      ctx.roundRect(-s / 2, -s * 0.42, s, s * 0.84, s * 0.12)
      return
    case "topic":
      poly(ctx, [0, 1, 2, 3, 4, 5].map((k) => [Math.cos((k * Math.PI) / 3) * s * 0.55, Math.sin((k * Math.PI) / 3) * s * 0.55] as const))
      return
    case "handler":
      ctx.roundRect(-s / 2, -s / 2, s, s, s * 0.2)
      return
    case "router":
      poly(ctx, [
        [0, -s * 0.58],
        [s * 0.58, 0],
        [0, s * 0.58],
        [-s * 0.58, 0],
      ])
      return
    case "external":
      poly(ctx, [
        [-s / 2, s * 0.46],
        [-s / 2, -s * 0.1],
        [0, -s * 0.54],
        [s / 2, -s * 0.1],
        [s / 2, s * 0.46],
      ])
      return
    case "deadLetter":
      poly(ctx, [
        [-s * 0.52, -s * 0.44],
        [s * 0.52, -s * 0.44],
        [s * 0.38, s * 0.48],
        [-s * 0.38, s * 0.48],
      ])
      return
  }
}

export function poly(ctx: CanvasRenderingContext2D, points: readonly (readonly [number, number])[]) {
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  ctx.closePath()
}

interface Live {
  readonly work: number | null
  readonly fill: number | null
  readonly time: number
}

const blockSize = 0.74
const depthOf = (c: number) => Math.max(2, Math.round(c * 0.11))

/** The plastic body every building shares plus the motif that says what it does. Also the palette icon and the ghost. */
export function block(ctx: CanvasRenderingContext2D, c: number, look: Look, state: Building["state"], live: Live | null) {
  const s = c * blockSize
  const d = depthOf(c)
  const lw = Math.max(1.5, c * 0.038)
  const color = toyColor(look)
  extrude(ctx, () => silhouette(ctx, look.shape, s), d, lw, shade(color, 0.38), color)

  ctx.save()
  ctx.translate(0, -d / 2)
  // A plastic gloss, top-left.
  ctx.save()
  silhouette(ctx, look.shape, s)
  ctx.clip()
  ctx.fillStyle = "rgba(255,255,255,0.28)"
  ctx.beginPath()
  ctx.ellipse(-s * 0.22, -s * 0.26, s * 0.24, s * 0.1, -0.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  if (state === "stalled" || state === "failing") {
    ctx.save()
    ctx.scale(1.2, 1.2)
    silhouette(ctx, look.shape, s)
    ctx.restore()
    ctx.strokeStyle = state === "failing" ? bad : warn
    ctx.lineWidth = Math.max(2, c * 0.05)
    ctx.setLineDash([c * 0.09, c * 0.06])
    ctx.stroke()
    ctx.setLineDash([])
  }

  motif(ctx, c, s, look, color, live)
  ctx.restore()
}

function motif(ctx: CanvasRenderingContext2D, c: number, s: number, look: Look, color: string, live: Live | null) {
  const lw = Math.max(1, c * 0.025)
  let stickerY = 0
  switch (look.shape) {
    case "producer": {
      ctx.strokeStyle = shade(color, 0.3)
      ctx.lineWidth = Math.max(1.5, c * 0.035)
      ctx.beginPath()
      ctx.arc(0, 0, s * 0.37, 0, Math.PI * 2)
      ctx.stroke()
      break
    }
    case "queue":
    case "topic": {
      // A window of four slots that fill white as the broker's buffer fills.
      stickerY = -s * 0.07
      const cells = 4
      const total = s * (look.shape === "topic" ? 0.5 : 0.62)
      const gap = s * 0.035
      const w = (total - gap * (cells - 1)) / cells
      const y = s * 0.24
      const full = live?.fill == null ? 0 : Math.ceil(live.fill * cells - 1e-9)
      for (let i = 0; i < cells; i++) {
        ctx.beginPath()
        ctx.roundRect(-total / 2 + i * (w + gap), y, w, s * 0.11, s * 0.03)
        ctx.fillStyle = i < full ? (live?.fill === 1 ? "#ffe066" : white) : shade(color, 0.45)
        ctx.fill()
        ctx.strokeStyle = ink
        ctx.lineWidth = lw
        ctx.stroke()
      }
      break
    }
    case "handler": {
      // A cog that turns only while a job runs.
      const turnBy = live?.work == null ? 0 : live.time * 0.7
      gear(ctx, s * 0.34, s * 0.42, 8, turnBy, shade(color, 0.2), lw)
      break
    }
    case "router": {
      ctx.fillStyle = shade(color, 0.3)
      for (const f of ["north", "east", "south", "west"] as const) {
        ctx.beginPath()
        ctx.arc(vectors[f].x * s * 0.4, vectors[f].y * s * 0.4, s * 0.04, 0, Math.PI * 2)
        ctx.fill()
      }
      break
    }
    case "external": {
      // An awning across the roof, and a door that fills as the effect is applied.
      ctx.save()
      silhouette(ctx, look.shape, s)
      ctx.clip()
      ctx.fillStyle = "rgba(255,255,255,0.85)"
      for (let x = -s; x < s; x += s * 0.2) {
        ctx.beginPath()
        ctx.moveTo(x, -s * 0.6)
        ctx.lineTo(x + s * 0.1, -s * 0.6)
        ctx.lineTo(x + s * 0.1, -s * 0.12)
        ctx.lineTo(x, -s * 0.12)
        ctx.fill()
      }
      ctx.restore()
      ctx.strokeStyle = ink
      ctx.lineWidth = lw
      ctx.beginPath()
      ctx.moveTo(-s / 2, -s * 0.1)
      ctx.lineTo(s / 2, -s * 0.1)
      ctx.stroke()
      stickerY = s * 0.12
      if (live?.work != null) progressBar(ctx, -s * 0.3, s * 0.34, s * 0.6, s * 0.08, live.work, lw)
      break
    }
    case "deadLetter": {
      ctx.save()
      silhouette(ctx, look.shape, s)
      ctx.clip()
      ctx.fillStyle = "#ffd43b"
      ctx.fillRect(-s, -s * 0.5, s * 2, s * 0.2)
      ctx.strokeStyle = ink
      ctx.lineWidth = s * 0.07
      ctx.beginPath()
      for (let x = -s; x < s; x += s * 0.18) line(ctx, x, -s * 0.3, x + s * 0.2, -s * 0.5)
      ctx.stroke()
      ctx.lineWidth = lw
      ctx.beginPath()
      line(ctx, -s, -s * 0.3, s, -s * 0.3)
      ctx.stroke()
      ctx.restore()
      stickerY = s * 0.08
      break
    }
  }

  sticker(ctx, 0, stickerY, c * 0.165, look.glyph, lw)

  if (look.shape === "handler" && live?.work != null) {
    ctx.lineCap = "round"
    ctx.strokeStyle = ink
    ctx.lineWidth = c * 0.075
    ctx.beginPath()
    ctx.arc(0, 0, c * 0.205, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * live.work)
    ctx.stroke()
    ctx.strokeStyle = white
    ctx.lineWidth = c * 0.04
    ctx.stroke()
    ctx.lineCap = "butt"
  }
}

export function sticker(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, glyph: string, lw: number) {
  ctx.fillStyle = white
  ctx.strokeStyle = ink
  ctx.lineWidth = lw
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = ink
  ctx.font = `700 ${Math.round(r * 1.3)}px ${display}`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(glyph, x, y + r * 0.06)
}

function gear(ctx: CanvasRenderingContext2D, inner: number, outer: number, teeth: number, rotation: number, color: string, lw: number) {
  ctx.save()
  ctx.rotate(rotation)
  ctx.beginPath()
  const step = (Math.PI * 2) / teeth
  for (let i = 0; i < teeth; i++) {
    const a = i * step
    ctx.lineTo(Math.cos(a - step * 0.3) * inner, Math.sin(a - step * 0.3) * inner)
    ctx.lineTo(Math.cos(a - step * 0.18) * outer, Math.sin(a - step * 0.18) * outer)
    ctx.lineTo(Math.cos(a + step * 0.18) * outer, Math.sin(a + step * 0.18) * outer)
    ctx.lineTo(Math.cos(a + step * 0.3) * inner, Math.sin(a + step * 0.3) * inner)
  }
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  ctx.strokeStyle = ink
  ctx.lineWidth = lw
  ctx.stroke()
  ctx.restore()
}

function progressBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, share: number, lw: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, h / 2)
  ctx.fillStyle = "rgba(42,31,23,0.35)"
  ctx.fill()
  ctx.save()
  ctx.clip()
  ctx.fillStyle = white
  ctx.fillRect(x, y, w * share, h)
  ctx.restore()
  ctx.strokeStyle = ink
  ctx.lineWidth = lw
  ctx.stroke()
}

/** An output chute: solid with an arrow when it leads somewhere, a hollow dashed stub when it does not. */
export function tab(ctx: CanvasRenderingContext2D, c: number, facing: Facing, color: string, linked: boolean) {
  const lw = Math.max(1.5, c * 0.035)
  ctx.save()
  ctx.rotate(angles[facing])
  ctx.beginPath()
  ctx.roundRect(c * 0.22, -c * 0.14, c * 0.28, c * 0.28, c * 0.05)
  ctx.fillStyle = linked ? color : "#efe6d2"
  ctx.fill()
  ctx.strokeStyle = ink
  ctx.lineWidth = lw
  if (!linked) ctx.setLineDash([c * 0.05, c * 0.04])
  ctx.stroke()
  ctx.setLineDash([])
  if (linked) arrowHead(ctx, c * 0.43, 0, 0, c * 0.08, white)
  ctx.restore()
}

/** The input mouth on a building's back: a dark slot when a belt feeds it, an empty dashed one when nothing does. */
function mouth(ctx: CanvasRenderingContext2D, c: number, side: Facing, fed: boolean) {
  ctx.save()
  ctx.rotate(angles[side])
  ctx.beginPath()
  ctx.roundRect(c * 0.28, -c * 0.19, c * 0.2, c * 0.38, c * 0.06)
  ctx.fillStyle = fed ? rubber : "#efe6d2"
  ctx.fill()
  ctx.strokeStyle = ink
  ctx.lineWidth = Math.max(1.5, c * 0.035)
  if (!fed) ctx.setLineDash([c * 0.05, c * 0.04])
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
}

export function building(ctx: CanvasRenderingContext2D, c: number, link: BuildingLink, time: number) {
  const b = link.building
  const color = toyColor(b)
  if (b.shape !== "producer") mouth(ctx, c, opposite(b.facing), link.fed)
  for (const out of link.outs) tab(ctx, c, out.facing, color, out.linked)
  block(ctx, c, b, b.state, { work: b.work, fill: b.fill, time })

  const s = c * blockSize
  const d = depthOf(c)
  const lw = Math.max(1, c * 0.025)
  const corner = s * 0.46
  const top = -d / 2 - corner

  if (b.locked) {
    for (const sx of [-1, 1]) screw(ctx, sx * s * 0.36, -d / 2 + (b.shape === "router" ? 0 : s * 0.3), c * 0.045, lw)
  }

  let right = 0
  if (b.retry) {
    // A kitchen timer: the wedge is the wait still to go. Its tag says which attempt is next.
    const r = c * 0.13
    ctx.fillStyle = white
    ctx.strokeStyle = ink
    ctx.lineWidth = lw * 1.2
    ctx.beginPath()
    ctx.arc(corner, top, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = warn
    ctx.beginPath()
    ctx.moveTo(corner, top)
    ctx.arc(corner, top, r * 0.82, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * b.retry.wait)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.arc(corner, top, r, 0, Math.PI * 2)
    ctx.stroke()
    pill(ctx, -corner * 0.55, top, c, `try ${b.retry.attempt}/${b.retry.of}`, warn, ink)
    right = 1
  } else if (b.state === "failing") pill(ctx, -corner * 0.7, top, c, "!", bad, white)
  else if (b.state === "stalled") warning(ctx, -corner, top, c * 0.15, lw)

  if (b.load > 1) pill(ctx, corner, right ? -d / 2 + corner * 0.75 : top, c, String(b.load), white, ink)
}

function screw(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, lw: number) {
  ctx.fillStyle = "#e6e0d4"
  ctx.strokeStyle = ink
  ctx.lineWidth = lw
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  line(ctx, x - r * 0.6, y - r * 0.6, x + r * 0.6, y + r * 0.6)
  line(ctx, x + r * 0.6, y - r * 0.6, x - r * 0.6, y + r * 0.6)
  ctx.stroke()
}

function warning(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, lw: number) {
  ctx.beginPath()
  ctx.moveTo(x, y - r)
  ctx.lineTo(x + r * 1.1, y + r * 0.85)
  ctx.lineTo(x - r * 1.1, y + r * 0.85)
  ctx.closePath()
  ctx.fillStyle = "#ffd43b"
  ctx.fill()
  ctx.strokeStyle = ink
  ctx.lineWidth = lw * 1.4
  ctx.stroke()
  ctx.fillStyle = ink
  ctx.font = `700 ${Math.round(r * 1.25)}px ${display}`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText("!", x, y + r * 0.22)
}

export function pill(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, text: string, fill: string, color: string) {
  const size = Math.max(9, Math.round(c * 0.15))
  ctx.font = `700 ${size}px ${display}`
  const w = Math.max(size * 1.45, ctx.measureText(text).width + size * 0.75)
  ctx.fillStyle = fill
  ctx.strokeStyle = ink
  ctx.lineWidth = Math.max(1.5, c * 0.028)
  ctx.beginPath()
  ctx.roundRect(x - w / 2, y - size * 0.72, w, size * 1.44, size * 0.72)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = color
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(text, x, y + size * 0.06)
}

/**
 * Paper labels: a building's title on its front face, and port names when a
 * machine has more than one output. The title moves to the top edge when
 * something leaves or enters from below. Side port names take the other edge,
 * and top or bottom port names sit to the left of their chute.
 */
export function tags(ctx: CanvasRenderingContext2D, link: BuildingLink, c: number) {
  const b = link.building
  const cx = (b.at.x + 0.5) * c
  const cy = (b.at.y + 0.5) * c
  const below = link.outs.some((o) => o.facing === "south") || (b.shape !== "producer" && b.facing === "north")
  if (c >= 44) label(ctx, cx, below ? cy - c * 0.5 : cy + c * 0.47, b.title, Math.max(10, Math.round(c * 0.145)), ink, c * 1.7)
  if (c < 30 || link.outs.filter((o) => o.port !== null).length < 2) return
  for (const out of link.outs) {
    if (out.port === null) continue
    const v = vectors[out.facing]
    const side = v.y === 0
    const px = cx + (side ? v.x * c * 0.42 : -c * 0.44)
    const py = cy + (side ? (below ? c * 0.32 : -c * 0.36) : v.y * c * 0.42)
    label(ctx, px, py, out.port, Math.max(9, Math.round(c * 0.13)), out.linked ? ink : "#8a7a66", c * 1.1)
  }
}

function label(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, size: number, color: string, max: number) {
  ctx.font = `600 ${size}px ${display}`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  let shown = text
  while (shown.length > 3 && ctx.measureText(shown).width > max) shown = `${shown.slice(0, -2).trimEnd()}…`
  const w = ctx.measureText(shown).width + size * 0.9
  const h = size * 1.5
  ctx.fillStyle = shadow
  ctx.beginPath()
  ctx.roundRect(x - w / 2 + 2, y - h / 2 + 2, w, h, size * 0.3)
  ctx.fill()
  ctx.fillStyle = white
  ctx.strokeStyle = ink
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(x - w / 2, y - h / 2, w, h, size * 0.3)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = color
  ctx.fillText(shown, x, y + size * 0.05)
}
