import { loadPack, type Pack, type PackInvalid } from "@event-factory/engine"
import { Effect, Result } from "effect"
import { useSyncExternalStore } from "react"
import packSource from "virtual:pack"
import { Level } from "./level"
import { Markdown } from "./markdown"

/** Decoded once at startup. A broken pack renders its issue list instead of the game. */
const loaded = Effect.runSync(Effect.result(loadPack(packSource)))

const subscribeHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange)
  return () => window.removeEventListener("hashchange", onChange)
}
/** A fragment with malformed percent-encoding names no level, so it shows the level list. */
const readHash = () => {
  try {
    return decodeURIComponent(window.location.hash.replace(/^#\/?/, ""))
  } catch {
    return ""
  }
}

export function App() {
  const route = useSyncExternalStore(subscribeHash, readHash)
  if (Result.isFailure(loaded)) return <PackIssues error={loaded.failure} />
  const pack = loaded.success
  const scenario = pack.scenarios.find((s) => s.id === route)
  if (!scenario) return <LevelSelect pack={pack} />
  return <Level key={scenario.id} pack={pack} scenario={scenario} onExit={() => (window.location.hash = "")} />
}

function LevelSelect({ pack }: { readonly pack: Pack }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <p className="text-sm text-dim">Event Factory</p>
      <h1 className="mt-1 font-display text-5xl font-bold leading-none tracking-tight sm:text-6xl">{pack.title}</h1>
      <Markdown text={pack.doc} className="mt-4 max-w-[62ch] text-lg leading-relaxed text-ink/85" />

      <ol className="mt-10 border-t border-rule">
        {pack.scenarios.map((s, i) => (
          <li key={s.id} className="border-b border-rule">
            <a
              href={`#/${encodeURIComponent(s.id)}`}
              className="group grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 py-5 hover:bg-panel sm:grid-cols-[3rem_minmax(0,1fr)_auto] sm:px-3"
            >
              <span className="font-display text-3xl font-semibold leading-none text-faint group-hover:text-dim">{i + 1}</span>
              <span>
                <span className="block font-display text-xl font-semibold leading-tight">{s.title}</span>
                <Markdown text={s.brief} className="mt-1 max-w-[62ch] text-[0.95rem] leading-snug text-dim" />
              </span>
              <span className="col-start-2 mt-3 self-center text-sm text-ink underline decoration-rule underline-offset-4 group-hover:decoration-ink sm:col-start-3 sm:mt-0">
                Start level
              </span>
            </a>
          </li>
        ))}
      </ol>
    </main>
  )
}

function PackIssues({ error }: { readonly error: PackInvalid }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-display text-3xl font-bold text-alarm">This pack did not load</h1>
      <p className="mt-2 text-dim">
        Fix each issue in the pack file and save. The page reloads on its own. {error.issues.length}{" "}
        {error.issues.length === 1 ? "issue" : "issues"}:
      </p>
      <ul className="mt-6 space-y-3">
        {error.issues.map((issue, i) => (
          <li key={i} className="border-l-2 border-alarm pl-3">
            <code className="block break-all font-mono text-sm text-ink">{issue.path}</code>
            <span className="text-sm text-ink/80">{issue.message}</span>
          </li>
        ))}
      </ul>
    </main>
  )
}
