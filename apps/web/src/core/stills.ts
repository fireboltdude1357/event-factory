import { createSession, type Pack, type RenderFrame, type Scenario } from "@event-factory/engine"

const frames = new WeakMap<Scenario, RenderFrame>()

/** A level's map at tick 0, for thumbnails. Built once per level. */
export function startFrame(pack: Pack, scenario: Scenario): RenderFrame {
  let frame = frames.get(scenario)
  if (!frame) {
    const session = createSession(pack, scenario.id)
    frame = session.frame()
    session.dispose()
    frames.set(scenario, frame)
  }
  return frame
}
