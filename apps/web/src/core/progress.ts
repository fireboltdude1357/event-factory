import { runScenario, type Pack, type Scenario } from "@event-factory/engine"
import { Result } from "effect"
import { useSyncExternalStore } from "react"

/** Per level id: the fewest ticks the player has won it in. A level with no entry is not yet won. */
export type Progress = ReadonlyMap<string, number>

const listeners = new Set<() => void>()
const cache = new Map<string, Progress>()

const prefix = "event-factory:progress:"
const storageKey = (pack: Pack) => `${prefix}${pack.id}`

function load(pack: Pack): Progress {
  const progress = new Map<string, number>()
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(pack)) ?? "{}")
    if (parsed !== null && typeof parsed === "object")
      for (const [id, v] of Object.entries(parsed)) if (v !== null && typeof v === "object" && "best" in v && typeof v.best === "number") progress.set(id, v.best)
  } catch {
    // Unreadable or blocked storage: start with no progress.
  }
  return progress
}

function read(pack: Pack): Progress {
  let progress = cache.get(pack.id)
  if (!progress) {
    progress = load(pack)
    cache.set(pack.id, progress)
  }
  return progress
}

/** Records a win. Returns true when it beat the stored best, or was the first. */
export function recordWin(pack: Pack, scenario: Scenario, ticks: number): boolean {
  // Storage may hold wins another tab saved since this one loaded, and the cache may hold wins storage refused to keep.
  const before = new Map(load(pack))
  for (const [id, best] of read(pack)) before.set(id, Math.min(best, before.get(id) ?? best))
  const prior = before.get(scenario.id)
  const beat = prior === undefined || ticks < prior
  const next = beat ? new Map(before).set(scenario.id, ticks) : before
  cache.set(pack.id, next)
  // Written on every win, not only a new best: an earlier write may have been refused, and this one may get through.
  try {
    localStorage.setItem(storageKey(pack), JSON.stringify(Object.fromEntries([...next].map(([id, best]) => [id, { best }]))))
  } catch {
    // Kept for this page only.
  }
  for (const notify of listeners) notify()
  return beat
}

const subscribe = (onChange: () => void) => {
  // Another tab saved progress: drop the cache so the next read sees it.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && !e.key.startsWith(prefix)) return
    cache.clear()
    onChange()
  }
  listeners.add(onChange)
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener("storage", onStorage)
  }
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
