import {
  createSession,
  type Command,
  type InspectTarget,
  type Inspection,
  type KindId,
  type Pack,
  type RejectReason,
  type Scenario,
  type Session,
  type SessionSnapshot,
} from "@event-factory/engine"
import { Result } from "effect"
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react"
import { Board, type BoardActions } from "./board"
import { samePoint, turn, type Facing, type Point } from "./canvas"
import { Hud } from "./hud"
import { Inspector } from "./inspector"
import { Markdown } from "./markdown"

type ToolId = KindId | "belt"
interface Tool {
  readonly id: ToolId
  readonly facing: Facing
}

/** What the inspector shows: an engine target, or the pack's belt doc (the belt has no KindId). */
type Subject = { readonly kind: "target"; readonly target: InspectTarget } | { readonly kind: "belt" }

/** Owns one Session for one scenario. Created in an effect so StrictMode's remount gets a fresh one. */
export function Level({ pack, scenario, onExit }: { readonly pack: Pack; readonly scenario: Scenario; readonly onExit: () => void }) {
  const [session, setSession] = useState<Session | null>(null)
  useEffect(() => {
    const s = createSession(pack, scenario.id)
    setSession(s)
    return () => s.dispose()
  }, [pack, scenario.id])
  return session ? <LevelScreen pack={pack} scenario={scenario} session={session} onExit={onExit} /> : null
}

function useSnapshot(session: Session): SessionSnapshot {
  const subscribe = useCallback((onChange: () => void) => session.subscribe(onChange), [session])
  const get = useCallback(() => session.getSnapshot(), [session])
  return useSyncExternalStore(subscribe, get)
}

