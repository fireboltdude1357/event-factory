import type { RenderFrame } from "@event-factory/engine"
import { useEffect, useRef, type PointerEvent } from "react"
import type { Fx } from "./fx"
import { createParcelTracker, facingBetween, linksOf, samePoint, stepsBetween, type Facing, type Links, type MovingParcel, type Point } from "./geometry"
import { eraser, type LevelController, type Look } from "./level"

/** What the active tool would do at the hovered cell. */
export interface Ghost {
  readonly at: Point
  readonly facing: Facing
  /** Whether the cell is free for it (or, for the eraser, holds something removable). */
  readonly ok: boolean
  readonly what: { readonly kind: "belt" } | { readonly kind: "erase" } | { readonly kind: "building"; readonly look: Look }
}

/** One frame's worth of everything a painter draws. Sizes are CSS pixels; the context is already scaled for the display. */
export interface Scene {
  readonly frame: RenderFrame
  readonly links: Links
  readonly parcels: readonly MovingParcel[]
  /** Canvas size. The map may be smaller and sits at (`ox`, `oy`). */
  readonly width: number
  readonly height: number
  readonly cell: number
  readonly ox: number
  readonly oy: number
  readonly hover: Point | null
  readonly selected: Point | null
  readonly ghost: Ghost | null
  readonly fx: readonly Fx[]
  /** The end-of-level animation, 0 to 1, while it runs. */
  readonly ending: { readonly won: boolean; readonly t: number } | null
  readonly playing: boolean
}

export type Painter = (ctx: CanvasRenderingContext2D, scene: Scene) => void

/** Space the level screen's floating panels take, so the map centers in what is left. */
export interface Insets {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

const noInsets: Insets = { top: 0, right: 0, bottom: 0, left: 0 }
// Small enough that a wide map shrinks to fit a phone instead of running off both edges.
const minCell = 4

/**
 * The map. It fills its container and draws on animation frames outside React,
 * only while the clock plays, an effect is still running, or something marked
 * it dirty. Click uses the tool (or inspects with none), drag lays a belt run
 * or erases, right-click removes.
 */
export function Board({
  level,
  paint,
  insets = noInsets,
  maxCell = 96,
}: {
  readonly level: LevelController
  readonly paint: Painter
  readonly insets?: Insets
  readonly maxCell?: number
}) {
  const { session, scenario, fx, dirty, hover, tickLabel } = level
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const layout = useRef({ cell: minCell, ox: 0, oy: 0, width: 0, height: 0 })
  const paints = useRef(0)
  const latest = useRef({ level, paint, insets })
  latest.current = { level, paint, insets }

  useEffect(() => {
    dirty.current = true
  }, [level.tool, level.selected, paint, insets, dirty])

  useEffect(() => {
    const el = wrap.current
    const cv = canvas.current
    const ctx = cv?.getContext("2d")
    if (!el || !cv || !ctx) return
    const track = createParcelTracker()

    const fit = () => {
      const { insets } = latest.current
      const width = el.clientWidth
      const height = el.clientHeight
      const freeW = Math.max(1, width - insets.left - insets.right)
      const freeH = Math.max(1, height - insets.top - insets.bottom)
      const cell = Math.max(minCell, Math.min(maxCell, Math.floor(Math.min(freeW / scenario.width, freeH / scenario.height))))
      layout.current = {
        cell,
        width,
        height,
        ox: Math.round(insets.left + (freeW - scenario.width * cell) / 2),
        oy: Math.round(insets.top + (freeH - scenario.height * cell) / 2),
      }
      // The verify drive reads these to turn a cell into a click position.
      cv.dataset.cell = String(cell)
      cv.dataset.ox = String(layout.current.ox)
      cv.dataset.oy = String(layout.current.oy)
      dirty.current = true
    }
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    fit()

    const unsubscribe = session.subscribe(() => {
      dirty.current = true
    })
    // Canvas text needs the web fonts; repaint once they are in.
    void document.fonts.ready.then(() => {
      dirty.current = true
    })

    let fitted = latest.current.insets
    let raf = requestAnimationFrame(function loop(now) {
      raf = requestAnimationFrame(loop)
      const { level, paint, insets } = latest.current
      if (insets !== fitted) {
        fitted = insets
        fit()
      }
      const playing = session.getSnapshot().clock === "playing"
      if (!dirty.current && !playing && !fx.busy(now)) return
      dirty.current = false
      const { cell, ox, oy, width, height } = layout.current
      const dpr = window.devicePixelRatio || 1
      const px = Math.round(width * dpr)
      const py = Math.round(height * dpr)
      if (cv.width !== px || cv.height !== py) {
        cv.width = px
        cv.height = py
      }
      const frame = session.frame()
      fx.ingest(frame, now)
      const links = linksOf(frame)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      paint(ctx, {
        frame,
        links,
        parcels: track(frame, links),
        width,
        height,
        cell,
        ox,
        oy,
        hover: hover.current,
        selected: level.selected,
        ghost: ghostOf(level, frame, hover.current),
        fx: fx.active(now),
        ending: fx.ending(now),
        playing,
      })
      if (tickLabel.current) tickLabel.current.textContent = String(frame.tick)
      // Counted so the verify drive can prove an idle map stops painting.
      cv.dataset.paints = String(++paints.current)
    })

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      unsubscribe()
    }
  }, [session, scenario, fx, dirty, hover, tickLabel, maxCell])

