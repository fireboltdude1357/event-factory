import type { Fx, FxKind } from "../core/fx"
import { key } from "./draw"

export interface Motion {
  sx: number
  sy: number
  dx: number
}

const shakers = new Set<FxKind>(["failed", "rejected", "dropped", "duplicateApplied"])

/** Placement keyframes as (t, scale x, scale y): drop in tall, squash on landing, settle. */
const squashKeys = [
  [0, 0.55, 1.45],
  [0.32, 1.22, 0.74],
  [0.56, 0.93, 1.09],
  [0.8, 1.03, 0.97],
  [1, 1, 1],
] as const

function squash(t: number): readonly [number, number] {
  for (let i = 1; i < squashKeys.length; i++) {
    const b = squashKeys[i]
    const a = squashKeys[i - 1]
    if (!a || !b || t > b[0]) continue
    const u = (t - a[0]) / (b[0] - a[0])
    return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]
  }
  return [1, 1]
}

/** How each cell's occupant moves this frame: squash on placement, a bounce on delivery, a shake on trouble. */
export function motionOf(fx: readonly Fx[]): Map<string, Motion> {
  const out = new Map<string, Motion>()
  for (const f of fx) {
    const m = out.get(key(f.at)) ?? { sx: 1, sy: 1, dx: 0 }
    if (f.kind === "placed") {
      const [sx, sy] = squash(f.t)
      m.sx *= sx
      m.sy *= sy
    } else if (f.kind === "delivered") {
      const s = Math.sin(Math.min(1, f.t * 2.4) * Math.PI) * 0.13
      m.sx *= 1 + s
      m.sy *= 1 - s
    } else if (shakers.has(f.kind)) m.dx += Math.sin(f.t * 40) * (1 - f.t) * 0.08
    out.set(key(f.at), m)
  }
  return out
}

export function applyMotion(ctx: CanvasRenderingContext2D, m: Motion | undefined, c: number) {
  if (!m) return
  const base = c * 0.4
  ctx.translate(m.dx * c, base)
  ctx.scale(m.sx, m.sy)
  ctx.translate(0, -base)
}
