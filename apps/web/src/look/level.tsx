import type { EventId, GoalProgress } from "@event-factory/engine"
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react"
import { Board, type Insets } from "../core/board"
import { Icon } from "../core/icon"
import { Inspector } from "../core/inspector"
import { eraser, speeds, type LevelController, type Outcome } from "../core/level"
import { useEventLog, type LogLine } from "../core/log"
import { Markdown } from "../core/markdown"
import { setMuted, useMuted } from "../core/sound"
import { constraintText, goalParts } from "../core/text"
import { paint, paintIcon } from "./paint"

const key = "toy-key font-display font-semibold"

function useWide(): boolean {
  const query = "(min-width: 1024px)"
  const [wide, setWide] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setWide(media.matches)
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])
  return wide
}

const boardInsets: Insets = { top: 14, right: 14, bottom: 16, left: 14 }

/**
 * The toy-line level screen: a workbench. The map is a framed board, the parts
 * sit in a tray below it beside the control console, and a clipboard holds the
 * work order: goals as a checklist, the rules, the incidents and the spec sheet
 * for whatever is selected. A finished level stamps the work order.
 */
export function LevelScreen({ level, onExit, onOpen }: { readonly level: LevelController; readonly onExit: () => void; readonly onOpen: (scenarioId: string) => void }) {
  const wide = useWide()
  const muted = useMuted()
  const { scenario } = level

  return (
    // A click leaves focus where it was, so Space keeps meaning play or pause after clicking a control.
    <div
      className="toy-bench flex h-dvh select-none flex-col overflow-hidden font-sans text-ink"
      onMouseDown={(e) => e.target instanceof Element && e.target.closest("button, a") && e.preventDefault()}
    >
      <header className="flex shrink-0 items-center gap-2 px-2 pb-1 pt-2 sm:gap-3 sm:px-3">
        <button type="button" onClick={onExit} aria-label="Back to levels" className={`${key} flex h-10 shrink-0 items-center gap-1 bg-panel px-3 text-ink`}>
          <span aria-hidden="true" className="text-xl leading-none">‹</span>
          <span className="hidden text-sm sm:inline">Levels</span>
        </button>
        <div className="toy-tape min-w-0 -rotate-1 px-3 py-1">
          <p className="font-mono text-[0.7rem] font-bold uppercase leading-none tracking-widest text-dim">Level {String(level.number).padStart(2, "0")}</p>
          <h1 className="truncate font-display text-lg font-semibold leading-tight sm:text-xl">{scenario.title}</h1>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <div className="toy-plastic flex items-baseline gap-1.5 bg-ink px-2.5 py-1 text-panel" style={{ borderRadius: 12 }}>
            <span className="font-display text-[0.6rem] font-semibold uppercase tracking-widest text-[#ffd60a]">tick</span>
            <span ref={level.tickLabel as RefObject<HTMLSpanElement>} className="inline-block min-w-[3ch] text-right font-mono text-lg font-bold leading-none">
              0
            </span>
            <span className="hidden font-mono text-xs text-[#c9b89c] sm:inline">/ {scenario.maxTicks}</span>
          </div>
          <button
            type="button"
            aria-label={muted ? "Turn sound on" : "Turn sound off"}
            aria-pressed={!muted}
            onClick={() => setMuted(!muted)}
            className={`${key} grid size-10 place-items-center bg-panel text-ink`}
            style={{ transform: "none", boxShadow: "0 4px 0 var(--color-ink)" }}
          >
            <SoundIcon on={!muted} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-2 pb-2 sm:px-3 sm:pb-3 lg:flex-row lg:gap-4">
        <div className="flex min-h-0 min-w-0 shrink-0 flex-col gap-2.5 lg:flex-1 lg:shrink lg:gap-3">
          <div
            className="toy-board relative min-h-[140px] overflow-hidden lg:min-h-0 lg:flex-1"
            style={wide ? undefined : { aspectRatio: `${scenario.width + 1.1} / ${scenario.height + 1.2}`, maxHeight: "40dvh" }}
          >
            <Board level={level} paint={paint} insets={boardInsets} maxCell={wide ? 104 : 64} />
            {level.toast && (
              <p key={level.toast.id} role="status" className="ef-rise toy-plastic pointer-events-none absolute left-1/2 top-2 z-10 max-w-[90%] -translate-x-1/2 bg-[#ffe873] px-3 py-1 text-center text-sm font-semibold" style={{ borderRadius: 12 }}>
                {level.toast.text}
              </p>
            )}
          </div>
          {/* On a phone a finished level needs neither, and the result needs the room. */}
          {(wide || !level.outcome) && (
            <div className="flex min-w-0 flex-col gap-2.5 lg:flex-row lg:items-stretch lg:gap-3">
              <Tray level={level} />
              <Console level={level} />
            </div>
          )}
        </div>

        <WorkOrder level={level} onExit={onExit} onOpen={onOpen} wide={wide} />
      </div>
    </div>
  )
}

