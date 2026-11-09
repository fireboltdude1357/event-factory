import {
  createSession,
  outSides,
  shapeOf,
  type BuildingShape,
  type Command,
  type InspectTarget,
  type Inspection,
  type KindId,
  type OutSide,
  type Pack,
  type Scenario,
  type Session,
  type SessionSnapshot,
} from "@event-factory/engine"
import { Result } from "effect"
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react"
import { createFx, type FxStore } from "./fx"
import { samePoint, turn, type Facing, type Point } from "./geometry"
import { parOf, recordWin } from "./progress"
import { play } from "./sound"
import { lossText, rejectText } from "./text"

/** The remove tool. A kind name starts with a letter, so no pack kind can be called this. */
export const eraser = "#erase"

export type ToolId = KindId | "belt" | typeof eraser

export interface Tool {
  readonly id: ToolId
  readonly facing: Facing
}

/** How a palette entry or a ghost looks, from the pack's kind. Null for the belt. */
export interface Look {
  readonly shape: BuildingShape
  readonly glyph: string
  readonly color: string | null
  /** The sides it sends from, relative to its facing. */
  readonly sides: readonly OutSide[]
}

export interface PaletteItem {
  readonly id: KindId | "belt"
  readonly title: string
  readonly remaining: number | "unlimited"
  readonly look: Look | null
  /** The digit key that picks it, 1 to 9, or null past the ninth. */
  readonly key: number | null
}

export interface Outcome {
  readonly won: boolean
  readonly ticks: number
  /** Ticks the reference solution takes, or null if it could not be run. */
  readonly par: number | null
  /** One sentence on why the level was lost, or null when won. */
  readonly reason: string | null
  /** The pack's lesson for a won level, or null. */
  readonly debrief: string | null
  /** The reference solution was loaded, so this win is not the player's. */
  readonly assisted: boolean
  readonly newBest: boolean
}

/** What the board asks the level to do. */
export interface BoardActions {
  /** Applies the current tool at a cell. Returns whether anything changed. `quiet` suppresses the rejection toast and shake. */
  use(at: Point, facing: Facing, quiet: boolean): boolean
  rotate(at: Point, to: Facing): void
  remove(at: Point): void
  inspect(at: Point): void
  /** A belt drag turned: the tool keeps facing the way the run is going. */
  facingChanged(facing: Facing): void
}

/** What the inspector shows: an engine target, or the pack's belt doc (the belt has no KindId). */
type Subject = { readonly kind: "target"; readonly target: InspectTarget } | { readonly kind: "belt" }

export interface LevelController {
  readonly pack: Pack
  readonly scenario: Scenario
  /** This level's position in the pack, from 1. */
  readonly number: number
  readonly next: Scenario | null
  readonly session: Session
  readonly snapshot: SessionSnapshot
  readonly palette: readonly PaletteItem[]
  readonly tool: Tool | null
  readonly toolLook: Look | null
  pickTool(id: ToolId | null): void
  rotateTool(by: 1 | -1): void
  readonly selected: Point | null
  /** Whether the selected cell holds something the player may rotate or remove. */
  readonly selectedEditable: boolean
  rotateSelected(): void
  removeSelected(): void
  readonly inspection: Inspection | null
  inspect(target: InspectTarget): void
  closeInspector(): void
  readonly toast: { readonly text: string; readonly id: number } | null
  readonly outcome: Outcome | null
  readonly par: number | null
  /** True from the first tick until the next restart. */
  readonly started: boolean
  toggle(): void
  step(): void
  setSpeed(speed: SessionSnapshot["speed"]): void
  /** Back to tick 0, keeping the layout. */
  restart(): void
  /** Back to the bare map. */
  clear(): void
  loadSolution(): void
  readonly actions: BoardActions
  readonly fx: FxStore
  readonly dirty: RefObject<boolean>
  readonly hover: RefObject<Point | null>
  /** Text node the draw loop keeps at the current tick, so React does not re-render per tick. */
  readonly tickLabel: RefObject<HTMLElement | null>
}

export const speeds = [1, 2, 4, 8] as const satisfies readonly SessionSnapshot["speed"][]

/** One Session for one scenario. Created in an effect so StrictMode's remount gets a fresh one. */
export function useSession(pack: Pack, scenario: Scenario): Session | null {
  const [session, setSession] = useState<Session | null>(null)
  useEffect(() => {
    const s = createSession(pack, scenario.id)
    setSession(s)
    return () => s.dispose()
  }, [pack, scenario.id])
  return session
}

function useSnapshot(session: Session): SessionSnapshot {
  const subscribe = useCallback((onChange: () => void) => session.subscribe(onChange), [session])
  const get = useCallback(() => session.getSnapshot(), [session])
  return useSyncExternalStore(subscribe, get)
}

