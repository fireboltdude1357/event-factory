import type { GoalProgress, KindId, Pack, RejectReason, Status } from "@event-factory/engine"

export type ConstraintState = Status["constraints"][number]
type Constraint = ConstraintState["constraint"]
type Goal = GoalProgress["goal"]
export type Finished = Extract<Status, { kind: "finished" }>

const placeName = (pack: Pack, id: Goal["at"]) => (id === "anyExternal" ? "any external system" : (pack.kinds.get(id)?.title ?? id))

export const goalText = (pack: Pack, goal: Goal): string =>
  `Deliver ${goal.deliver} ${goal.type === "any" ? "events" : goal.type} to ${placeName(pack, goal.at)}`

/** The goal split for a compact chip: what to deliver and where. */
export const goalParts = (pack: Pack, goal: Goal) => ({ what: goal.type === "any" ? "events" : goal.type, where: placeName(pack, goal.at) })

export function constraintText(pack: Pack, c: Constraint): string {
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
      return `${placeName(pack, c.at)} sees events in order`
  }
}

/** Why a finished level was lost, in one sentence, or null when it was won. */
export function lossText(pack: Pack, status: Finished): string | null {
  if (status.outcome.kind === "won") return null
  const reason = status.outcome.reason
  if (reason.kind === "outOfTime") return "Time ran out before every goal was met."
  const broken = status.constraints[reason.index]?.constraint
  return `Rule broken: ${broken ? constraintText(pack, broken) : "a rule"}.`
}

export function rejectText(reason: RejectReason, title: (id: KindId | "belt") => string): string {
  switch (reason.kind) {
    case "outOfBounds":
      return "That cell is outside the map."
    case "wall":
      return "That cell is a wall."
    case "occupied":
      return "Something is already there. Remove it first."
    case "empty":
      return "There is nothing there."
    case "locked":
      return "That is part of the level and cannot be changed."
    case "notUnlocked":
      return `${title(reason.build)} is not available in this level.`
    case "overBudget":
      return `This level allows ${reason.limit} ${title(reason.build)}.`
    case "finished":
      return "The level is over. Restart to build again."
  }
}