/** The parts tray: one press-down tile per part, then the eraser and rotate. */
function Tray({ level }: { readonly level: LevelController }) {
  const { tool } = level
  // A crowded tray wraps on a phone. On a wide screen its tiles shrink first, and it scrolls only if they still do not fit.
  const tile = "relative flex h-[5.2rem] min-w-[3.5rem] max-w-[6.5rem] shrink flex-col items-center self-center px-1 pb-1 pt-1.5"
  const tone = (active: boolean) => (active ? "bg-[#ffd60a] text-ink" : "bg-panel text-ink")
  return (
    <div className="toy-plastic flex min-w-0 flex-wrap items-stretch gap-x-1.5 gap-y-2.5 bg-[#3d5a80] p-2 pb-3 lg:flex-1 lg:flex-nowrap lg:overflow-x-auto" style={{ borderRadius: 16 }} role="group" aria-label="Parts">
      {level.palette.map((item) => (
        <button key={item.id} type="button" aria-pressed={tool?.id === item.id} disabled={item.remaining === 0} onClick={() => level.pickTool(item.id)} className={`${key} ${tile} ${tone(tool?.id === item.id)}`} title={item.title}>
          {item.key !== null && <kbd className="absolute left-1 top-0.5 font-mono text-[0.65rem] font-bold text-faint">{item.key}</kbd>}
          {item.remaining !== "unlimited" && (
            <span className={`absolute -right-2 -top-2 grid min-w-6 place-items-center rounded-full border-2 border-ink px-1 font-display text-xs font-bold ${item.remaining === 0 ? "bg-raised text-faint" : "bg-[#ff5d8f] text-white"}`}>
              ×{item.remaining}
            </span>
          )}
          <Icon draw={paintIcon} what={item.look ?? "belt"} size={42} />
          <span className="mt-0.5 line-clamp-2 max-w-full text-center text-[0.68rem] font-semibold leading-[1.1] [overflow-wrap:anywhere] sm:text-[0.72rem]">{item.title}</span>
        </button>
      ))}
      <span className="mx-0.5 hidden w-1 shrink-0 self-stretch rounded-full bg-black/25 lg:block" />
      <button type="button" aria-pressed={tool?.id === eraser} onClick={() => level.pickTool(eraser)} className={`${key} ${tile} ${tone(tool?.id === eraser)}`} title="Remove (X)">
        <kbd className="absolute left-1 top-0.5 font-mono text-[0.65rem] font-bold text-faint">X</kbd>
        <Icon draw={paintIcon} what="erase" size={42} />
        <span className="mt-0.5 text-[0.7rem] font-semibold leading-tight">Remove</span>
      </button>
      <button type="button" disabled={!tool || tool.id === eraser} onClick={() => level.rotateTool(1)} className={`${key} ${tile} bg-panel text-ink`} title="Rotate (R)">
        <kbd className="absolute left-1 top-0.5 font-mono text-[0.65rem] font-bold text-faint">R</kbd>
        <span className="grid size-[42px] place-items-center font-display text-3xl font-bold">{arrows[tool?.facing ?? "east"]}</span>
        <span className="mt-0.5 text-[0.7rem] font-semibold leading-tight">Rotate</span>
      </button>
    </div>
  )
}

const arrows = { north: "↑", east: "→", south: "↓", west: "←" } as const

