import type { EntityId, EventId, Fact, Inspection, InspectTarget, Pack, Telemetry, Trace } from "@event-factory/engine"
import type { ReactNode } from "react"
import { Markdown } from "./markdown"

type EventRecord = Trace["root"]
type Inspect = (target: InspectTarget) => void

/** The docs-and-facts panel. Everything it says comes from the pack or the engine. */
export function Inspector({
  inspection,
  pack,
  onInspect,
}: {
  readonly inspection: Inspection | null
  readonly pack: Pack
  readonly onInspect: Inspect
}) {
  if (!inspection)
    return (
      <p className="text-sm text-dim">
        Click anything on the map to read what it is and see what it is doing. Click a palette item to read its docs.
      </p>
    )
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-dim">{inspection.role}</p>
        <h3 className="font-display text-xl font-semibold leading-tight">{inspection.title}</h3>
      </div>
      {inspection.doc && <Markdown text={inspection.doc} className="text-sm leading-relaxed text-ink/85" />}
      {inspection.facts.length > 0 && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
          {inspection.facts.map((fact, i) => (
            <FactRow key={i} fact={fact} pack={pack} onInspect={onInspect} />
          ))}
        </dl>
      )}
      {inspection.trace && <TraceView trace={inspection.trace} pack={pack} onInspect={onInspect} />}
    </div>
  )
}

function FactRow({ fact, pack, onInspect }: { readonly fact: Fact; readonly pack: Pack; readonly onInspect: Inspect }) {
  switch (fact.kind) {
    case "text":
      return <Pair label={fact.label}>{fact.value}</Pair>
    case "count":
      return <Pair label={fact.label}>{fact.value}</Pair>
    case "event":
      return (
        <Pair label={fact.label}>
          <EventLink id={fact.event} pack={pack} onInspect={onInspect} />
        </Pair>
      )
    case "payload":
      return (
        <>
          {fact.fields.map((f) => (
            <Pair key={f.name} label={f.name}>
              <span className="font-mono text-[0.85em]">{f.value}</span>
            </Pair>
          ))}
        </>
      )
  }
}

function Pair({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <>
      <dt className="text-dim">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  )
}