function LevelScreen({
  pack,
  scenario,
  session,
  onExit,
}: {
  readonly pack: Pack
  readonly scenario: Scenario
  readonly session: Session
  readonly onExit: () => void
}) {
  const snapshot = useSnapshot(session)
  const [tool, setTool] = useState<Tool | null>(null)
  const [subject, setSubject] = useState<Subject | null>(null)
  const [selected, setSelected] = useState<Point | null>(null)
  const [toast, setToast] = useState<{ readonly text: string; readonly id: number } | null>(null)
  const dirty = useRef(true)
  const hover = useRef<Point | null>(null)
  const tickLabel = useRef<HTMLSpanElement>(null)
  const [moves, setMoves] = useState(0)

  const titleOf = useCallback((id: ToolId) => (id === "belt" ? pack.belt.title : (pack.kinds.get(id)?.title ?? id)), [pack])

  const say = useCallback((text: string) => setToast({ text, id: Date.now() }), [])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 1800)
    return () => clearTimeout(timer)
  }, [toast])

  const run = useCallback(
    (command: Command, quiet = false): boolean => {
      const result = session.dispatch(command)
      dirty.current = true
      if (Result.isSuccess(result)) return true
      if (!quiet) say(rejectText(result.failure.reason, titleOf))
      return false
    },
    [session, say, titleOf],
  )

  /**
   * Clock buttons and anything else that moves the sim while the canvas may be idle.
   * Counts each call, since a Step can move parcels without changing the snapshot.
   */
  const act = useCallback((fn: () => void) => {
    fn()
    dirty.current = true
    setMoves((n) => n + 1)
  }, [])

  const inspectTarget = (target: InspectTarget) => {
    setSubject({ kind: "target", target })
    if (target.kind !== "cell") setSelected(null)
  }

  const actions: BoardActions = {
    place: (at, facing, quiet) =>
      tool !== null &&
      run({ kind: "place", at, facing, build: tool.id === "belt" ? { kind: "belt" } : { kind: "building", id: tool.id } }, quiet),
    rotate: (at, to) => void run({ kind: "rotate", at, to }, true),
    remove: (at) => void run({ kind: "remove", at }),
    inspect: (at) => {
      setSelected(at)
      setSubject({ kind: "target", target: { kind: "cell", at } })
    },
    facingChanged: (facing) => setTool((t) => t && { ...t, facing }),
  }

  const pickTool = (id: ToolId) => {
    if (tool?.id === id) return setTool(null)
    setTool({ id, facing: tool?.facing ?? "east" })
    setSubject(id === "belt" ? { kind: "belt" } : { kind: "target", target: { kind: "kind", id } })
    setSelected(null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null
      if (target?.closest("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "Escape") return setTool(null)
      // Space plays or pauses, except on a focused control, which only keyboard users can focus and which Space activates.
      if (e.key === " " && !keyboardFocused(target)) {
        e.preventDefault()
        if (e.repeat) return
        return act(() => (session.getSnapshot().clock === "playing" ? session.pause() : session.play()))
      }
      if (e.key === ".") return act(() => session.step())
      if (e.key.toLowerCase() !== "r") return
      const by = e.shiftKey ? -1 : 1
      if (tool) return setTool({ ...tool, facing: turn(tool.facing, by) })
      const at = hover.current
      if (!at) return
      const frame = session.frame()
      const here = [...frame.buildings, ...frame.belts].find((b) => samePoint(b.at, at))
      if (here) run({ kind: "rotate", at, to: turn(here.facing, by) })
    }
    // Chrome activates a focused button on Space's keyup, so that needs blocking too.
    const onKeyUp = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null
      if (e.key === " " && !target?.closest("input, textarea, select") && !keyboardFocused(target)) e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("keyup", onKeyUp)
    }
  }, [tool, session, act, run])

  const inspection = useInspection(session, snapshot, subject, pack, moves)

  const glyphOf = (id: ToolId) => (id === "belt" ? null : (pack.kinds.get(id)?.glyph ?? "?"))

  return (
    // A click leaves focus where it was, so Space keeps meaning play or pause after clicking a control.
    <div className="flex min-h-full flex-col lg:h-dvh" onMouseDown={(e) => e.target instanceof Element && e.target.closest("button, a") && e.preventDefault()}>
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-rule bg-panel px-4 py-2.5">
        <button type="button" onClick={onExit} className="rounded-sm text-sm text-dim hover:text-ink">
          ‹ {pack.title}
        </button>
        <h1 className="font-display text-lg font-semibold">{scenario.title}</h1>
        <ClockControls snapshot={snapshot} session={session} act={act} maxTicks={scenario.maxTicks} tickLabel={tickLabel} />
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[13rem_minmax(0,1fr)_22rem]">
        <aside className="order-2 border-rule bg-panel lg:order-1 lg:overflow-y-auto lg:border-r">
          <Palette palette={snapshot.palette} tool={tool} glyphOf={glyphOf} onPick={pickTool} />
        </aside>

        <main className="order-1 flex min-h-0 flex-col lg:order-2">
          <Markdown text={scenario.brief} className="border-b border-rule px-4 py-2.5 text-[0.95rem] leading-snug text-ink/90" />
          <div className="relative h-[62vh] min-h-0 lg:h-auto lg:flex-1">
            <Board
              session={session}
              width={scenario.width}
              height={scenario.height}
              tool={tool && { belt: tool.id === "belt", facing: tool.facing, glyph: glyphOf(tool.id) }}
              selected={selected}
              actions={actions}
              dirty={dirty}
              hover={hover}
              tickLabel={tickLabel}
            />
            {toast && (
              <p
                key={toast.id}
                role="status"
                className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-sm border border-amber/60 bg-slate px-3 py-1.5 text-sm text-amber"
              >
                {toast.text}
              </p>
            )}
          </div>
          <p className="border-t border-rule px-4 py-1.5 text-xs text-dim">
            {tool
              ? `Placing ${titleOf(tool.id)} facing ${tool.facing}. R rotates, drag lays a belt run, right-click removes, Esc stops placing.`
              : "Click to inspect. Right-click removes. R rotates what is under the pointer. Space plays or pauses."}
          </p>
        </main>

        <aside className="order-3 space-y-6 border-rule bg-panel px-4 py-4 lg:overflow-y-auto lg:border-l">
          <Hud snapshot={snapshot} pack={pack} />
          <section className="border-t border-rule pt-4">
            <Inspector inspection={inspection} pack={pack} onInspect={inspectTarget} />
          </section>
        </aside>
      </div>
    </div>
  )
}

/**
 * Re-reads the inspection when the snapshot changes, after every clock action
 * (`moves`), and four times a second while the clock runs, since live facts
 * change every tick.
 */
