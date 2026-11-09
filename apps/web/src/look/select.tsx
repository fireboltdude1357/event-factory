import type { Pack } from "@event-factory/engine"
import { Still } from "../core/board"
import { Markdown } from "../core/markdown"
import { parOf, useProgress } from "../core/progress"
import { startFrame } from "../core/stills"
import { confettiColors } from "./draw"
import { paint } from "./paint"

/** The level list as a shelf of model kits: each level a boxed kit showing its starting board. */
export function LevelSelect({ pack, onOpen }: { readonly pack: Pack; readonly onOpen: (scenarioId: string) => void }) {
  const progress = useProgress(pack)
  const done = pack.scenarios.filter((s) => progress[s.id]).length
  const nextUp = pack.scenarios.find((s) => !progress[s.id])
  return (
    <div className="toy-bench min-h-dvh font-sans text-ink">
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-8 sm:pt-12">
        <header className="toy-plastic relative bg-panel p-5 sm:p-7" style={{ borderRadius: 24 }}>
          <p className="font-mono text-xs font-bold uppercase tracking-[0.3em] text-dim">Event Factory · levels</p>
          <h1 className="mt-1 font-display text-4xl font-bold leading-none tracking-tight sm:text-6xl">{pack.title}</h1>
          <Markdown text={pack.doc} className="mt-3 max-w-[60ch] text-base leading-relaxed text-dim sm:text-lg" />
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <ol className="flex gap-1.5" aria-hidden="true">
              {pack.scenarios.map((s, i) => (
                <li
                  key={s.id}
                  className="h-6 w-9 rounded-md border-[2.5px] border-ink"
                  style={{ background: progress[s.id] ? (confettiColors[i % confettiColors.length] ?? "#2ec36b") : "var(--color-raised)", boxShadow: progress[s.id] ? "0 3px 0 var(--color-ink)" : "none" }}
                />
              ))}
            </ol>
            <p className="font-display text-base font-semibold">
              {done} of {pack.scenarios.length} levels complete
            </p>
          </div>
        </header>

        <ol className="mt-8 grid gap-6 sm:grid-cols-2">
          {pack.scenarios.map((s, i) => {
            const best = progress[s.id]?.best
            const par = parOf(pack, s)
            const upNext = s === nextUp
            const color = confettiColors[i % confettiColors.length] ?? "#3a86ff"
            return (
              <li key={s.id}>
                <a
                  href={`#/${encodeURIComponent(s.id)}`}
                  data-level={s.id}
                  onClick={(e) => {
                    e.preventDefault()
                    onOpen(s.id)
                  }}
                  className={`toy-key group relative flex h-full flex-col overflow-hidden bg-panel ${upNext ? "ring-4 ring-[#ffd60a] ring-offset-2 ring-offset-transparent" : ""}`}
                  style={{ borderRadius: 22 }}
                >
                  <div className="flex items-center justify-between border-b-[3px] border-ink px-4 py-2" style={{ background: color }}>
                    <span className="font-display text-sm font-bold uppercase tracking-[0.2em] text-ink">Level {String(i + 1).padStart(2, "0")}</span>
                    {best !== undefined ? (
                      <span className="rounded-full border-2 border-ink bg-white px-2.5 py-0.5 font-display text-xs font-bold text-ok">✓ Built</span>
                    ) : (
                      upNext && <span className="-rotate-3 rounded-md border-2 border-ink bg-[#ffd60a] px-2.5 py-0.5 font-display text-xs font-bold uppercase">Up next</span>
                    )}
                  </div>
                  <div className="relative h-40 overflow-hidden border-b-[3px] border-ink">
                    <Still frame={startFrame(pack, s)} paint={paint} pad={16} className="block size-full" />
                    {best !== undefined && (
                      <span className="toy-stamp pointer-events-none absolute bottom-3 right-3 bg-white/40 px-2 font-display text-lg font-bold uppercase text-[#1f9d45]">Shipped</span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col p-4">
                    <h2 className="font-display text-2xl font-semibold leading-tight">{s.title}</h2>
                    <Markdown text={s.brief} className="mt-1.5 text-[0.95rem] leading-snug text-dim" />
                    <div className="mt-auto flex items-end justify-between gap-3 pt-4">
                      <p className="font-mono text-sm text-dim">
                        {best !== undefined ? (
                          <>
                            best <span className="font-bold text-ok">{best}</span> ticks{par !== null && <> · ref {par}</>}
                          </>
                        ) : (
                          par !== null && <>reference {par} ticks</>
                        )}
                      </p>
                      <span className={`toy-key shrink-0 px-4 py-2 font-display text-sm font-bold ${upNext ? "bg-[#2ec36b] text-white" : "bg-raised"}`} style={{ borderRadius: 999 }}>
                        {best !== undefined ? "Play again" : "Start level"}
                      </span>
                    </div>
                  </div>
                </a>
              </li>
            )
          })}
        </ol>
      </main>
    </div>
  )
}
