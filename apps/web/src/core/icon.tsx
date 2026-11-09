import { useEffect, useRef } from "react"
import type { Look } from "./level"

export type IconSubject = Look | "belt" | "erase"
export type IconPainter = (ctx: CanvasRenderingContext2D, size: number, what: IconSubject) => void

/** A palette icon drawn by the direction's own painter, so the button shows exactly what lands on the map. */
export function Icon({ draw, what, size, className }: { readonly draw: IconPainter; readonly what: IconSubject; readonly size: number; readonly className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = canvas.current
    const ctx = cv?.getContext("2d")
    if (!cv || !ctx) return
    const paint = () => {
      const dpr = window.devicePixelRatio || 1
      cv.width = Math.round(size * dpr)
      cv.height = Math.round(size * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw(ctx, size, what)
    }
    paint()
    // The glyph is canvas text, which needs the web font.
    void document.fonts.ready.then(paint)
  }, [draw, what, size])
  return <canvas ref={canvas} className={className} style={{ width: size, height: size }} aria-hidden="true" />
}
