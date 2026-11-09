// Times the authoring generics on a company-sized pack: 200 event types and
// 60 kinds, with machines that filter, copy every field, and forward.
//   pnpm --filter @event-factory/engine bench:types
// Writes a generated pack next to this file, type-checks only that file,
// prints the time, and deletes it. Fails if the pack does not type-check.

import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const events = 200;
const kinds = 60;
const here = dirname(fileURLToPath(import.meta.url));
const packFile = join(here, "large-pack.generated.ts");
const configFile = join(here, "tsconfig.generated.json");

const eventLines = Array.from(
  { length: events },
  (_, i) => `    E${i}: { doc: "event ${i}", fields: { id: "string", n: "number", region: ["us", "eu", "apac"], ok: "boolean" }, key: ["id"] },`,
);

const kindLine = (k: number): string => {
  switch (k % 4) {
    case 0:
      return `    K${k}: { archetype: "source", title: "K${k}", doc: "", whenBlocked: "wait", emits: [{ type: "E${k % events}", every: 2, count: 5, payloads: [{ values: { id: { seq: "x-" }, n: 1, region: "us", ok: true } }] }] },`;
    case 1:
      return `    K${k}: { archetype: "broker", title: "K${k}", doc: "", delivery: "fanout", capacity: 4, whenFull: "block" },`;
    case 2: {
      const recipes = Array.from({ length: 6 }, (_, r) => {
        const from = (k + r) % events;
        const to = (k + r + 1) % events;
        return `{ consume: "E${from}", where: { all: [{ field: "region", oneOf: ["us", "eu"] }, { field: "n", above: 3 }] }, ticks: 2, emit: [{ port: "out", produce: "E${to}", copy: ["id", "n", "region", "ok"] }, { forward: "side" }] }`;
      }).join(", ");
      return `    K${k}: { archetype: "machine", title: "K${k}", doc: "", outputs: { out: "front", side: "left", dlq: "right" }, workers: 2, recipes: [${recipes}], unmatched: { route: "dlq" }, failures: { maxAttempts: 3, backoff: { doubling: 2 }, exhausted: { route: "dlq" } } },`;
    }
    default:
      return `    K${k}: { archetype: "sink", title: "K${k}", doc: "", accepts: ["E${k % events}", "E${(k + 1) % events}"], ticksPerEvent: 1, role: { kind: "external", dedupe: "idempotencyKey" } },`;
  }
};

const source = `import { defineCatalog, definePack } from "@event-factory/engine/author";
const catalog = defineCatalog({
  belt: { title: "belt", doc: "", ticksPerTile: 2 },
  events: {
${eventLines.join("\n")}
  },
  kinds: {
${Array.from({ length: kinds }, (_, k) => kindLine(k)).join("\n")}
  },
});
export default definePack({ id: "big", title: "", doc: "", catalog, scenarios: [{
  id: "s", title: "", brief: "", seed: 1, maxTicks: 10,
  map: [".A.B."], legend: { A: { kind: "K0", facing: "east" }, B: { kind: "K3", facing: "east" } },
  unlocked: ["belt", "K2"],
  faults: [{ kinds: ["K2"], event: "E2", where: { field: "n", above: 1 }, chance: 0.1, timing: "afterEffect" }],
  goals: [{ deliver: 1, type: "E0", at: "K3" }],
  solution: { map: ["..>.."], legend: {} },
}] });
`;

writeFileSync(packFile, source);
writeFileSync(configFile, JSON.stringify({ extends: "../../tsconfig.json", include: [], files: ["large-pack.generated.ts"] }));
try {
  const started = performance.now();
  execFileSync("tsc", ["-p", configFile, "--noEmit"], { stdio: "inherit" });
  console.log(`${events} events, ${kinds} kinds: type-checked in ${((performance.now() - started) / 1000).toFixed(2)}s`);
} finally {
  rmSync(packFile, { force: true });
  rmSync(configFile, { force: true });
}