function useInspection(session: Session, snapshot: SessionSnapshot, subject: Subject | null, pack: Pack, moves: number): Inspection | null {
  const [pulse, setPulse] = useState(0)
  useEffect(() => {
    if (snapshot.clock !== "playing" || subject?.kind !== "target") return
    const timer = setInterval(() => setPulse((n) => n + 1), 250)
    return () => clearInterval(timer)
  }, [snapshot.clock, subject])

  return useMemo(() => {
    if (!subject) return null
    if (subject.kind === "belt")
      return {
        title: pack.belt.title,
        role: "Belt",
        doc: pack.belt.doc,
        facts: [{ kind: "count", label: "Ticks per tile", value: pack.belt.ticksPerTile }],
        trace: null,
      }
    return session.inspect(subject.target)
  }, [session, snapshot, subject, pack, pulse, moves])
}

function ClockControls({
  snapshot,
  session,
  act,
  maxTicks,
  tickLabel,
}: {
  readonly snapshot: SessionSnapshot
  readonly session: Session
  readonly act: (fn: () => void) => void
  readonly maxTicks: number
  readonly tickLabel: RefObject<HTMLSpanElement | null>
}) {
  const playing = snapshot.clock === "playing"
  const finished = snapshot.status.kind === "finished"
  const button = "rounded-sm border border-rule bg-raised px-2.5 py-1 text-sm hover:border-dim disabled:opacity-40 disabled:hover:border-rule"
  return (
    <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
      <button
        type="button"
        className={`${button} min-w-[4.5rem] font-medium`}
        disabled={finished}
        onClick={() => act(() => (playing ? session.pause() : session.play()))}
      >
        {playing ? "Pause" : "Play"}
      </button>
      <button type="button" className={button} disabled={playing || finished} onClick={() => act(() => session.step())}>
        Step
      </button>
      <div role="group" aria-label="Speed" className="flex overflow-hidden rounded-sm border border-rule">
        {speeds.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={snapshot.speed === s}
            onClick={() => session.setSpeed(s)}
            className={`px-2 py-1 text-sm ${snapshot.speed === s ? "bg-ink text-slate" : "bg-raised hover:bg-rule"}`}
          >
            {s}×
          </button>
        ))}
      </div>
      <button type="button" className={button} onClick={() => act(() => session.reset())}>
        Reset
      </button>
      <button type="button" className={button} onClick={() => act(() => session.loadSolution())}>
        Show solution
      </button>
      <span className="min-w-[7rem] text-right text-sm text-dim">
        tick <span ref={tickLabel}>0</span> / {maxTicks}
      </span>
    </div>
  )
}

const speeds = [1, 2, 4, 8] as const satisfies readonly SessionSnapshot["speed"][]

function Palette({
  palette,
  tool,
  glyphOf,
  onPick,
}: {
  readonly palette: SessionSnapshot["palette"]
  readonly tool: Tool | null
  readonly glyphOf: (id: ToolId) => string | null
  readonly onPick: (id: ToolId) => void
}) {
  return (
    <ul className="flex gap-1.5 overflow-x-auto p-2 lg:flex-col lg:overflow-visible">
      {palette.map((item) => {
        const active = tool?.id === item.id
        const empty = item.remaining === 0
        return (
          <li key={item.id} className="shrink-0">
            <button
              type="button"
              aria-pressed={active}
              disabled={empty}
              onClick={() => onPick(item.id)}
              className={`flex w-full items-center gap-2.5 rounded-sm border px-2 py-1.5 text-left disabled:opacity-40 ${
                active ? "border-ink bg-raised" : "border-transparent hover:border-rule"
              }`}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-machine font-display text-base font-semibold">
                {glyphOf(item.id) ?? "›"}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm leading-tight">{item.title}</span>
                <span className="block text-xs text-dim">
                  {item.remaining === "unlimited" ? "No limit" : `${item.remaining} left`}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function rejectText(reason: RejectReason, title: (id: ToolId) => string): string {
  switch (reason.kind) {
    case "outOfBounds":
      return "That cell is outside the map."
    case "wall":
      return "That cell is a wall."
    case "occupied":
      return "Something is already there. Right-click to remove it first."
    case "empty":
      return "There is nothing there."
    case "locked":
      return "That is part of the level and cannot be changed."
    case "notUnlocked":
      return `${title(reason.build)} is not available in this level.`
    case "overBudget":
      return `This level allows ${reason.limit} ${title(reason.build)}.`
    case "finished":
      return "The level is over. Press Reset to build again."
  }
}

function keyboardFocused(target: HTMLElement | null): boolean {
  return target?.closest("button, a") != null
}
