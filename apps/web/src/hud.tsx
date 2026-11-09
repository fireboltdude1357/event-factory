import type { GoalProgress, Pack, SessionSnapshot, Status } from "@event-factory/engine"
import type { ReactNode } from "react"
import { Markdown } from "./markdown"

type ConstraintState = Status["constraints"][number]
type Constraint = ConstraintState["constraint"]
type Goal = GoalProgress["goal"]
type Finished = Extract<Status, { kind: "finished" }>

/** Goals, constraints, the outcome, counters and hints, all from the session snapshot. */
export function Hud({ snapshot, pack }: { readonly snapshot: SessionSnapshot; readonly pack: Pack }) {
  const names = namer(pack)
  const { status, metrics } = snapshot
  return (
    <div className="space-y-5">
      {status.kind === "finished" && <OutcomeBanner status={status} names={names} />}

      <Block title="Goals">
        <ul className="space-y-2.5">
          {snapshot.goals.map((g, i) => (
            <li key={i}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className={g.met ? "text-ok" : ""}>{goalText(g.goal, names)}</span>
                <span className="shrink-0 text-dim">
                  {g.count}/{g.goal.deliver}
                </span>
              </div>
              <div className="mt-1 h-1 rounded-full bg-slate">
                <div
                  className={`h-full rounded-full ${g.met ? "bg-ok" : "bg-dim"}`}
                  style={{ width: `${Math.min(100, (g.count / g.goal.deliver) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </Block>

      {status.constraints.length > 0 && (
        <Block title="Rules">
          <ul className="space-y-1 text-sm">
            {status.constraints.map((c, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3">
                <span className={c.kind === "violated" ? "text-alarm" : ""}>{constraintText(c.constraint, names)}</span>
                <span className={`shrink-0 text-xs ${c.kind === "violated" ? "text-alarm" : "text-dim"}`}>
                  {c.kind === "violated" ? `broken (${c.by})` : "holding"}
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      <Block title="Counters">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <Counter label="Dropped" value={metrics.dropped} alarm />
          <Counter label="Dead-lettered" value={metrics.deadLettered} />
          <Counter label="Failed attempts" value={metrics.failed} />
          <Counter label="Duplicates applied" value={metrics.duplicateApplied} alarm />
          <Counter label="Duplicates skipped" value={metrics.duplicateIgnored} />
        </dl>
      </Block>

      {snapshot.hints.length > 0 && (
        <Block title="Hints">
          <ol className="space-y-2">
            {snapshot.hints.map((h, i) => (
              <li key={i} className={`border-l-2 pl-3 text-sm ${i === snapshot.hints.length - 1 ? "border-amber" : "border-rule text-ink/70"}`}>
                <Markdown text={h} />
              </li>
            ))}
          </ol>
        </Block>
      )}
    </div>
  )
}

function OutcomeBanner({ status, names }: { readonly status: Finished; readonly names: Names }) {
  const { outcome } = status
  if (outcome.kind === "won")
    return (
      <div className="rounded-sm border border-ok/70 bg-ok/10 px-3 py-2.5">
        <p className="font-display text-lg font-semibold text-ok">Level complete</p>
        <p className="text-sm text-ink/80">Every goal met by tick {status.at}.</p>
      </div>
    )
  const reason = outcome.reason
  const broken = reason.kind === "constraint" ? status.constraints[reason.index]?.constraint : undefined
  return (
    <div className="rounded-sm border border-alarm/70 bg-alarm/10 px-3 py-2.5">
      <p className="font-display text-lg font-semibold text-alarm">Level lost at tick {status.at}</p>
      <p className="text-sm text-ink/80">
        {reason.kind === "outOfTime"
          ? "Time ran out before every goal was met."
          : `Rule broken: ${broken ? constraintText(broken, names) : "a rule"}.`}{" "}
        Reset to try again.
      </p>
    </div>
  )
}

function Block({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 font-display text-sm font-semibold text-dim">{title}</h2>
      {children}
    </section>
  )
}

function Counter({ label, value, alarm = false }: { readonly label: string; readonly value: number; readonly alarm?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-dim">{label}</dt>
      <dd className={alarm && value > 0 ? "text-alarm" : ""}>{value}</dd>
    </div>
  )
}

interface Names {
  readonly type: (id: Goal["type"]) => string
  readonly at: (id: Goal["at"]) => string
}

function namer(pack: Pack): Names {
  return {
    type: (id) => (id === "any" ? "events" : id),
    at: (id) => (id === "anyExternal" ? "any external system" : (pack.kinds.get(id)?.title ?? id)),
  }
}

function goalText(goal: Goal, names: Names): string {
  return `Deliver ${goal.deliver} ${names.type(goal.type)} to ${names.at(goal.at)}`
}

function constraintText(c: Constraint, names: Names): string {
  switch (c.kind) {
    case "noLoss":
      return "Drop nothing"
    case "noDuplicateEffects":
      return "No side effect applied twice"
    case "maxDeadLettered":
      return `At most ${c.n} dead-lettered`
    case "maxLatency":
      return `${c.type === "any" ? "Every event" : c.type} arrives within ${c.ticks} ticks`
    case "inOrder":
      return `${names.at(c.at)} sees events in order`
  }
}
