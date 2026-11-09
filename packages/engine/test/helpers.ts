import { Effect } from "effect";
import { createSim, loadPack, type Pack, type Sim, type Telemetry, type TelemetryOf, type TelemetryTag } from "../src/index.js";
import { ended } from "../src/sim/objectives.js";

export const belt = { title: "belt", doc: "", ticksPerTile: 2 } as const;

/** A solution overlay that places nothing, for levels whose map is already complete. */
export const nothing = (map: readonly string[]) => ({ map: map.map((row) => ".".repeat(row.length)), legend: {} });

export const load = (decl: unknown): Pack => Effect.runSync(loadPack(decl));

/** Steps until finished, asserting parcel conservation after every tick. */
export function finish(sim: Sim): Sim {
  while (sim.status.kind === "running") {
    sim.step();
    const { minted, live } = sim.metrics.parcels;
    if (minted !== live + ended(sim.metrics)) throw new Error(`conservation broken at tick ${sim.tick}: minted ${minted}, live ${live}, ended ${ended(sim.metrics)}`);
  }
  return sim;
}

export const play = (pack: Pack, scenario = 0): Sim => {
  const s = pack.scenarios[scenario];
  if (s === undefined) throw new Error(`no scenario ${scenario}`);
  return finish(createSim(pack, s));
};

export function tagged<T extends TelemetryTag>(history: readonly Telemetry[], tag: T): TelemetryOf<T>[] {
  return history.filter((t): t is TelemetryOf<T> => t.tag === tag);
}

/** Delivered events at the sink placed at `x,y`, in delivery order. */
export function deliveredAt(sim: Sim, x: number, y: number) {
  const entity = sim.layout.byCell.get(y * sim.scenario.width + x);
  return tagged(sim.history, "delivered")
    .filter((t) => t.entity === entity)
    .map((t) => sim.log.get(t.event));
}