  const drag = useRef<{ last: Point; facing: Facing; changedLast: boolean } | null>(null)

  const cellOf = (e: PointerEvent<HTMLCanvasElement>): Point | null => {
    const rect = e.currentTarget.getBoundingClientRect()
    const { cell, ox, oy } = layout.current
    const x = Math.floor((e.clientX - rect.left - ox) / cell)
    const y = Math.floor((e.clientY - rect.top - oy) / cell)
    return x >= 0 && y >= 0 && x < scenario.width && y < scenario.height ? { x, y } : null
  }

  const setHover = (at: Point | null) => {
    if (samePoint(at, hover.current) || (at === null && hover.current === null)) return
    hover.current = at
    dirty.current = true
  }

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const at = cellOf(e)
    setHover(at)
    const { tool, actions } = latest.current.level
    if (!at) return
    if (e.button === 2) return actions.remove(at)
    if (e.button !== 0) return
    if (!tool) return actions.inspect(at)
    const changed = actions.use(at, tool.facing, false)
    if (tool.id === "belt" || tool.id === eraser) {
      drag.current = { last: at, facing: tool.facing, changedLast: changed }
      e.currentTarget.setPointerCapture(e.pointerId)
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const at = cellOf(e)
    setHover(at)
    const run = drag.current
    if (!run || !at || samePoint(at, run.last)) return
    const { tool, actions } = latest.current.level
    for (const next of stepsBetween(run.last, at)) {
      if (tool?.id === eraser) {
        actions.use(next, run.facing, true)
        run.last = next
        continue
      }
      const facing = facingBetween(run.last, next)
      if (!facing) continue
      // A corner: the belt just laid has to point at the new cell.
      if (run.changedLast && facing !== run.facing) actions.rotate(run.last, facing)
      if (facing !== run.facing) actions.facingChanged(facing)
      run.changedLast = actions.use(next, facing, true)
      run.last = next
      run.facing = facing
    }
  }

  const endDrag = () => {
    drag.current = null
  }

  return (
    <div ref={wrap} className="absolute inset-0 overflow-hidden">
      <canvas
        ref={canvas}
        className="block size-full"
        style={{ touchAction: level.tool ? "none" : "manipulation", cursor: level.tool ? "crosshair" : "pointer" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  )
}

function ghostOf(level: LevelController, frame: RenderFrame, at: Point | null): Ghost | null {
  const { tool, toolLook } = level
  if (!tool || !at || level.outcome) return null
  const belt = frame.belts.some((b) => samePoint(b.at, at) && !b.locked)
  const building = frame.buildings.find((b) => samePoint(b.at, at))
  const wall = frame.terrain[at.y * frame.width + at.x] === "wall"
  if (tool.id === eraser) return { at, facing: tool.facing, ok: belt || (building !== undefined && !building.locked), what: { kind: "erase" } }
  if (tool.id === "belt") return { at, facing: tool.facing, ok: !wall && !building, what: { kind: "belt" } }
  return toolLook && { at, facing: tool.facing, ok: !wall && !building, what: { kind: "building", look: toolLook } }
}

/**
 * A still picture of a level's starting map, for the level list and for
 * palette icons. Paints once per size change and never again.
 */
export function Still({ frame, paint, className, pad = 0 }: { readonly frame: RenderFrame; readonly paint: Painter; readonly className?: string; readonly pad?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = canvas.current
    const ctx = cv?.getContext("2d")
    if (!cv || !ctx) return
    const draw = () => {
      const width = cv.clientWidth
      const height = cv.clientHeight
      if (width === 0 || height === 0) return
      const dpr = window.devicePixelRatio || 1
      cv.width = Math.round(width * dpr)
      cv.height = Math.round(height * dpr)
      const cell = Math.max(4, Math.floor(Math.min((width - pad * 2) / frame.width, (height - pad * 2) / frame.height)))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      paint(ctx, {
        frame,
        links: linksOf(frame),
        parcels: [],
        width,
        height,
        cell,
        ox: Math.round((width - frame.width * cell) / 2),
        oy: Math.round((height - frame.height * cell) / 2),
        hover: null,
        selected: null,
        ghost: null,
        fx: [],
        ending: null,
        playing: false,
      })
    }
    const observer = new ResizeObserver(draw)
    observer.observe(cv)
    // Canvas text needs the web fonts; redraw once they are in.
    void document.fonts.ready.then(draw)
    return () => observer.disconnect()
  }, [frame, paint, pad])
  return <canvas ref={canvas} className={className} aria-hidden="true" />
}
