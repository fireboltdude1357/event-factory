import type { Scene } from "../core/board"
import { easeOut, easeOutBack, scatter, type Fx, type FxKind } from "../core/fx"
import { angles, vectors } from "../core/geometry"
import { token } from "./belts"
import { block, tab } from "./blocks"
import { arrowHead, bad, calm, confettiColors, display, ink, key, line, ok, rail, rubber, stroke, toyColor, warn, white } from "./draw"

const labels: Partial<Record<FxKind, { readonly text: string; readonly color: string }>> = {
  delivered: { text: "+1", color: "#3ddc6a" },
  failed: { text: "fail!", color: bad },
  retrying: { text: "retry", color: warn },
  dropped: { text: "lost!", color: bad },
  deadLettered: { text: "dead-lettered", color: warn },
  duplicateApplied: { text: "applied twice!", color: bad },
  duplicateIgnored: { text: "dupe skipped", color: "#4aa3ff" },
  outOfOrder: { text: "out of order", color: warn },
}

export function effects(ctx: CanvasRenderingContext2D, fx: readonly Fx[], c: number) {
  const stacked = new Map<string, number>()
  for (const f of fx) {
    const cx = (f.at.x + 0.5) * c
    const cy = (f.at.y + 0.5) * c
    const fade = 1 - f.t
    switch (f.kind) {
      case "emitted":
      case "produced":
        puffs(ctx, cx, cy - c * 0.2, c, f, 3, -1)
        break
      case "delivered":
        for (let i = 0; i < 7; i++) {
          const a = -Math.PI / 2 + (scatter(f.seed, i) - 0.5) * Math.PI * 1.4
          const d = c * (0.25 + 0.55 * easeOut(f.t) * (0.6 + scatter(f.seed, i + 20) * 0.5))
          ctx.globalAlpha = Math.min(1, fade * 2)
          star(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, c * 0.09 * (1 - f.t * 0.4), f.t * 6 + i, confettiColors[i % confettiColors.length] ?? warn)
        }
        ctx.globalAlpha = 1
        break
      case "failed":
        ctx.globalAlpha = Math.min(1, fade * 1.8)
        burst(ctx, cx, cy - c * 0.1, c * (0.28 + 0.2 * easeOutBack(Math.min(1, f.t * 2.5))), bad, f.seed)
        ctx.globalAlpha = 1
        break
      case "retrying": {
        // A circular arrow that sweeps once around the machine.
        const r = c * 0.56
        const end = -Math.PI / 2 + Math.PI * 1.7 * easeOut(f.t)
        ctx.globalAlpha = Math.min(1, fade * 2.5)
        ctx.lineCap = "round"
        ctx.beginPath()
        ctx.arc(cx, cy, r, -Math.PI / 2, end)
        ctx.strokeStyle = ink
        ctx.lineWidth = c * 0.11
        ctx.stroke()
        ctx.strokeStyle = warn
        ctx.lineWidth = c * 0.06
        ctx.stroke()
        ctx.lineCap = "butt"
        arrowHead(ctx, cx + Math.cos(end) * r, cy + Math.sin(end) * r, end + Math.PI / 2, c * 0.1, warn, true)
        ctx.globalAlpha = 1
        break
      }
      case "dropped": {
        // The event tumbles off the line.
        const t = f.t
        ctx.globalAlpha = Math.min(1, fade * 2)
        ctx.save()
        ctx.translate(cx + c * 0.5 * t * (scatter(f.seed, 1) > 0.5 ? 1 : -1), cy - c * 0.3 + c * (-1.2 * t + 3.2 * t * t))
        ctx.rotate(t * 5)
        token(ctx, 0, 0, c, f.color || bad, 0)
        ctx.restore()
        ctx.globalAlpha = 1
        break
      }
      case "deadLettered": {
        // The event hops into the bin.
        const t = easeOut(Math.min(1, f.t * 1.4))
        if (t < 1) {
          ctx.save()
          ctx.translate(cx - c * 0.6 * (1 - t), cy - c * 0.2 - Math.sin(t * Math.PI) * c * 0.6)
          ctx.rotate(t * 4)
          token(ctx, 0, 0, c * (1 - t * 0.4), f.color || warn, 0)
          ctx.restore()
        }
        break
      }
      case "duplicateApplied":
        ctx.globalAlpha = Math.min(1, fade * 1.8)
        burst(ctx, cx - c * 0.12, cy - c * 0.12, c * 0.3 * easeOutBack(Math.min(1, f.t * 3)), bad, f.seed)
        burst(ctx, cx + c * 0.12, cy + c * 0.04, c * 0.3 * easeOutBack(Math.min(1, Math.max(0, f.t * 3 - 0.4))), "#ff7a59", f.seed + 1)
        ctx.globalAlpha = 1
        break
      case "duplicateIgnored": {
        // A blue shield pops up in front: the copy bounced off.
        const s = easeOutBack(Math.min(1, f.t * 3)) * (1 - Math.max(0, f.t - 0.75) * 4)
        if (s > 0) shield(ctx, cx, cy - c * 0.05, c * 0.24 * s)
        break
      }
      case "outOfOrder":
        ctx.globalAlpha = Math.min(1, fade * 2)
        swap(ctx, cx, cy - c * 0.05, c, f.t)
        ctx.globalAlpha = 1
        break
      case "placed":
        if (f.t > 0.25) puffs(ctx, cx, cy + c * 0.38, c, { ...f, t: (f.t - 0.25) / 0.75 }, 4, 0)
        break
      case "removed":
        puffs(ctx, cx, cy, c, f, 7, 0, 0.5)
        break
      case "rejected": {
        ctx.globalAlpha = fade * 0.3
        ctx.fillStyle = bad
        ctx.beginPath()
        ctx.roundRect(f.at.x * c + 3, f.at.y * c + 3, c - 6, c - 6, c * 0.14)
        ctx.fill()
        ctx.globalAlpha = Math.min(1, fade * 2)
        const s = easeOutBack(Math.min(1, f.t * 3))
        ctx.lineCap = "round"
        const x = () => {
          line(ctx, cx - c * 0.16 * s, cy - c * 0.16 * s, cx + c * 0.16 * s, cy + c * 0.16 * s)
          line(ctx, cx + c * 0.16 * s, cy - c * 0.16 * s, cx - c * 0.16 * s, cy + c * 0.16 * s)
        }
        stroke(ctx, ink, c * 0.13, x)
        stroke(ctx, bad, c * 0.07, x)
        ctx.lineCap = "butt"
        ctx.globalAlpha = 1
        break
      }
    }

    const text = labels[f.kind]
    if (!text) continue
    const k = key(f.at)
    const slot = stacked.get(k) ?? 0
    stacked.set(k, slot + 1)
    if (slot > 2) continue
    const size = Math.max(12, Math.round(c * (f.kind === "delivered" ? 0.3 : 0.19)))
    const pop = easeOutBack(Math.min(1, f.t * 4))
    const y = cy - c * (0.55 + 0.4 * easeOut(f.t)) - slot * size * 1.2
    comic(ctx, text.text, cx, y, size * pop, text.color, Math.min(1, fade * 2.2))
  }
}

