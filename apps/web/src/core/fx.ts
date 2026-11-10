import type { FlashTag, RenderFrame } from "@event-factory/engine"
import type { Point } from "./geometry"

/** What the map animates: the engine's flashes, plus the player's own actions. */
export type FxKind = FlashTag | "placed" | "removed" | "rejected"

export interface Fx {
  readonly kind: FxKind
  readonly at: Point
  readonly color: string
  /** 0 at the start, 1 at the end. */
  readonly t: number
  /** Stable per effect, for painters that scatter particles. */
  readonly seed: number
}

const durations: Record<FxKind, number> = {
  emitted: 450,
  produced: 450,
  delivered: 800,
  failed: 650,
  retrying: 700,
  dropped: 900,
  deadLettered: 900,
  duplicateApplied: 1000,
  duplicateIgnored: 900,
  outOfOrder: 900,
  placed: 260,
  removed: 300,
  rejected: 350,
}

/** How long the map keeps animating after a level ends. */
export const celebrationMs = 2600

interface Live {
  readonly kind: FxKind
  readonly at: Point
  readonly color: string
  readonly start: number
  readonly seed: number
}

/**
 * Turns facts into short animations on the wall clock. An effect starts once
 * per engine flash id, runs for a fixed time and ends, so the canvas has
 * nothing to repaint once the game is paused and the last one is over.
 */
export function createFx(onStart: (kind: FxKind) => void = () => {}) {
  let live: Live[] = []
  let run = -1
  let seen = -1
  let seeds = 0
  let ended: { readonly at: number; readonly won: boolean } | null = null

  const add = (kind: FxKind, at: Point, color: string, now: number) => {
    live.push({ kind, at, color, start: now, seed: seeds++ })
    onStart(kind)
  }

  return {
    add,
    /** Starts an effect for each flash not seen before. */
    ingest(frame: RenderFrame, now: number) {
      if (frame.run !== run) {
        run = frame.run
        seen = -1
        live = []
        ended = null
      }
      let newest = seen
      // Newest first in the frame, so walk backwards to start them in order.
      for (let i = frame.flashes.length - 1; i >= 0; i--) {
        const f = frame.flashes[i]
        if (f === undefined || f.id <= seen) continue
        add(f.tag, f.at, f.color, now)
        newest = Math.max(newest, f.id)
      }
      seen = newest
    },
    finish(won: boolean, now: number) {
      if (ended === null) ended = { at: now, won }
    },
    active(now: number): Fx[] {
      live = live.filter((f) => now - f.start < durations[f.kind])
      return live.map((f) => ({ kind: f.kind, at: f.at, color: f.color, seed: f.seed, t: Math.max(0, (now - f.start) / durations[f.kind]) }))
    },
    /** The end-of-level animation's progress, 0 to 1, or null when there is none running. */
    ending(now: number): { readonly won: boolean; readonly t: number } | null {
      if (ended === null || now - ended.at >= celebrationMs) return null
      return { won: ended.won, t: (now - ended.at) / celebrationMs }
    },
    busy(now: number): boolean {
      return live.some((f) => now - f.start < durations[f.kind]) || (ended !== null && now - ended.at < celebrationMs)
    },
  }
}

export type FxStore = ReturnType<typeof createFx>

/** Deterministic scatter for particles: the same effect draws the same burst every frame. */
export function scatter(seed: number, i: number): number {
  let h = (seed * 374761393 + i * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export const easeOut = (t: number) => 1 - (1 - t) ** 3
export const easeOutBack = (t: number) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2
