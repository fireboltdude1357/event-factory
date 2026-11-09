import type { EntityId, EventId, Telemetry } from "@event-factory/engine"
import { useEffect, useRef, useState } from "react"
import type { LevelController } from "./level"

export type Tone = "ok" | "bad" | "warn" | "info" | "plain"

/** One printed line of the run: who did what to which event. */
export interface LogLine {
  readonly id: number
  readonly tick: number
  readonly tone: Tone
  readonly who: string | null
  readonly verb: string
  readonly event: { readonly type: string; readonly id: EventId; readonly color: string } | null
  readonly tail: string
}

const cap = 40
const flushMs = 120

type DropReason = Extract<Telemetry, { readonly tag: "dropped" }>["reason"]

const dropWords: Record<DropReason, string> = {
  sourceBlocked: "nowhere to publish it",
  brokerFull: "the buffer was full",
  noSubscribers: "no subscriber was linked",
  unmatched: "no recipe matched it",
  exhausted: "its retries ran out",
  removed: "what held it was removed",
}

/**
 * The run's telemetry as plain sentences, newest first. Records are buffered
 * and printed on a short timer, so a run at 8x re-renders a few times a
 * second, not once per event. Cleared whenever the level goes back to tick 0.
 */
export function useEventLog(level: LevelController): readonly LogLine[] {
  const { session, pack, started } = level
  const [lines, setLines] = useState<readonly LogLine[]>([])
  const buffer = useRef<Telemetry[]>([])
  const ids = useRef(0)

  useEffect(() => {
    if (started) return
    buffer.current = []
    setLines([])
  }, [started])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    const flush = () => {
      timer = null
      const records = buffer.current.slice(-cap)
      buffer.current = []
      const frame = session.frame()
      const names = new Map<EntityId, string>([...frame.belts.map((b) => [b.entity, pack.belt.title] as const), ...frame.buildings.map((b) => [b.entity, b.title] as const)])
      // A removed belt or building is no longer in the frame, and the record does not say which it was.
      const nameOf = (entity: EntityId) => names.get(entity) ?? "A removed part"
      const ofEvent = (event: EventId) => {
        const type = session.typeOf(event)
        return { type: type ?? "event", id: event, color: (type && pack.events.get(type)?.color) ?? "#888888" }
      }
      const fresh: LogLine[] = []
      for (const t of records) {
        const line = describe(t, nameOf, ofEvent)
        if (line) fresh.push({ ...line, id: ids.current++, tick: t.tick })
      }
      if (fresh.length > 0) setLines((prev) => [...fresh.reverse(), ...prev].slice(0, cap))
    }

    const unsubscribe = session.onAny((t) => {
      buffer.current.push(t)
      timer ??= setTimeout(flush, flushMs)
    })
    return () => {
      unsubscribe()
      if (timer !== null) clearTimeout(timer)
    }
  }, [session, pack])

  return lines
}

type Described = Omit<LogLine, "id" | "tick">

function describe(t: Telemetry, nameOf: (entity: EntityId) => string, ofEvent: (event: EventId) => NonNullable<LogLine["event"]>): Described | null {
  switch (t.tag) {
    case "emitted":
      return { tone: "plain", who: nameOf(t.entity), verb: "published", event: ofEvent(t.event), tail: "" }
    case "produced":
      return { tone: "plain", who: nameOf(t.entity), verb: "produced", event: ofEvent(t.event), tail: "" }
    case "delivered":
      return { tone: "ok", who: nameOf(t.entity), verb: "applied", event: ofEvent(t.event), tail: "" }
    case "failed":
      return {
        tone: "bad",
        who: nameOf(t.entity),
        verb: "failed on",
        event: ofEvent(t.event),
        tail: `attempt ${t.attempt}, ${t.timing === "beforeEffect" ? "before its effect" : "after its effect ran"}`,
      }
    case "retrying":
      return { tone: "warn", who: nameOf(t.entity), verb: "will retry", event: ofEvent(t.event), tail: `at tick ${t.at}` }
    case "deadLettered":
      return { tone: "warn", who: nameOf(t.entity), verb: "parked", event: ofEvent(t.event), tail: "dead-lettered" }
    case "dropped":
      return { tone: "bad", who: nameOf(t.entity), verb: "lost", event: ofEvent(t.event), tail: dropWords[t.reason] }
    case "duplicateApplied":
      return { tone: "bad", who: nameOf(t.entity), verb: "applied", event: ofEvent(t.event), tail: "a second time" }
    case "duplicateIgnored":
      return { tone: "info", who: nameOf(t.entity), verb: "skipped a duplicate", event: ofEvent(t.event), tail: "" }
    case "outOfOrder":
      return { tone: "warn", who: nameOf(t.entity), verb: "saw", event: ofEvent(t.event), tail: "out of order" }
    case "stalled":
      return { tone: "warn", who: nameOf(t.entity), verb: "stalled", event: null, tail: "nowhere to hand off" }
    case "unstalled":
      return { tone: "plain", who: nameOf(t.entity), verb: "is moving again", event: null, tail: "" }
    case "hint":
    case "finished":
    case "accepted":
    case "objectiveProgress":
      return null
  }
}
