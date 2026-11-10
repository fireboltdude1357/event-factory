import { loadPack, type Pack, type PackInvalid, type Scenario, type Session } from "@event-factory/engine"
import { Effect, Result } from "effect"
import { useSyncExternalStore } from "react"
import packSource from "virtual:pack"
import { useLevel, useSession } from "./core/level"
import { LevelScreen as LevelLook } from "./look/level"
import { LevelSelect } from "./look/select"

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

const open = (scenarioId: string) => {
  window.location.hash = scenarioId === "" ? "" : `/${encodeURIComponent(scenarioId)}`
}

export function App() {
  const route = useSyncExternalStore(subscribeHash, readHash)
  if (Result.isFailure(loaded)) return <PackIssues error={loaded.failure} />
  const pack = loaded.success
  const scenario = pack.scenarios.find((s) => s.id === route)
  return scenario ? <Level key={scenario.id} pack={pack} scenario={scenario} /> : <LevelSelect pack={pack} onOpen={open} />
}

function Level({ pack, scenario }: { readonly pack: Pack; readonly scenario: Scenario }) {
  const session = useSession(pack, scenario)
  return session ? <Playing pack={pack} scenario={scenario} session={session} /> : null
}

function Playing({ pack, scenario, session }: { readonly pack: Pack; readonly scenario: Scenario; readonly session: Session }) {
  const level = useLevel(pack, scenario, session)
  return <LevelLook level={level} onExit={() => open("")} onOpen={open} />
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