/** The control console: a big go button, step, the speed keys and the reset buttons. */
function Console({ level }: { readonly level: LevelController }) {
  const { snapshot } = level
  const playing = snapshot.clock === "playing"
  const finished = snapshot.status.kind === "finished"
  const small = `${key} bg-panel px-2.5 py-1.5 text-sm text-ink`
  return (
    <div className="toy-plastic flex shrink-0 flex-wrap items-center gap-2 bg-[#ffbe0b] p-2 pb-3 lg:w-[22.5rem]" style={{ borderRadius: 16 }}>
      <button
        type="button"
        disabled={finished}
        onClick={level.toggle}
        className={`${key} flex h-12 min-w-[6.8rem] items-center justify-center gap-2 px-4 text-lg ${playing ? "bg-[#ff5d5d] text-white" : "bg-[#2ec36b] text-white"}`}
        style={{ borderRadius: 999 }}
      >
        <span aria-hidden="true" className="text-base">
          {playing ? "❚❚" : "▶"}
        </span>
        {playing ? "Pause" : "Play"}
      </button>
      <button type="button" className={small} disabled={playing || finished} onClick={level.step}>
        Step
      </button>
      <div role="group" aria-label="Speed" className="flex gap-1">
        {speeds.map((s) => (
          <button key={s} type="button" aria-pressed={snapshot.speed === s} onClick={() => level.setSpeed(s)} className={`${key} w-9 py-1.5 font-mono text-sm font-bold ${snapshot.speed === s ? "bg-ink text-[#ffd60a]" : "bg-panel text-ink"}`} style={{ borderRadius: 10 }}>
            {s}×
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={small} onClick={level.restart} disabled={!level.started}>
          Restart
        </button>
        <button type="button" className={small} onClick={level.clear}>
          Clear
        </button>
        <button type="button" className={small} onClick={level.loadSolution}>
          Show solution
        </button>
      </div>
    </div>
  )
}

/** The clipboard. Its paper is the one section the inspector lives in. */
function WorkOrder({ level, onExit, onOpen, wide }: { readonly level: LevelController; readonly onExit: () => void; readonly onOpen: (scenarioId: string) => void; readonly wide: boolean }) {
  const [page, setPage] = useState<Page>("notes")
  const log = useEventLog(level)
  const paper = useRef<HTMLElement>(null)
  const { snapshot, outcome } = level
  const inspecting = level.inspection !== null

  // Inspecting turns to the spec sheet. Closing it goes back to the notes, but leaves the log open if that was showing.
  useEffect(() => {
    setPage((p) => (inspecting ? "spec" : p === "spec" ? "notes" : p))
  }, [inspecting, level.selected])
  useEffect(() => {
    if (outcome) paper.current?.scrollTo({ top: 0 })
  }, [outcome])

  return (
    <aside className="toy-clipboard relative flex min-h-0 flex-1 flex-col px-2.5 pb-2.5 pt-6 lg:w-[22.5rem] lg:flex-none">
      {/* The clip. */}
      <div aria-hidden="true" className="absolute left-1/2 top-[-10px] h-7 w-28 -translate-x-1/2 rounded-lg border-[3px] border-ink bg-gradient-to-b from-[#e8e6e1] to-[#a9a59c]">
        <div className="mx-auto mt-1 h-2 w-12 rounded-full border-2 border-ink bg-[#6f6b63]" />
      </div>
      <section ref={paper} className="toy-paper min-h-0 flex-1 overflow-y-auto px-3.5 pb-4 pt-3">
        <div className="flex items-baseline justify-between border-b-2 border-ink pb-1">
          <p className="font-mono text-sm font-bold uppercase tracking-widest">Work order</p>
          <p className="font-mono text-sm font-bold">No. {String(level.number).padStart(2, "0")}</p>
        </div>

        {outcome && <Result level={level} outcome={outcome} onExit={onExit} onOpen={onOpen} />}

        <h2 className="mt-3 font-display text-xs font-semibold uppercase tracking-[0.18em] text-dim">To ship</h2>
        <ul className="mt-1.5 space-y-2">
          {snapshot.goals.map((g, i) => (
            <Goal key={i} goal={g} level={level} />
          ))}
        </ul>

        <div
          role="tablist"
          aria-label="Work order pages"
          className="mt-4 flex gap-1 border-b-2 border-ink"
          onKeyDown={(e) => {
            const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0
            if (step === 0) return
            e.preventDefault()
            const next = pages[(pages.indexOf(page) + step + pages.length) % pages.length] ?? page
            setPage(next)
            e.currentTarget.querySelector<HTMLElement>(`[data-page="${next}"]`)?.focus()
          }}
        >
          {pages.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              data-page={p}
              aria-selected={page === p}
              tabIndex={page === p ? 0 : -1}
              onClick={() => setPage(p)}
              className={`-mb-0.5 rounded-t-lg border-2 border-b-0 px-3 py-1 font-display text-sm font-semibold ${page === p ? "border-ink bg-[#fffdf6]" : "border-transparent text-dim hover:text-ink"}`}
            >
              {pageNames[p]}
              {p === "log" && log.length > 0 && <span className="ml-1 font-mono text-xs text-faint">{log.length}</span>}
            </button>
          ))}
        </div>

        <div role="tabpanel" aria-label={pageNames[page]} className="pt-3">
          {page === "notes" ? (
            <Notes level={level} wide={wide} />
          ) : page === "log" ? (
            <ShiftLog
              lines={log}
              onOpen={(event) => {
                level.inspect({ kind: "event", event })
                setPage("spec")
              }}
            />
          ) : (
            <>
              {level.selectedEditable && (
                <div className="mb-3 flex gap-2">
                  <button type="button" className={`${key} bg-panel px-3 py-1 text-sm text-ink`} onClick={level.rotateSelected}>
                    ↻ Rotate
                  </button>
                  <button type="button" className={`${key} bg-[#ffd9d9] px-3 py-1 text-sm text-ink`} onClick={level.removeSelected}>
                    ✕ Remove
                  </button>
                </div>
              )}
              <Inspector inspection={level.inspection} pack={level.pack} onInspect={level.inspect} />
            </>
          )}
        </div>
      </section>
    </aside>
  )
}

type Page = "notes" | "spec" | "log"
const pages = ["notes", "spec", "log"] as const satisfies readonly Page[]
const pageNames: Record<Page, string> = { notes: "Notes", spec: "Spec sheet", log: "Shift log" }

const logTones: Record<LogLine["tone"], string> = {
  ok: "border-ok text-ok",
  bad: "border-alarm text-alarm",
  warn: "border-amber text-amber",
  info: "border-accent text-accent",
  plain: "border-rule text-ink",
}

/** What just happened on the line, newest first. Each event id opens that event's spec sheet. */
function ShiftLog({ lines, onOpen }: { readonly lines: readonly LogLine[]; readonly onOpen: (event: EventId) => void }) {
  if (lines.length === 0) return <p className="text-sm text-dim">Nothing yet. Run the line and every event's story prints here.</p>
  return (
    <ol className="space-y-1">
      {lines.map((l) => (
        <li key={l.id} className={`grid grid-cols-[2.2rem_minmax(0,1fr)] gap-1.5 border-l-4 pl-2 text-[0.82rem] leading-snug ${logTones[l.tone]}`}>
          <span className="pt-px text-right font-mono text-xs text-faint">{l.tick}</span>
          <span>
            <span className="font-semibold">{l.who}</span> {l.verb}{" "}
            {l.event && (
              <button type="button" onClick={() => l.event && onOpen(l.event.id)} className="inline-flex items-baseline gap-1 rounded-sm font-semibold text-ink underline decoration-rule underline-offset-2 hover:decoration-ink">
                <span className="inline-block size-2 rounded-[2px] border border-ink" style={{ background: l.event.color }} />
                {l.event.type}
                <span className="font-mono text-xs font-normal text-dim">#{l.event.id}</span>
              </button>
            )}
            {l.tail && <span className="text-dim"> · {l.tail}</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}

function Goal({ goal, level }: { readonly goal: GoalProgress; readonly level: LevelController }) {
  const { what, where } = goalParts(level.pack, goal.goal)
  const color = goal.goal.type === "any" ? undefined : level.pack.events.get(goal.goal.type)?.color
  const share = Math.min(1, goal.count / goal.goal.deliver)
  return (
    <li className="flex items-start gap-2.5">
      <Checkbox checked={goal.met} />
      <div className="min-w-0 flex-1">
        <p className="text-[0.92rem] leading-snug">
          <span className="font-semibold">Deliver {goal.goal.deliver}</span>{" "}
          <span className="inline-flex items-baseline gap-1 font-semibold">
            {color && <span className="inline-block size-2.5 translate-y-[1px] rounded-[3px] border-[1.5px] border-ink" style={{ background: color }} />}
            {what}
          </span>{" "}
          <span className="text-dim">to {where}</span>
        </p>
        <div className="mt-1 flex items-center gap-2">
          <div className="h-2.5 flex-1 overflow-hidden rounded-full border-2 border-ink bg-raised">
            <div className="h-full" style={{ width: `${share * 100}%`, background: goal.met ? "var(--color-ok)" : (color ?? "var(--color-accent)"), transition: "width 160ms ease-out" }} />
          </div>
          <p className="shrink-0 font-mono text-sm font-bold">
            {/* Keyed by the count, so each delivery replays the bump once. */}
            <span key={goal.count} className={`ef-bump inline-block ${goal.met ? "text-ok" : ""}`}>
              {goal.count}
            </span>
            <span className="text-faint">/{goal.goal.deliver}</span>
          </p>
        </div>
      </div>
    </li>
  )
}

function Checkbox({ checked, crossed = false }: { readonly checked: boolean; readonly crossed?: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" className="mt-0.5 shrink-0" aria-hidden="true">
      <rect x="2" y="2" width="18" height="18" rx="3" fill="#fffdf6" stroke="var(--color-ink)" strokeWidth="2.5" />
      {checked && <path d="M5.5 11.5l4 4.5L19 4" fill="none" stroke="var(--color-ok)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />}
      {crossed && <path d="M6 6l10 10M16 6L6 16" fill="none" stroke="var(--color-alarm)" strokeWidth="3.2" strokeLinecap="round" />}
    </svg>
  )
}

function Notes({ level, wide }: { readonly level: LevelController; readonly wide: boolean }) {
  const { snapshot, scenario, pack } = level
  const { metrics, status } = snapshot
  const incidents = [
    { label: "failed attempts", value: metrics.failed, tone: "bg-[#ffe1a8]" },
    { label: "dead-lettered", value: metrics.deadLettered, tone: "bg-[#ffe1a8]" },
    { label: "duplicates skipped", value: metrics.duplicateIgnored, tone: "bg-[#cfe3ff]" },
    { label: "duplicates applied", value: metrics.duplicateApplied, tone: "bg-[#ffc9c9]" },
    { label: "dropped", value: metrics.dropped, tone: "bg-[#ffc9c9]" },
  ]
  const hint = snapshot.hints.at(-1)
  return (
    <div className="space-y-4">
      <Markdown text={scenario.brief} className="text-[0.95rem] leading-[28px]" />

      {status.constraints.length > 0 && (
        <Block title="Rules">
          <ul className="space-y-1.5">
            {status.constraints.map((c, i) => (
              <li key={i} className={`flex items-start gap-2 text-sm ${c.kind === "violated" ? "font-semibold text-alarm" : ""}`}>
                <Checkbox checked={c.kind !== "violated"} crossed={c.kind === "violated"} />
                <span className="pt-0.5">{constraintText(pack, c.constraint)}</span>
                {c.kind === "violated" && <span className="ml-auto pt-0.5 font-mono text-xs uppercase">broken</span>}
              </li>
            ))}
          </ul>
        </Block>
      )}

      <Block title="Incidents">
        <ul className="flex flex-wrap gap-1.5">
          {incidents.map((i) => (
            <li key={i.label} className={`rounded-lg border-2 border-ink px-2 py-0.5 text-xs font-semibold ${i.value > 0 ? i.tone : "bg-transparent text-faint"}`} style={i.value > 0 ? undefined : { borderColor: "var(--color-rule)" }}>
              <span key={i.value} className="ef-bump inline-block font-mono text-sm font-bold">
                {i.value}
              </span>{" "}
              {i.label}
            </li>
          ))}
        </ul>
      </Block>

      {hint && (
        <div key={snapshot.hints.length} className="toy-sticky toy-pop p-3 text-sm">
          <p className="mb-0.5 font-display text-xs font-bold uppercase tracking-[0.15em]">Hint</p>
          <Markdown text={hint} />
        </div>
      )}

      <p className="text-xs leading-relaxed text-faint">
        {wide ? "Pick a part, click the board to place it, drag for a belt run. R rotates, right-click removes, Space runs the line." : "Pick a part, tap the board to place it, drag for a belt run. Tap with no part picked to read the spec."}
      </p>
    </div>
  )
}

function Block({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 font-display text-xs font-semibold uppercase tracking-[0.18em] text-dim">{title}</h3>
      {children}
    </section>
  )
}

/** The result on the work order: a rubber stamp, the time against the reference, and what to do next. */
function Result({ level, outcome, onExit, onOpen }: { readonly level: LevelController; readonly outcome: Outcome; readonly onExit: () => void; readonly onOpen: (scenarioId: string) => void }) {
  const primary = `${key} px-4 py-2 text-base text-white ${outcome.won ? "bg-[#2ec36b]" : "bg-[#ff5d5d]"}`
  const secondary = `${key} bg-panel px-3 py-1.5 text-sm text-ink`
  const hint = level.snapshot.hints.at(-1)
  const { par, ticks } = outcome
  const next = level.next
  return (
    <div className="relative mt-5 rounded-xl border-[2.5px] border-ink bg-white/70 p-3 shadow-[3px_4px_0_rgba(42,31,23,0.25)]">
      <div className={`toy-stamp toy-stamp-in pointer-events-none absolute -top-7 right-1 bg-white/30 px-2 py-0.5 font-display text-2xl font-bold uppercase tracking-wider ${outcome.won ? "text-[#1f9d45]" : "text-[#d42a2a]"}`}>
        {outcome.won ? (outcome.assisted ? "Sample" : "Shipped") : "Returned"}
      </div>
      <h2 className={`font-display text-2xl font-bold leading-tight ${outcome.won ? "text-ok" : "text-alarm"}`}>{outcome.won ? "Level complete" : "Level lost"}</h2>

      {outcome.won ? (
        <>
          <Ticks ticks={ticks} par={par} />
          <p className="mt-2 text-sm">
            {outcome.assisted
              ? "That was the reference solution. Clear the map and build your own."
              : par === null || ticks === par
                ? "Right on the reference time."
                : ticks < par
                  ? `${ticksText(par - ticks)} faster than the reference.`
                  : `${ticksText(ticks - par)} behind the reference. A shorter line would close the gap.`}
            {outcome.newBest && <span className="ml-1.5 inline-block -rotate-2 rounded-md border-2 border-ink bg-[#ffd60a] px-1.5 font-display text-xs font-bold uppercase">New best</span>}
          </p>
          {outcome.debrief && (
            <div className="mt-3 border-l-4 border-ink/70 pl-2.5 text-sm leading-relaxed">
              <p className="font-display text-xs font-bold uppercase tracking-[0.15em] text-dim">Foreman's note</p>
              <Markdown text={outcome.debrief} />
            </div>
          )}
        </>
      ) : (
        <>
          <p className="mt-1 text-[0.95rem] font-semibold">{outcome.reason}</p>
          <p className="mt-1 text-sm text-dim">Stopped at tick {ticks}. Your layout is kept, so fix it and run it again.</p>
          {hint && (
            <div className="toy-sticky mt-3 p-2.5 text-sm">
              <p className="font-display text-xs font-bold uppercase tracking-[0.15em]">Hint</p>
              <Markdown text={hint} />
            </div>
          )}
        </>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {outcome.won && outcome.assisted && (
          <button type="button" className={primary} onClick={level.clear}>
            Build it myself
          </button>
        )}
        {outcome.won && !outcome.assisted && next && (
          <button type="button" className={primary} onClick={() => onOpen(next.id)}>
            Next level →
          </button>
        )}
        {!outcome.won && (
          <button type="button" className={primary} onClick={level.restart}>
            Fix and retry
          </button>
        )}
        <button type="button" className={secondary} onClick={outcome.won ? level.restart : level.clear}>
          {outcome.won ? "Run it again" : "Clear the map"}
        </button>
        {outcome.won && outcome.assisted && next && (
          <button type="button" className={secondary} onClick={() => onOpen(next.id)}>
            Next level
          </button>
        )}
        <button type="button" className={secondary} onClick={onExit}>
          All levels
        </button>
      </div>
    </div>
  )
}

const ticksText = (n: number) => `${n} ${n === 1 ? "tick" : "ticks"}`

/** Your time and the reference time as two bars on the same scale. */
function Ticks({ ticks, par }: { readonly ticks: number; readonly par: number | null }) {
  const most = Math.max(ticks, par ?? 0, 1)
  const row = (label: string, value: number, color: string) => (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-sm">
      <span className="font-semibold text-dim">{label}</span>
      <div className="h-3.5 overflow-hidden rounded-full border-2 border-ink bg-raised">
        <div className="h-full" style={{ width: `${(value / most) * 100}%`, background: color }} />
      </div>
      <span className="text-right font-mono font-bold">{value}</span>
    </div>
  )
  return (
    <div className="mt-2 space-y-1 pr-1">
      {row("Your line", ticks, "#3a86ff")}
      {par !== null && row("Reference", par, "#b9a98d")}
      <p className="text-right font-mono text-[0.7rem] uppercase tracking-widest text-faint">ticks</p>
    </div>
  )
}

function SoundIcon({ on }: { readonly on: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4z" />
      {on ? <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /> : <path d="m16 9 5 6M21 9l-5 6" />}
    </svg>
  )
}