const lookOf = (pack: Pack, id: ToolId): Look | null => {
  const kind = id === "belt" || id === eraser ? undefined : pack.kinds.get(id)
  return kind ? { shape: shapeOf(kind), glyph: kind.glyph, color: kind.color, sides: outSides(kind) } : null
}

/**
 * Everything a level screen needs, with no markup: the session, the tool, the
 * selection, the clock, the outcome and the keyboard. A direction renders it.
 */
export function useLevel(pack: Pack, scenario: Scenario, session: Session): LevelController {
  const snapshot = useSnapshot(session)
  const [tool, setTool] = useState<Tool | null>(null)
  const [subject, setSubject] = useState<Subject | null>(null)
  const [selected, setSelected] = useState<Point | null>(null)
  const [toast, setToast] = useState<{ readonly text: string; readonly id: number } | null>(null)
  const [moves, setMoves] = useState(0)
  const [assisted, setAssisted] = useState(false)
  const [started, setStarted] = useState(false)
  const [newBest, setNewBest] = useState(false)
  const dirty = useRef(true)
  const hover = useRef<Point | null>(null)
  const tickLabel = useRef<HTMLElement | null>(null)
  const fx = useMemo(() => createFx(play), [])

  const titleOf = useCallback((id: KindId | "belt") => (id === "belt" ? pack.belt.title : (pack.kinds.get(id)?.title ?? id)), [pack])

  const say = useCallback((text: string) => setToast({ text, id: Date.now() }), [])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(timer)
  }, [toast])

  const touch = useCallback(() => {
    dirty.current = true
    setMoves((n) => n + 1)
  }, [])

  /** Dispatches one command. A rejection shakes the cell and says why unless `quiet`. */
  const run = useCallback(
    (command: Command, quiet = false): boolean => {
      const result = session.dispatch(command)
      dirty.current = true
      if (Result.isSuccess(result)) {
        if (command.kind !== "rotate") fx.add(command.kind === "place" ? "placed" : "removed", command.at, "", performance.now())
        return true
      }
      if (!quiet) {
        fx.add("rejected", command.at, "", performance.now())
        say(rejectText(result.failure.reason, titleOf))
      }
      return false
    },
    [session, say, titleOf, fx],
  )

  const occupant = useCallback(
    (at: Point) => {
      const frame = session.frame()
      const belt = frame.belts.find((b) => samePoint(b.at, at))
      if (belt) return { kind: "belt" as const, facing: belt.facing, locked: belt.locked, busy: frame.parcels.some((p) => samePoint(p.at, at)) }
      const building = frame.buildings.find((b) => samePoint(b.at, at))
      return building ? { kind: "building" as const, facing: building.facing, locked: building.locked } : null
    },
    [session],
  )

  const actions: BoardActions = {
    use: (at, facing, quiet) => {
      if (tool === null) return false
      const here = occupant(at)
      if (tool.id === eraser) return here !== null && run({ kind: "remove", at }, quiet)
      if (tool.id === "belt") {
        // Drawing a belt over a belt re-aims it, so a run can be redrawn without erasing first.
        if (here?.kind === "belt") return here.facing === facing || run({ kind: "rotate", at, to: facing }, true)
        return run({ kind: "place", at, facing, build: { kind: "belt" } }, quiet)
      }
      const build = { kind: "building" as const, id: tool.id }
      // A building dropped on a belt replaces it, but only when that is safe: the belt is the player's and
      // empty (removing it would drop what it carries) and the part is still in stock. Otherwise the engine
      // says why the cell is taken.
      const spare = session.getSnapshot().palette.find((p) => p.id === tool.id)?.remaining !== 0
      if (here?.kind === "belt" && !here.locked && !here.busy && spare) session.dispatch({ kind: "remove", at })
      return run({ kind: "place", at, facing, build }, quiet)
    },
    rotate: (at, to) => void run({ kind: "rotate", at, to }, true),
    remove: (at) => void run({ kind: "remove", at }),
    inspect: (at) => {
      setSelected(at)
      setSubject({ kind: "target", target: { kind: "cell", at } })
    },
    facingChanged: (facing) => setTool((t) => t && { ...t, facing }),
  }

  const pickTool = useCallback((id: ToolId | null) => {
    setTool((current) => {
      if (id === null || current?.id === id) return null
      play("pick")
      return { id, facing: current?.facing ?? "east" }
    })
    if (id !== null && id !== eraser) setSubject(id === "belt" ? { kind: "belt" } : { kind: "target", target: { kind: "kind", id } })
    setSelected(null)
  }, [])

  const rotateTool = useCallback((by: 1 | -1) => setTool((t) => t && { ...t, facing: turn(t.facing, by) }), [])

  const toggle = useCallback(() => {
    const playing = session.getSnapshot().clock === "playing"
    if (playing) session.pause()
    else if (session.getSnapshot().status.kind === "running") {
      session.play()
      setStarted(true)
    } else return
    play(playing ? "pause" : "play")
    touch()
  }, [session, touch])

  const step = useCallback(() => {
    session.step()
    setStarted(true)
    touch()
  }, [session, touch])

  const fresh = useCallback(() => {
    setStarted(false)
    setNewBest(false)
    setSelected(null)
    setSubject(null)
    touch()
  }, [touch])

  const restart = useCallback(() => {
    session.rewind()
    fresh()
  }, [session, fresh])

  const clear = useCallback(() => {
    session.reset()
    setAssisted(false)
    fresh()
  }, [session, fresh])

  const loadSolution = useCallback(() => {
    session.loadSolution()
    setAssisted(true)
    setTool(null)
    fresh()
  }, [session, fresh])

  const rotateAt = useCallback(
    (at: Point, by: 1 | -1) => {
      const here = occupant(at)
      if (here) run({ kind: "rotate", at, to: turn(here.facing, by) })
    },
    [occupant, run],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null
      if (target?.closest("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "Escape") {
        setTool(null)
        setSubject(null)
        setSelected(null)
        return
      }
      // Space plays or pauses, except on a focused control, which only keyboard users can focus and which Space activates.
      if (e.key === " " && !keyboardFocused(target)) {
        e.preventDefault()
        if (!e.repeat) toggle()
        return
      }
      if (e.key === ".") return step()
      if (/^[1-9]$/.test(e.key)) {
        const item = session.getSnapshot().palette[Number(e.key) - 1]
        if (item && item.remaining !== 0) pickTool(item.id)
        return
      }
      if (e.key.toLowerCase() === "x") return pickTool(eraser)
      if (e.key.toLowerCase() !== "r") return
      const by = e.shiftKey ? -1 : 1
      if (tool) return rotateTool(by)
      if (hover.current) rotateAt(hover.current, by)
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
  }, [tool, session, toggle, step, pickTool, rotateTool, rotateAt])

  const par = useMemo(() => parOf(pack, scenario), [pack, scenario])
  const { status } = snapshot
  const finished = status.kind === "finished" ? status : null

  // The end of a level: start the map's ending, play its cue, and record a win the player earned.
  useEffect(() => {
    if (finished === null) return
    const won = finished.outcome.kind === "won"
    fx.finish(won, performance.now())
    dirty.current = true
    play(won ? "won" : "lost")
    if (won && !assisted) setNewBest(recordWin(pack, scenario, finished.at))
  }, [finished, fx, assisted, pack, scenario])

  const goalsMet = snapshot.goals.filter((g) => g.met).length
  const metBefore = useRef(0)
  useEffect(() => {
    if (goalsMet > metBefore.current && finished === null) play("goal")
    metBefore.current = goalsMet
  }, [goalsMet, finished])

  const inspection = useInspection(session, snapshot, subject, pack, moves)
  const index = pack.scenarios.indexOf(scenario)
  const here = selected ? occupant(selected) : null

  const palette = useMemo(
    () => snapshot.palette.map((item, i): PaletteItem => ({ ...item, look: lookOf(pack, item.id), key: i < 9 ? i + 1 : null })),
    [snapshot.palette, pack],
  )

  const outcome: Outcome | null = finished && {
    won: finished.outcome.kind === "won",
    ticks: finished.at,
    par,
    reason: lossText(pack, finished),
    debrief: finished.outcome.kind === "won" ? scenario.debrief : null,
    assisted,
    newBest,
  }

  return {
    pack,
    scenario,
    number: index + 1,
    next: pack.scenarios[index + 1] ?? null,
    session,
    snapshot,
    palette,
    tool,
    toolLook: tool ? lookOf(pack, tool.id) : null,
    pickTool,
    rotateTool,
    selected,
    selectedEditable: here !== null && !here.locked && finished === null,
    rotateSelected: () => selected && rotateAt(selected, 1),
    removeSelected: () => {
      if (!selected) return
      run({ kind: "remove", at: selected })
      setSelected(null)
      setSubject(null)
    },
    inspection,
    inspect: (target) => {
      setSubject({ kind: "target", target })
      if (target.kind !== "cell") setSelected(null)
    },
    closeInspector: () => {
      setSubject(null)
      setSelected(null)
    },
    toast,
    outcome,
    par,
    started,
    toggle,
    step,
    setSpeed: (speed) => session.setSpeed(speed),
    restart,
    clear,
    loadSolution,
    actions,
    fx,
    dirty,
    hover,
    tickLabel,
  }
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

function keyboardFocused(target: HTMLElement | null): boolean {
  return target?.closest("button, a") != null
}