function comic(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, alpha: number) {
  if (size < 1) return
  ctx.globalAlpha = Math.max(0, alpha)
  ctx.font = `700 ${Math.round(size)}px ${display}`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.lineJoin = "round"
  ctx.lineWidth = Math.max(3, size * 0.32)
  ctx.strokeStyle = ink
  ctx.strokeText(text, x, y)
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
  ctx.globalAlpha = 1
}

/** Little cartoon smoke puffs. `rise` is -1 to drift up, 0 to spread sideways. */
function puffs(ctx: CanvasRenderingContext2D, cx: number, cy: number, c: number, f: Fx, count: number, rise: number, spread = 0.35) {
  const t = easeOut(f.t)
  ctx.globalAlpha = Math.max(0, 1 - f.t)
  ctx.fillStyle = white
  ctx.strokeStyle = ink
  ctx.lineWidth = Math.max(1, c * 0.022)
  for (let i = 0; i < count; i++) {
    const a = rise === 0 ? (i / count) * Math.PI * 2 + scatter(f.seed, i) : -Math.PI / 2 + (scatter(f.seed, i) - 0.5) * 1.6
    const d = c * spread * t * (0.7 + scatter(f.seed, i + 9) * 0.6)
    const r = c * (0.05 + 0.06 * t) * (0.7 + scatter(f.seed, i + 3) * 0.6)
    ctx.beginPath()
    ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d + rise * c * 0.25 * t, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rotation: number, color: string) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rotation)
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 === 0 ? r : r * 0.45
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
  }
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  ctx.strokeStyle = ink
  ctx.lineWidth = Math.max(1, r * 0.25)
  ctx.stroke()
  ctx.restore()
}

