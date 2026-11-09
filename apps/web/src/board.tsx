import type { Session } from "@event-factory/engine"
import { useEffect, useRef, type PointerEvent, type RefObject } from "react"
import { cellAt, drawFrame, facingBetween, readColors, samePoint, stepsBetween, type Facing, type Point, type View } from "./canvas"

/** What the board asks the level to do. `place` returns whether the engine accepted it. */
export interface BoardActions {
  place(at: Point, facing: Facing, quiet: boolean): boolean
  rotate(at: Point, to: Facing): void
  remove(at: Point): void
  inspect(at: Point): void
  /** A belt drag turned: the tool keeps facing the way the run is going. */
  facingChanged(facing: Facing): void
}

export interface BoardProps {
  readonly session: Session
  readonly width: number
  readonly height: number
  readonly tool: { readonly belt: boolean; readonly facing: Facing; readonly glyph: string | null } | null
  readonly selected: Point | null
  readonly actions: BoardActions
  /** Set to true by anything that changes the picture while the clock is paused. */
  readonly dirty: RefObject<boolean>
  /** The cell under the pointer, shared so keyboard rotation knows its target. */
  readonly hover: RefObject<Point | null>
  /** Text node the draw loop keeps at the current tick, so React does not re-render per tick. */
  readonly tickLabel: RefObject<HTMLElement | null>
}

const minCell = 28
const maxCell = 72

/**
 * The map. Drawn from `session.frame()` on animation frames outside React,
 * and only when the clock is playing or something marked it dirty.
 * Click places the tool (or inspects with no tool), drag lays a belt run,
 * right-click removes.
 */
export function Board({ session, width, height, tool, selected, actions, dirty, hover, tickLabel }: BoardProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const cell = useRef(minCell)
  const latest = useRef({ tool, selected, actions })
  latest.current = { tool, selected, actions }

  useEffect(() => {
    dirty.current = true
  }, [tool, selected, dirty])

  useEffect(() => {
    const el = wrap.current
    const cv = canvas.current
    const ctx = cv?.getContext("2d")
    if (!el || !cv || !ctx) return
    const colors = readColors(document.documentElement)

    const resize = () => {
      const fit = Math.floor(Math.min(el.clientWidth / width, el.clientHeight / height))
      cell.current = Math.max(minCell, Math.min(maxCell, fit))
      cv.style.width = `${width * cell.current}px`
      cv.style.height = `${height * cell.current}px`
      dirty.current = true
    }
    const observer = new ResizeObserver(resize)
    observer.observe(el)
    resize()

    const unsubscribe = session.subscribe(() => {
      dirty.current = true
    })

    let raf = requestAnimationFrame(function loop() {
      raf = requestAnimationFrame(loop)
      if (!dirty.current && session.getSnapshot().clock !== "playing") return
      dirty.current = false
      const dpr = window.devicePixelRatio || 1
      const px = Math.round(width * cell.current * dpr)
      const py = Math.round(height * cell.current * dpr)
      if (cv.width !== px || cv.height !== py) {
        cv.width = px
        cv.height = py
      }
      const { tool, selected } = latest.current
      const view: View = {
        cell: cell.current,
        dpr,
        colors,
        hover: hover.current,
        selected,
        ghost: tool && { facing: tool.facing, glyph: tool.belt ? null : tool.glyph },
      }
      const frame = session.frame()
      drawFrame(ctx, frame, view)
      if (tickLabel.current) tickLabel.current.textContent = String(frame.tick)
    })

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      unsubscribe()
    }
  }, [session, width, height, dirty, hover, tickLabel])

  const drag = useRef<{ last: Point; facing: Facing; placedLast: boolean } | null>(null)

  const cellOf = (e: PointerEvent<HTMLCanvasElement>): Point | null => {
    const rect = e.currentTarget.getBoundingClientRect()
    return cellAt({ width, height }, cell.current, e.clientX - rect.left, e.clientY - rect.top)
  }

  const setHover = (at: Point | null) => {
    if (samePoint(at, hover.current) || (at === null && hover.current === null)) return
    hover.current = at
    dirty.current = true
  }

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const at = cellOf(e)
    if (!at) return
    const { tool, actions } = latest.current
    if (e.button === 2) return actions.remove(at)
    if (e.button !== 0) return
    if (!tool) return actions.inspect(at)
    const placed = actions.place(at, tool.facing, false)
    if (tool.belt) {
      drag.current = { last: at, facing: tool.facing, placedLast: placed }
      e.currentTarget.setPointerCapture(e.pointerId)
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const at = cellOf(e)
    setHover(at)
    const run = drag.current
    if (!run || !at || samePoint(at, run.last)) return
    const { actions } = latest.current
    for (const next of stepsBetween(run.last, at)) {
      const facing = facingBetween(run.last, next)
      if (!facing) continue
      // A corner: the belt we just laid has to point at the new cell.
      if (run.placedLast && facing !== run.facing) actions.rotate(run.last, facing)
      if (facing !== run.facing) actions.facingChanged(facing)
      run.placedLast = actions.place(next, facing, true)
      run.last = next
      run.facing = facing
    }
  }

  const endDrag = () => {
    drag.current = null
  }

  return (
    <div ref={wrap} className="flex size-full min-h-0 overflow-auto">
      <canvas
        ref={canvas}
        className="m-auto block shrink-0"
        style={{ touchAction: tool ? "none" : "auto", cursor: tool ? "crosshair" : "pointer" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => setHover(null)}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  )
}
