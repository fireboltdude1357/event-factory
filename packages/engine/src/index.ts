// Public entry: `@event-factory/engine`. Authoring helpers are a separate
// entry, `@event-factory/engine/author`, so a pack file imports nothing that
// runs a simulation. package.json `exports` lists only these two paths, so
// `@event-factory/engine/src/sim/movement` fails to resolve from outside.

export { loadPack, PackInvalid, type PackIssue } from "./pack/load.js";
export type { Pack, Scenario, Kind, EventType, Facing, OutSide, Point } from "./pack/model.js";

export { createSim, runScenario, type Sim, type SimView, type RunReport, type Trace } from "./sim/sim.js";
export { CommandRejected, outSides, sideDirection, type Command, type RejectReason } from "./sim/world.js";
export { telemetryTags, type Telemetry, type TelemetryTag, type TelemetryOf, type Outcome } from "./sim/telemetry.js";
export type { Metrics, Status, GoalProgress } from "./sim/objectives.js";

export { createSession, type Session, type SessionSnapshot, type RenderFrame, type FlashTag } from "./session.js";
// inspect() is reached through session.inspect; the CLI reads RunReport.tail instead.
export { shapeOf, type Inspection, type InspectTarget, type Fact, type BuildingShape } from "./inspect.js";

export type { EventId, EntityId, KindId, EventTypeId, ScenarioId, Tick } from "./ids.js";