function TraceView({ trace, pack, onInspect }: { readonly trace: Trace; readonly pack: Pack; readonly onInspect: Inspect }) {
  const current = trace.path.at(-1) ?? trace.root
  return (
    <div className="space-y-4 border-t border-rule pt-4">
      <Section title="Caused by">
        <ol className="space-y-1">
          {trace.path.map((e, i) => (
            <li key={e.id} style={{ paddingLeft: `${i * 0.75}rem` }}>
              <EventRow event={e} pack={pack} onInspect={onInspect} current={e.id === current.id} />
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Led to">
        {trace.descendants.length === 0 ? (
          <p className="text-sm text-dim">Nothing yet.</p>
        ) : (
          <ol className="space-y-1">
            {trace.descendants.map(({ event, depth }) => (
              <li key={event.id} style={{ paddingLeft: `${(depth - 1) * 0.75}rem` }}>
                <EventRow event={event} pack={pack} onInspect={onInspect} current={false} />
              </li>
            ))}
          </ol>
        )}
      </Section>

      {trace.siblings.length > 0 && (
        <Section title="Same idempotency key">
          <p className="mb-1 text-sm text-dim">
            These are the same operation produced again. A sink that dedupes on{" "}
            <code className="font-mono text-[0.85em] text-ink">{current.idempotencyKey}</code> applies it once.
          </p>
          <ul className="flex flex-wrap gap-2">
            {trace.siblings.map((id) => (
              <li key={id}>
                <EventLink id={id} pack={pack} onInspect={onInspect} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Timeline">
        <ol className="space-y-0.5 text-sm">
          {trace.timeline.map((t, i) => (
            <li key={i} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2">
              <span className="text-right text-dim">t{t.tick}</span>
              <span className={alarming.has(t.tag) ? "text-alarm" : warning.has(t.tag) ? "text-amber" : ""}>
                <TelemetryLine t={t} pack={pack} onInspect={onInspect} />
              </span>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  )
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section>
      <h4 className="mb-1.5 font-display text-sm font-semibold text-dim">{title}</h4>
      {children}
    </section>
  )
}

function EventRow({
  event,
  pack,
  onInspect,
  current,
}: {
  readonly event: EventRecord
  readonly pack: Pack
  readonly onInspect: Inspect
  readonly current: boolean
}) {
  return (
    <div className={`flex min-w-0 items-baseline gap-2 text-sm ${current ? "text-ink" : "text-ink/80"}`}>
      <EventLink id={event.id} pack={pack} onInspect={onInspect} type={event.type} />
      <span className="truncate font-mono text-[0.75rem] text-faint" title={event.idempotencyKey}>
        {event.idempotencyKey}
      </span>
    </div>
  )
}

/** A clickable event id. With `type` it also shows the event type and its pack color. */
function EventLink({
  id,
  pack,
  onInspect,
  type,
}: {
  readonly id: EventId
  readonly pack: Pack
  readonly onInspect: Inspect
  readonly type?: EventRecord["type"]
}) {
  const color = type ? pack.events.get(type)?.color : undefined
  return (
    <button
      type="button"
      onClick={() => onInspect({ kind: "event", event: id })}
      className="inline-flex shrink-0 items-baseline gap-1.5 rounded-sm text-left underline decoration-rule underline-offset-2 hover:decoration-ink"
    >
      {color && <span className="inline-block size-2 translate-y-[-1px] rounded-full" style={{ background: color }} />}
      {type && <span>{type}</span>}
      <span className="font-mono text-[0.8rem] text-dim">#{id}</span>
    </button>
  )
}

function EntityLink({ id, onInspect }: { readonly id: EntityId; readonly onInspect: Inspect }) {
  return (
    <button
      type="button"
      onClick={() => onInspect({ kind: "entity", entity: id })}
      className="rounded-sm underline decoration-rule underline-offset-2 hover:decoration-ink"
    >
      building {id}
    </button>
  )
}

const alarming = new Set<Telemetry["tag"]>(["failed", "dropped", "duplicateApplied"])
const warning = new Set<Telemetry["tag"]>(["retrying", "deadLettered", "duplicateIgnored", "outOfOrder", "stalled"])

function TelemetryLine({ t, pack, onInspect }: { readonly t: Telemetry; readonly pack: Pack; readonly onInspect: Inspect }) {
  const at = "entity" in t ? <EntityLink id={t.entity} onInspect={onInspect} /> : null
  switch (t.tag) {
    case "emitted":
      return <>emitted by {at}</>
    case "accepted":
      return <>taken in by {at}</>
    case "produced":
      return (
        <>
          produced by {at} from <EventLink id={t.cause} pack={pack} onInspect={onInspect} />
        </>
      )
    case "failed":
      return (
        <>
          attempt {t.attempt} failed {t.timing === "afterEffect" ? "after its side effect" : "before its side effect"} at {at}
        </>
      )
    case "retrying":
      return (
        <>
          retry {t.attempt} scheduled for t{t.at} at {at}
        </>
      )
    case "deadLettered":
      return <>dead-lettered at {at}</>
    case "dropped":
      return (
        <>
          dropped at {at}: {dropReasons[t.reason]}
        </>
      )
    case "delivered":
      return <>applied by {at}</>
    case "duplicateApplied":
      return <>applied again by {at}: a duplicate side effect</>
    case "duplicateIgnored":
      return <>recognised as a duplicate and skipped by {at}</>
    case "outOfOrder":
      return (
        <>
          arrived out of order at {at} (seq {t.seq} after {t.expectedAfter})
        </>
      )
    case "stalled":
      return <>{at} stalled</>
    case "unstalled":
      return <>{at} moving again</>
    case "objectiveProgress":
      return (
        <>
          goal {t.goal + 1}: {t.count}/{t.target}
        </>
      )
    case "hint":
      return <>hint: {t.text}</>
    case "finished":
      return <>level {t.outcome.kind}</>
  }
}

const dropReasons: Record<Extract<Telemetry, { tag: "dropped" }>["reason"], string> = {
  sourceBlocked: "the producer had nowhere to put it",
  brokerFull: "the broker was full",
  noSubscribers: "the topic had no subscribers",
  unmatched: "no handler recipe matched it",
  exhausted: "it ran out of retries",
  removed: "its building or belt was removed",
}