/** A cartoon "bang": a jagged star with an ink rim. */
function burst(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, seed: number) {
  if (r <= 0) return
  ctx.beginPath()
  const points = 12
  for (let i = 0; i < points * 2; i++) {
    const a = (i * Math.PI) / points
    const rr = i % 2 === 0 ? r * (0.9 + scatter(seed, i) * 0.25) : r * 0.55
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
  }
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  ctx.strokeStyle = ink
  ctx.lineWidth = Math.max(1.5, r * 0.1)
  ctx.stroke()
  ctx.fillStyle = "#ffe066"
  ctx.beginPath()
  ctx.arc(x, y, r * 0.28, 0, Math.PI * 2)
  ctx.fill()
}

function shield(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x, y - r)
  ctx.lineTo(x + r * 0.85, y - r * 0.65)
  ctx.quadraticCurveTo(x + r * 0.8, y + r * 0.6, x, y + r * 1.05)
  ctx.quadraticCurveTo(x - r * 0.8, y + r * 0.6, x - r * 0.85, y - r * 0.65)
  ctx.closePath()
  ctx.fillStyle = calm
  ctx.fill()
  ctx.strokeStyle = ink
  ctx.lineWidth = Math.max(1.5, r * 0.14)
  ctx.stroke()
  ctx.lineCap = "round"
  stroke(ctx, white, Math.max(1.5, r * 0.16), () => {
    ctx.moveTo(x - r * 0.38, y)
    ctx.lineTo(x - r * 0.08, y + r * 0.3)
    ctx.lineTo(x + r * 0.42, y - r * 0.28)
  })
  ctx.lineCap = "butt"
}

function swap(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, t: number) {
  const s = c * 0.2
  const shift = Math.sin(t * Math.PI) * c * 0.06
  ctx.lineCap = "round"
  for (const dir of [-1, 1]) {
    const yy = y + dir * c * 0.09
    stroke(ctx, ink, c * 0.09, () => line(ctx, x - s * dir + shift * dir, yy, x + s * dir + shift * dir, yy))
    stroke(ctx, warn, c * 0.045, () => line(ctx, x - s * dir + shift * dir, yy, x + s * dir + shift * dir, yy))
    arrowHead(ctx, x + s * dir + shift * dir, yy, dir === 1 ? 0 : Math.PI, c * 0.07, warn, true)
  }
  ctx.lineCap = "butt"
}

