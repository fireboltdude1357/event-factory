import { runScenario, type Pack, type Scenario } from "@event-factory/engine"
import { Result } from "effect"
import { useSyncExternalStore } from "react"

/** Per level: the fewest ticks the player has won it in. A level with no entry is not yet won. */
export type Progress = Readonly<Record<string, { readonly best: number }>>

const listeners = new Set<() => void>()
const cache = new Map<string, Progress>()
const empty: Progress = {}

const storageKey = (pack: Pack) => `event-factory:progress:${pack.id}`

function read(pack: Pack): Progress {
  const cached = cache.get(pack.id)
  if (cached) return cached
  let progress = empty
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(pack)) ?? "{}")
    if (parsed !== null && typeof parsed === "object") {
      progress = Object.fromEntries(
        Object.entries(parsed).flatMap(([id, v]) =>
          v !== null && typeof v === "object" && "best" in v && typeof v.best === "number" ? [[id, { best: v.best }]] : [],
        ),
      )
    }
  } catch {
    // Unreadable or blocked storage: start with no progress.
  }
  cache.set(pack.id, progress)
  return progress
}

/** Records a win. Returns true when it beat the stored best, or was the first. */
export function recordWin(pack: Pack, scenario: Scenario, ticks: number): boolean {
  const before = read(pack)
  const prior = before[scenario.id]?.best
  if (prior !== undefined && prior <= ticks) return false
  const next = { ...before, [scenario.id]: { best: ticks } }
  cache.set(pack.id, next)
  try {
    localStorage.setItem(storageKey(pack), JSON.stringify(next))
  } catch {
    // Kept for this page only.
  }
  for (const notify of listeners) notify()
  return true
}

const subscribe = (onChange: () => void) => {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

export const useProgress = (pack: Pack): Progress => useSyncExternalStore(subscribe, () => read(pack))

const pars = new WeakMap<Scenario, number | null>()

/** Ticks the pack's reference solution takes: the time to beat. Run once per level and kept. */
export function parOf(pack: Pack, scenario: Scenario): number | null {
  if (!pars.has(scenario)) {
    const report = runScenario(pack, scenario, { kind: "solution" })
    pars.set(scenario, Result.isSuccess(report) && report.success.status.outcome.kind === "won" ? report.success.ticks : null)
  }
  return pars.get(scenario) ?? null
}