export function cursor(ctx: CanvasRenderingContext2D, scene: Scene) {
  const { cell: c, selected, hover, ghost } = scene
  if (selected) {
    // A chunky yellow selection tile, outlined in ink.
    const x = selected.x * c
    const y = selected.y * c
    ctx.beginPath()
    ctx.roundRect(x + 1, y + 1, c - 2, c - 2, c * 0.16)
    ctx.strokeStyle = ink
    ctx.lineWidth = Math.max(4, c * 0.1)
    ctx.stroke()
    ctx.strokeStyle = "#ffd60a"
    ctx.lineWidth = Math.max(2, c * 0.055)
    ctx.stroke()
  }
  if (!hover) return
  if (!ghost) {
    ctx.strokeStyle = "rgba(42, 31, 23, 0.4)"
    ctx.lineWidth = Math.max(1.5, c * 0.03)
    ctx.setLineDash([c * 0.1, c * 0.07])
    ctx.beginPath()
    ctx.roundRect(hover.x * c + 3, hover.y * c + 3, c - 6, c - 6, c * 0.14)
    ctx.stroke()
    ctx.setLineDash([])
    return
  }
  const tint = ghost.ok ? "#22c55e" : bad
  const cx = (ghost.at.x + 0.5) * c
  const cy = (ghost.at.y + 0.5) * c
  ctx.fillStyle = tint
  ctx.globalAlpha = 0.2
  ctx.beginPath()
  ctx.roundRect(ghost.at.x * c + 2, ghost.at.y * c + 2, c - 4, c - 4, c * 0.14)
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.strokeStyle = tint
  ctx.lineWidth = Math.max(2, c * 0.05)
  ctx.setLineDash([c * 0.12, c * 0.08])
  ctx.stroke()
  ctx.setLineDash([])

  ctx.save()
  ctx.translate(cx, cy)
  if (ghost.what.kind === "erase") {
    ctx.globalAlpha = ghost.ok ? 1 : 0.45
    ctx.lineCap = "round"
    const x = () => {
      line(ctx, -c * 0.18, -c * 0.18, c * 0.18, c * 0.18)
      line(ctx, c * 0.18, -c * 0.18, -c * 0.18, c * 0.18)
    }
    stroke(ctx, ink, c * 0.14, x)
    stroke(ctx, bad, c * 0.07, x)
  } else if (ghost.what.kind === "belt") {
    ctx.globalAlpha = 0.8
    const v = vectors[ghost.facing]
    const run = () => line(ctx, -v.x * c * 0.3, -v.y * c * 0.3, v.x * c * 0.3, v.y * c * 0.3)
    ctx.lineCap = "round"
    stroke(ctx, ink, c * 0.62, run)
    stroke(ctx, rail, c * 0.52, run)
    stroke(ctx, rubber, c * 0.36, run)
    ctx.lineCap = "butt"
    arrowHead(ctx, v.x * c * 0.08, v.y * c * 0.08, angles[ghost.facing], c * 0.13, white)
  } else {
    ctx.globalAlpha = ghost.ok ? 0.8 : 0.45
    tab(ctx, c, ghost.facing, toyColor(ghost.what.look), true)
    block(ctx, c, ghost.what.look, "idle", null)
  }
  ctx.restore()
  ctx.globalAlpha = 1
}

export function ending(ctx: CanvasRenderingContext2D, scene: Scene, end: { readonly won: boolean; readonly t: number }) {
  const { width, height, frame, cell: c, ox, oy } = scene
  const pad = Math.max(6, c * 0.2)
  const flash = Math.max(0, 1 - end.t * 2.5)
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(ox - pad, oy - pad, frame.width * c + pad * 2, frame.height * c + pad * 2, Math.max(6, c * 0.22))
  if (!end.won) {
    // The line grinds to a halt: a grey wash and a red rim.
    ctx.fillStyle = `rgba(60, 48, 40, ${0.22 * Math.sin(Math.min(1, end.t * 1.5) * Math.PI)})`
    ctx.fill()
  }
  ctx.strokeStyle = end.won ? "#22c55e" : bad
  ctx.globalAlpha = Math.max(0, 1 - end.t)
  ctx.lineWidth = 3 + flash * c * 0.18
  ctx.stroke()
  ctx.restore()
  if (!end.won) return

  // Confetti from above, fluttering down over the whole board.
  const count = 120
  for (let i = 0; i < count; i++) {
    const delay = scatter(7, i) * 0.4
    const t = (end.t - delay) / 0.6
    if (t <= 0 || t >= 1) continue
    const x = scatter(11, i) * width + Math.sin(t * 9 + i) * c * 0.3
    const y = -20 + t * (height + 40) * (0.6 + scatter(13, i) * 0.5)
    ctx.globalAlpha = Math.min(1, (1 - t) * 4)
    ctx.fillStyle = confettiColors[i % confettiColors.length] ?? ok
    ctx.strokeStyle = ink
    ctx.lineWidth = 1
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(t * 12 + i)
    ctx.scale(1, Math.cos(t * 14 + i))
    const w = Math.max(10, c * 0.22)
    ctx.fillRect(-w / 2, -w / 4, w, w / 2)
    ctx.strokeRect(-w / 2, -w / 4, w, w / 2)
    ctx.restore()
  }
  ctx.globalAlpha = 1
}
