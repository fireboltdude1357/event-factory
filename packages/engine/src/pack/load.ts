// The only way into the engine. Decodes an unknown value (the default export
// of a pack module) with effect/Schema, resolves every reference, parses the
// ASCII maps, and returns a Pack the rest of the engine trusts.
//
// The authoring types check most of these rules in the editor. Every rule is
// repeated here, because a JSON pack or an untyped one must still fail with
// a message that names the exact path to fix.

import { Data, Effect, Schema, SchemaIssue } from "effect";
import { EventTypeId, KindId, PortId, ScenarioId } from "../ids.js";
import { hintTags } from "../sim/telemetry.js";
import type { FieldType } from "./authoring.js";
import {
  countPlaced,
  packBrand,
  type Constraint,
  type Disposal,
  type Emit,
  type EventType,
  type Facing,
  type Fault,
  type FieldValue,
  type Goal,
  type Hint,
  type Kind,
  type MachineKind,
  type Pack,
  type Placement,
  type Port,
  type Predicate,
  type Recipe,
  type Scenario,
  type Terrain,
} from "./model.js";

/** One problem, addressed by a path into the pack source. */
export interface PackIssue {
  /** e.g. `catalog.kinds.PaymentService.recipes[0].emit[0].produce` */
  readonly path: string;
  readonly message: string;
}

/** All issues at once, so an agent fixes a pack in one pass, not one error per run. */
export class PackInvalid extends Data.TaggedError("PackInvalid")<{
  readonly issues: readonly [PackIssue, ...PackIssue[]];
}> {}

// ---------- structure ----------

type WhereSource =
  | { readonly field: string; readonly is: FieldValue }
  | { readonly field: string; readonly oneOf: readonly FieldValue[] }
  | { readonly field: string; readonly above?: number; readonly below?: number }
  | { readonly version: number }
  | { readonly all: readonly WhereSource[] }
  | { readonly any: readonly WhereSource[] }
  | { readonly not: WhereSource };

const FieldValueSchema = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean]);
const FieldTypeSchema = Schema.Union([Schema.Literals(["string", "number", "boolean"]), Schema.NonEmptyArray(Schema.String)]);
const WhereSchema: Schema.Codec<WhereSource> = Schema.Union([
  Schema.Struct({ field: Schema.String, is: FieldValueSchema }),
  Schema.Struct({ field: Schema.String, oneOf: Schema.Array(FieldValueSchema) }),
  // One struct for every range, so a bad bound fails here rather than matching a narrower branch that strips it.
  // A bad `is` or `oneOf` must fail too, not decode as a range without bounds.
  Schema.Struct({
    field: Schema.String,
    above: Schema.optionalKey(Schema.Finite),
    below: Schema.optionalKey(Schema.Finite),
    is: Schema.optionalKey(Schema.Never),
    oneOf: Schema.optionalKey(Schema.Never),
  }),
  Schema.Struct({ version: Schema.Finite }),
  Schema.Struct({ all: Schema.Array(Schema.suspend((): Schema.Codec<WhereSource> => WhereSchema)) }),
  Schema.Struct({ any: Schema.Array(Schema.suspend((): Schema.Codec<WhereSource> => WhereSchema)) }),
  Schema.Struct({ not: Schema.suspend((): Schema.Codec<WhereSource> => WhereSchema) }),
]);

const OutSideSchema = Schema.Literals(["front", "left", "right"]);
const DisposalSchema = Schema.Union([Schema.Literal("drop"), Schema.Struct({ route: Schema.String })]);
const kindBase = { title: Schema.String, doc: Schema.String, glyph: Schema.optionalKey(Schema.String) };

const SourceSchema = Schema.Struct({
  ...kindBase,
  archetype: Schema.Literal("source"),
  emits: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      every: Schema.Number,
      count: Schema.optionalKey(Schema.Number),
      payloads: Schema.Array(
        Schema.Struct({
          weight: Schema.optionalKey(Schema.Number),
          values: Schema.Record(Schema.String, Schema.Union([FieldValueSchema, Schema.Struct({ seq: Schema.String })])),
          version: Schema.optionalKey(Schema.Number),
        }),
      ),
      duplicateChance: Schema.optionalKey(Schema.Number),
    }),
  ),
  whenBlocked: Schema.Literals(["wait", "drop"]),
});

const BrokerSchema = Schema.Struct({
  ...kindBase,
  archetype: Schema.Literal("broker"),
  delivery: Schema.Literals(["competing", "fanout"]),
  capacity: Schema.Number,
  whenFull: Schema.Literals(["block", "drop"]),
});

const MachineSchema = Schema.Struct({
  ...kindBase,
  archetype: Schema.Literal("machine"),
  outputs: Schema.Record(Schema.String, OutSideSchema),
  workers: Schema.Number,
  recipes: Schema.Array(
    Schema.Struct({
      consume: Schema.String,
      where: Schema.optionalKey(WhereSchema),
      ticks: Schema.Number,
      emit: Schema.Array(
        Schema.Union([
          Schema.Struct({ forward: Schema.String }),
          Schema.Struct({
            port: Schema.String,
            produce: Schema.String,
            copy: Schema.optionalKey(Schema.Array(Schema.String)),
            set: Schema.optionalKey(Schema.Record(Schema.String, Schema.UndefinedOr(FieldValueSchema))),
          }),
        ]),
      ),
    }),
  ),
  unmatched: Schema.Union([Schema.Literal("refuse"), DisposalSchema]),
  failures: Schema.Struct({
    maxAttempts: Schema.Number,
    backoff: Schema.optionalKey(Schema.Union([Schema.Struct({ fixed: Schema.Number }), Schema.Struct({ doubling: Schema.Number })])),
    exhausted: DisposalSchema,
  }),
});

const SinkSchema = Schema.Struct({
  ...kindBase,
  archetype: Schema.Literal("sink"),
  accepts: Schema.optionalKey(Schema.Array(Schema.String)),
  ticksPerEvent: Schema.Number,
  role: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("external"), dedupe: Schema.Literals(["none", "idempotencyKey"]) }),
    Schema.Struct({ kind: Schema.Literal("deadLetter") }),
  ]),
});

const LegendSchema = Schema.Record(
  Schema.String,
  Schema.Struct({ kind: Schema.String, facing: Schema.Literals(["north", "east", "south", "west"]), locked: Schema.optionalKey(Schema.Boolean) }),
);

const ScenarioSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  brief: Schema.String,
  seed: Schema.Number,
  maxTicks: Schema.Number,
  map: Schema.Array(Schema.String),
  legend: LegendSchema,
  unlocked: Schema.Array(Schema.String),
  budget: Schema.optionalKey(Schema.Record(Schema.String, Schema.UndefinedOr(Schema.Number))),
  faults: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        kinds: Schema.NonEmptyArray(Schema.String),
        event: Schema.optionalKey(Schema.String),
        where: Schema.optionalKey(WhereSchema),
        chance: Schema.optionalKey(Schema.Number),
        timing: Schema.Literals(["beforeEffect", "afterEffect"]),
      }),
    ),
  ),
  goals: Schema.NonEmptyArray(Schema.Struct({ deliver: Schema.Number, type: Schema.optionalKey(Schema.String), at: Schema.optionalKey(Schema.String) })),
  constraints: Schema.optionalKey(
    Schema.Array(
      Schema.Union([
        Schema.Struct({ kind: Schema.Literal("noLoss") }),
        Schema.Struct({ kind: Schema.Literal("noDuplicateEffects") }),
        Schema.Struct({ kind: Schema.Literal("maxDeadLettered"), n: Schema.Number }),
        Schema.Struct({ kind: Schema.Literal("maxLatency"), ticks: Schema.Number, type: Schema.optionalKey(Schema.String) }),
        Schema.Struct({ kind: Schema.Literal("inOrder"), at: Schema.optionalKey(Schema.String) }),
      ]),
    ),
  ),
  hints: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        text: Schema.String,
        when: Schema.Union([Schema.Struct({ on: Schema.Literals(hintTags), kind: Schema.optionalKey(Schema.String) }), Schema.Struct({ tick: Schema.Number })]),
      }),
    ),
  ),
  solution: Schema.Struct({ map: Schema.Array(Schema.String), legend: LegendSchema }),
  counterexamples: Schema.optionalKey(Schema.Array(Schema.Struct({ why: Schema.String, map: Schema.Array(Schema.String), legend: LegendSchema }))),
});

/**
 * Structural shape of a pack. The cross-reference rules the authoring types
 * express with generics are checked in `resolve`, not here.
 * `authoring.test-d.ts` asserts every `PackDecl` the authoring types accept
 * is assignable to `PackSource`.
 */
export const PackDeclSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  doc: Schema.String,
  catalog: Schema.Struct({
    belt: Schema.Struct({ title: Schema.String, doc: Schema.String, ticksPerTile: Schema.Number }),
    events: Schema.Record(
      Schema.String,
      Schema.Struct({
        doc: Schema.String,
        fields: Schema.Record(Schema.String, FieldTypeSchema),
        key: Schema.optionalKey(Schema.Array(Schema.String)),
        version: Schema.optionalKey(Schema.Number),
        color: Schema.optionalKey(Schema.TemplateLiteral(["#", Schema.String])),
      }),
    ),
    kinds: Schema.Record(Schema.String, Schema.Union([SourceSchema, BrokerSchema, MachineSchema, SinkSchema])),
  }),
  scenarios: Schema.Array(ScenarioSchema),
});

export type PackSource = typeof PackDeclSchema.Type;
type ScenarioSource = PackSource["scenarios"][number];
type LegendSource = ScenarioSource["legend"];

// ---------- entry ----------

export const loadPack: (input: unknown) => Effect.Effect<Pack, PackInvalid> = Effect.fnUntraced(function* (input: unknown) {
  const decl = yield* Schema.decodeUnknownEffect(PackDeclSchema, { errors: "all", reportInput: true })(input).pipe(
    Effect.mapError((error) => invalid(SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues.map((i) => ({ path: formatPath(i.path ?? []), message: i.message })))),
  );
  const issues: PackIssue[] = [];
  const pack = resolve(decl, (path, message) => issues.push({ path, message }));
  if (issues.length > 0) return yield* invalid(issues);
  return pack;
});

function invalid(issues: readonly PackIssue[]): PackInvalid {
  const [first, ...rest] = issues;
  return new PackInvalid({ issues: [first ?? { path: "pack", message: "invalid pack" }, ...rest] });
}

function formatPath(path: readonly (PropertyKey | { readonly key: PropertyKey })[]): string {
  const keys = path.map((segment) => (typeof segment === "object" ? segment.key : segment));
  return keys.reduce<string>((acc, key) => (typeof key === "number" ? `${acc}[${key}]` : acc === "" ? String(key) : `${acc}.${String(key)}`), "") || "pack";
}

// ---------- resolution ----------

type Report = (path: string, message: string) => void;

const beltFacing: Readonly<Record<string, Facing>> = { ">": "east", "<": "west", "^": "north", v: "south" };
const palette: readonly `#${string}`[] = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6", "#ec4899", "#84cc16"];

function describeType(type: FieldType): string {
  return typeof type === "string" ? type : `one of ${type.map((v) => JSON.stringify(v)).join(" | ")}`;
}

function fits(type: FieldType, value: FieldValue): boolean {
  return typeof type === "string" ? typeof value === type : typeof value === "string" && type.includes(value);
}

/** Drops keys whose value is undefined, which partial records over string keys allow. */
function definedEntries<V>(record: { readonly [key: string]: V | undefined }): { readonly [key: string]: V } {
  return Object.fromEntries(Object.entries(record).filter((entry): entry is [string, V] => entry[1] !== undefined));
}

const sameType = (a: FieldType, b: FieldType): boolean => JSON.stringify(a) === JSON.stringify(b);

function integer(report: Report, path: string, value: number, min: number): void {
  if (!Number.isInteger(value) || value < min) report(path, `must be an integer >= ${min}, got ${value}`);
}

function probability(report: Report, path: string, value: number): void {
  if (!(value >= 0 && value <= 1)) report(path, `must be between 0 and 1, got ${value}`);
}

function resolve(decl: PackSource, report: Report): Pack {
  const events = resolveEvents(decl, report);
  const kinds = resolveKinds(decl, events, report);
  integer(report, "catalog.belt.ticksPerTile", decl.catalog.belt.ticksPerTile, 1);

  if (decl.scenarios.length === 0) report("scenarios", "needs at least one scenario");
  const ids = new Set<string>();
  const scenarios = decl.scenarios.map((s, i) => {
    if (ids.has(s.id)) report(`scenarios[${i}].id`, `duplicate scenario id "${s.id}"`);
    ids.add(s.id);
    return resolveScenario(s, `scenarios[${i}]`, events, kinds, report);
  });

  return { [packBrand]: true, id: decl.id, title: decl.title, doc: decl.doc, belt: decl.catalog.belt, events, kinds, scenarios };
}

function resolveEvents(decl: PackSource, report: Report): ReadonlyMap<EventTypeId, EventType> {
  const events = new Map<EventTypeId, EventType>();
  Object.entries(decl.catalog.events).forEach(([name, e], i) => {
    const path = `catalog.events.${name}`;
    if (!eventNamePattern.test(name)) report(path, `event type "${name}" cannot contain ":"`);
    if (name === "any") report(path, `"any" is reserved, because an omitted \`type\` means every event type`);
    const fields = new Map(Object.entries(e.fields));
    (e.key ?? []).forEach((field, k) => {
      if (!fields.has(field)) report(`${path}.key[${k}]`, `${name} has no field "${field}"`);
    });
    if (e.version !== undefined) integer(report, `${path}.version`, e.version, 1);
    const id = EventTypeId(name);
    events.set(id, { id, doc: e.doc, version: e.version ?? 1, fields, key: e.key ?? [], color: e.color ?? palette[i % palette.length] ?? "#888888" });
  });
  return events;
}

// Ids are built into idempotency keys (`Kind#...`, `/Kind.recipe.emit`, `Type:value`), so they exclude the separators next to them.
const eventNamePattern = /^[^:]+$/;
const kindNamePattern = /^[A-Za-z][A-Za-z0-9_-]*$/;

function eventAt(events: ReadonlyMap<EventTypeId, EventType>, report: Report, path: string, name: string): EventType | undefined {
  const event = events.get(EventTypeId(name));
  if (event === undefined) report(path, `unknown event "${name}"`);
  return event;
}

/** `fields` null means the event is unknown (already reported) or unnamed, so field checks are skipped. */
function predicate(report: Report, path: string, where: WhereSource, fields: ReadonlyMap<string, FieldType> | null, eventName: string): Predicate {
  if ("version" in where) {
    integer(report, `${path}.version`, where.version, 1);
    return { kind: "version", version: where.version };
  }
  if ("all" in where) return { kind: "all", of: where.all.map((w, i) => predicate(report, `${path}.all[${i}]`, w, fields, eventName)) };
  if ("any" in where) return { kind: "any", of: where.any.map((w, i) => predicate(report, `${path}.any[${i}]`, w, fields, eventName)) };
  if ("not" in where) return { kind: "not", of: predicate(report, `${path}.not`, where.not, fields, eventName) };

  const type = fields?.get(where.field);
  if (fields !== null && type === undefined) report(`${path}.field`, `${eventName} has no field "${where.field}"`);
  const check = (at: string, value: FieldValue) => {
    if (type !== undefined && !fits(type, value)) report(at, `${JSON.stringify(value)} is not ${describeType(type)}`);
  };
  if ("is" in where) {
    check(`${path}.is`, where.is);
    return { kind: "is", field: where.field, value: where.is };
  }
  if ("oneOf" in where) {
    where.oneOf.forEach((v, i) => check(`${path}.oneOf[${i}]`, v));
    return { kind: "oneOf", field: where.field, values: where.oneOf };
  }
  if (type !== undefined && type !== "number") report(`${path}.field`, `above/below need a number field; "${where.field}" is ${describeType(type)}`);
  if (where.above === undefined && where.below === undefined) report(path, "a field predicate needs is, oneOf, above or below");
  if (where.above !== undefined && where.below !== undefined && where.above >= where.below)
    report(path, `above (${where.above}) must be less than below (${where.below}), or nothing matches`);
  return { kind: "range", field: where.field, ...(where.above === undefined ? {} : { above: where.above }), ...(where.below === undefined ? {} : { below: where.below }) };
}

function resolveKinds(decl: PackSource, events: ReadonlyMap<EventTypeId, EventType>, report: Report): ReadonlyMap<KindId, Kind> {
  const kinds = new Map<KindId, Kind>();
  for (const [name, k] of Object.entries(decl.catalog.kinds)) {
    const path = `catalog.kinds.${name}`;
    if (name === "belt") report(path, `"belt" is reserved for the belt`);
    if (name === "any" || name === "anyExternal") report(path, `"${name}" is reserved, because an omitted \`kind\` or \`at\` means every kind`);
    if (!kindNamePattern.test(name)) report(path, `kind "${name}" must match ${kindNamePattern}`);
    const base = { id: KindId(name), title: k.title, doc: k.doc, glyph: k.glyph ?? (k.title.charAt(0) || name.charAt(0)) };

    switch (k.archetype) {
      case "source": {
        const emits = k.emits.map((stream, i) => {
          const sp = `${path}.emits[${i}]`;
          const event = eventAt(events, report, `${sp}.type`, stream.type);
          integer(report, `${sp}.every`, stream.every, 1);
          if (stream.count !== undefined) integer(report, `${sp}.count`, stream.count, 1);
          if (stream.duplicateChance !== undefined) probability(report, `${sp}.duplicateChance`, stream.duplicateChance);
          if (stream.payloads.length === 0) report(`${sp}.payloads`, "needs at least one payload");
          const payloads = stream.payloads.map((payload, j) => {
            const pp = `${sp}.payloads[${j}]`;
            if (payload.weight !== undefined && !(payload.weight > 0)) report(`${pp}.weight`, `must be > 0, got ${payload.weight}`);
            if (payload.version !== undefined) integer(report, `${pp}.version`, payload.version, 1);
            if (event !== undefined) {
              for (const field of event.fields.keys()) if (!Object.hasOwn(payload.values, field)) report(`${pp}.values`, `missing field "${field}"`);
              for (const [field, value] of Object.entries(payload.values)) {
                const type = event.fields.get(field);
                if (type === undefined) report(`${pp}.values.${field}`, `${stream.type} has no field "${field}"`);
                else if (typeof value === "object" ? type !== "string" : !fits(type, value))
                  report(`${pp}.values.${field}`, `${typeof value === "object" ? "a seq template" : JSON.stringify(value)} is not ${describeType(type)}`);
              }
            }
            return { weight: payload.weight ?? 1, values: payload.values, version: payload.version ?? event?.version ?? 1 };
          });
          const count: number | "endless" = stream.count ?? "endless";
          return { type: EventTypeId(stream.type), every: stream.every, count, payloads, duplicateChance: stream.duplicateChance ?? 0 };
        });
        if (emits.length === 0) report(`${path}.emits`, "needs at least one stream");
        kinds.set(base.id, { ...base, archetype: "source", emits, whenBlocked: k.whenBlocked });
        break;
      }
      case "broker":
        integer(report, `${path}.capacity`, k.capacity, 1);
        kinds.set(base.id, { ...base, archetype: "broker", delivery: k.delivery, capacity: k.capacity, whenFull: k.whenFull });
        break;
      case "machine":
        kinds.set(base.id, resolveMachine(base, k, path, events, report));
        break;
      case "sink": {
        const accepts = k.accepts === undefined ? "all" : new Set(k.accepts.map((t, i) => (eventAt(events, report, `${path}.accepts[${i}]`, t), EventTypeId(t))));
        integer(report, `${path}.ticksPerEvent`, k.ticksPerEvent, 1);
        kinds.set(base.id, { ...base, archetype: "sink", accepts, ticksPerEvent: k.ticksPerEvent, role: k.role });
        break;
      }
    }
  }
  return kinds;
}

type MachineSource = Extract<PackSource["catalog"]["kinds"][string], { readonly archetype: "machine" }>;

function resolveMachine(
  base: Pick<MachineKind, "id" | "title" | "doc" | "glyph">,
  k: MachineSource,
  path: string,
  events: ReadonlyMap<EventTypeId, EventType>,
  report: Report,
): MachineKind {
  const ports = new Map<string, Port>();
  for (const [name, side] of Object.entries(k.outputs)) {
    const clash = [...ports.values()].find((p) => p.side === side);
    if (clash !== undefined) report(`${path}.outputs.${name}`, `side "${side}" is already port "${clash.id}"`);
    ports.set(name, { id: PortId(name), side });
  }
  const portAt = (at: string, name: string): Port => {
    const port = ports.get(name);
    if (port === undefined) report(at, `port "${name}" is not in outputs (${[...ports.keys()].join(", ") || "none"})`);
    return port ?? { id: PortId(name), side: "front" };
  };
  const disposal = (at: string, d: "drop" | { readonly route: string }): Disposal =>
    d === "drop" ? { kind: "drop" } : { kind: "route", port: portAt(`${at}.route`, d.route) };

  integer(report, `${path}.workers`, k.workers, 1);
  const recipes = k.recipes.map((r, i): Recipe => {
    const rp = `${path}.recipes[${i}]`;
    const consumed = eventAt(events, report, `${rp}.consume`, r.consume);
    integer(report, `${rp}.ticks`, r.ticks, 0);
    const emit = r.emit.map((e, j): Emit => {
      const ep = `${rp}.emit[${j}]`;
      if ("forward" in e) return { kind: "forward", port: portAt(`${ep}.forward`, e.forward) };
      const port = portAt(`${ep}.port`, e.port);
      const produced = eventAt(events, report, `${ep}.produce`, e.produce);
      const copy = e.copy ?? [];
      const set = definedEntries(e.set ?? {});
      if (produced !== undefined && consumed !== undefined) {
        copy.forEach((field, c) => {
          const from = consumed.fields.get(field);
          const to = produced.fields.get(field);
          if (from === undefined) report(`${ep}.copy[${c}]`, `${r.consume} has no field "${field}"`);
          else if (to === undefined) report(`${ep}.copy[${c}]`, `${e.produce} has no field "${field}"`);
          else if (!sameType(from, to)) report(`${ep}.copy[${c}]`, `"${field}" is ${describeType(from)} on ${r.consume} but ${describeType(to)} on ${e.produce}`);
        });
        for (const [field, value] of Object.entries(set)) {
          const type = produced.fields.get(field);
          if (type === undefined) report(`${ep}.set.${field}`, `${e.produce} has no field "${field}"`);
          else if (!fits(type, value)) report(`${ep}.set.${field}`, `${JSON.stringify(value)} is not ${describeType(type)}`);
        }
        const missing = [...produced.fields.keys()].filter((f) => !copy.includes(f) && !Object.hasOwn(set, f));
        if (missing.length > 0) report(ep, `${e.produce} needs ${missing.map((f) => `"${f}"`).join(", ")}: add to copy or set`);
      }
      return { kind: "produce", port, type: EventTypeId(e.produce), copy, set };
    });
    const where = r.where === undefined ? null : predicate(report, `${rp}.where`, r.where, consumed?.fields ?? null, r.consume);
    return { index: i, consume: EventTypeId(r.consume), where, ticks: r.ticks, emit };
  });

  const f = k.failures;
  integer(report, `${path}.failures.maxAttempts`, f.maxAttempts, 1);
  const backoff =
    f.backoff === undefined
      ? { kind: "fixed" as const, ticks: 0 }
      : "fixed" in f.backoff
        ? { kind: "fixed" as const, ticks: f.backoff.fixed }
        : { kind: "doubling" as const, ticks: f.backoff.doubling };
  integer(report, `${path}.failures.backoff`, backoff.ticks, 0);

  return {
    ...base,
    archetype: "machine",
    ports: [...ports.values()],
    workers: k.workers,
    recipes,
    unmatched: k.unmatched === "refuse" ? { kind: "refuse" } : disposal(`${path}.unmatched`, k.unmatched),
    failures: { maxAttempts: f.maxAttempts, backoff, exhausted: disposal(`${path}.failures.exhausted`, f.exhausted) },
  };
}

function resolveScenario(
  s: ScenarioSource,
  path: string,
  events: ReadonlyMap<EventTypeId, EventType>,
  kinds: ReadonlyMap<KindId, Kind>,
  report: Report,
): Scenario {
  // rng.ts folds the seed to 32 bits, so a wider seed would repeat another seed's luck.
  if (!Number.isInteger(s.seed) || s.seed < 0 || s.seed > 0xffff_ffff) report(`${path}.seed`, `must be an integer from 0 to 4294967295, got ${s.seed}`);
  integer(report, `${path}.maxTicks`, s.maxTicks, 1);

  const kindAt = (at: string, name: string): Kind | undefined => {
    const kind = kinds.get(KindId(name));
    if (kind === undefined) report(at, `unknown kind "${name}"`);
    return kind;
  };
  const externalSinkAt = (at: string, name: string | undefined): KindId | "anyExternal" => {
    if (name === undefined) return "anyExternal";
    const kind = kindAt(at, name);
    if (kind !== undefined && (kind.archetype !== "sink" || kind.role.kind !== "external")) report(at, `"${name}" is a ${kind.archetype === "sink" ? "dead-letter sink" : kind.archetype}, not an external sink`);
    return KindId(name);
  };
  const eventOrAny = (at: string, name: string | undefined): EventTypeId | "any" => {
    if (name === undefined) return "any";
    eventAt(events, report, at, name);
    return EventTypeId(name);
  };

  // ----- map -----
  const height = s.map.length;
  const width = s.map[0]?.length ?? 0;
  if (height === 0 || width === 0) report(`${path}.map`, "map is empty");
  s.map.forEach((row, y) => {
    if (row.length !== width) report(`${path}.map[${y}]`, `row is ${row.length} wide; row 0 is ${width}`);
  });
  const checkLegend = (at: string, legend: LegendSource) => {
    for (const [char, entry] of Object.entries(legend)) {
      if (char.length !== 1 || char in beltFacing || char === "." || char === "#") report(`${at}.${char}`, `legend keys are single characters other than . # > < ^ v`);
      kindAt(`${at}.${char}.kind`, entry.kind);
    }
  };
  checkLegend(`${path}.legend`, s.legend);

  const terrain: Terrain[] = [];
  const preplaced: Placement[] = [];
  s.map.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const char = row.charAt(x) || ".";
      terrain.push(char === "#" ? "wall" : "floor");
      if (char === "." || char === "#") continue;
      const placement = cellPlacement(char, { x, y }, s.legend, true);
      if (placement === null) report(`${path}.map[${y}]`, `unknown character "${char}" at column ${x}; add it to legend`);
      else preplaced.push(placement);
    }
  });

  // ----- palette -----
  const unlocked = new Set<KindId | "belt">(
    s.unlocked.map((name, i) => {
      if (name === "belt") return "belt";
      kindAt(`${path}.unlocked[${i}]`, name);
      return KindId(name);
    }),
  );
  const budget = new Map<KindId, number>();
  for (const [name, n] of Object.entries(definedEntries(s.budget ?? {}))) {
    kindAt(`${path}.budget.${name}`, name);
    integer(report, `${path}.budget.${name}`, n, 0);
    budget.set(KindId(name), n);
    const onMap = countPlaced(preplaced, KindId(name));
    if (onMap > n) report(`${path}.budget.${name}`, `the map already has ${onMap} unlocked "${name}", over the budget of ${n}`);
  }

  // ----- overlays -----
  const overlay = (at: string, o: { readonly map: readonly string[]; readonly legend: LegendSource }): readonly Placement[] => {
    checkLegend(`${at}.legend`, o.legend);
    if (o.map.length !== height || o.map.some((row) => row.length !== width)) {
      report(`${at}.map`, `overlay must be ${width}x${height} like the map`);
      return [];
    }
    const placements: Placement[] = [];
    o.map.forEach((row, y) => {
      for (let x = 0; x < width; x++) {
        const char = row.charAt(x);
        if (char === ".") continue;
        const placement = cellPlacement(char, { x, y }, o.legend, false);
        if (placement === null) {
          report(`${at}.map[${y}]`, `unknown character "${char}" at column ${x}; add it to legend`);
          continue;
        }
        if (s.map[y]?.charAt(x) !== ".") report(`${at}.map[${y}]`, `column ${x} is not an empty floor cell on the map`);
        const id = placement.build.kind === "belt" ? "belt" : placement.build.id;
        if (!unlocked.has(id)) report(`${at}.map[${y}]`, `"${id}" at column ${x} is not unlocked`);
        placements.push(placement);
        if (placement.build.kind === "building") {
          const limit = budget.get(placement.build.id);
          if (limit !== undefined && countPlaced([...preplaced, ...placements], placement.build.id) > limit)
            report(`${at}.map[${y}]`, `more "${id}" than the budget of ${limit} (unlocked map buildings count too)`);
        }
      }
    });
    return placements;
  };
  const solution = overlay(`${path}.solution`, s.solution);
  const counterexamples = [
    { why: "Bare map: nothing placed.", placements: [] },
    ...(s.counterexamples ?? []).map((c, i) => ({ why: c.why, placements: overlay(`${path}.counterexamples[${i}]`, c) })),
  ];

  // ----- rules -----
  const faults = (s.faults ?? []).map((f, i): Fault => {
    const fp = `${path}.faults[${i}]`;
    const kindIds = new Set(
      f.kinds.map((name, k) => {
        const kind = kindAt(`${fp}.kinds[${k}]`, name);
        if (kind !== undefined && kind.archetype !== "machine") report(`${fp}.kinds[${k}]`, `"${name}" is a ${kind.archetype}; faults apply to machines`);
        return KindId(name);
      }),
    );
    const event = f.event === undefined ? undefined : eventAt(events, report, `${fp}.event`, f.event);
    if (f.where !== undefined && f.event === undefined) report(`${fp}.where`, "a where needs `event` to name the event type it reads");
    if (f.chance !== undefined) probability(report, `${fp}.chance`, f.chance);
    return {
      kinds: kindIds,
      event: f.event === undefined ? "any" : EventTypeId(f.event),
      where: f.where === undefined ? null : predicate(report, `${fp}.where`, f.where, event?.fields ?? null, f.event ?? ""),
      chance: f.chance ?? 1,
      timing: f.timing,
    };
  });

  const [firstGoal, ...restGoals] = s.goals.map((g, i): Goal => {
    integer(report, `${path}.goals[${i}].deliver`, g.deliver, 1);
    return { deliver: g.deliver, type: eventOrAny(`${path}.goals[${i}].type`, g.type), at: externalSinkAt(`${path}.goals[${i}].at`, g.at) };
  });

  const constraints = (s.constraints ?? []).map((c, i): Constraint => {
    const cp = `${path}.constraints[${i}]`;
    switch (c.kind) {
      case "noLoss":
      case "noDuplicateEffects":
        return { kind: c.kind };
      case "maxDeadLettered":
        integer(report, `${cp}.n`, c.n, 0);
        return { kind: c.kind, n: c.n };
      case "maxLatency":
        integer(report, `${cp}.ticks`, c.ticks, 1);
        return { kind: c.kind, ticks: c.ticks, type: eventOrAny(`${cp}.type`, c.type) };
      case "inOrder":
        return { kind: c.kind, at: externalSinkAt(`${cp}.at`, c.at) };
    }
  });

  const hints = (s.hints ?? []).map((h, i): Hint => {
    const when = h.when;
    if ("tick" in when) {
      integer(report, `${path}.hints[${i}].when.tick`, when.tick, 0);
      return { text: h.text, when: { kind: "tick", tick: when.tick } };
    }
    if (when.kind !== undefined) kindAt(`${path}.hints[${i}].when.kind`, when.kind);
    return { text: h.text, when: { kind: "telemetry", on: when.on, kindId: when.kind === undefined ? "any" : KindId(when.kind) } };
  });

  return {
    id: ScenarioId(s.id),
    title: s.title,
    brief: s.brief,
    seed: s.seed,
    maxTicks: s.maxTicks,
    width,
    height,
    terrain,
    preplaced,
    unlocked,
    budget,
    faults,
    goals: firstGoal === undefined ? [{ deliver: 1, type: "any", at: "anyExternal" }] : [firstGoal, ...restGoals],
    constraints,
    hints,
    solution,
    counterexamples,
  };
}

/** A belt character or a legend entry as a placement, or null for an unknown character. */
function cellPlacement(char: string, at: { readonly x: number; readonly y: number }, legend: LegendSource, fromMap: boolean): Placement | null {
  const facing = beltFacing[char];
  if (facing !== undefined) return { at, facing, build: { kind: "belt" }, locked: fromMap };
  const entry = legend[char];
  if (entry === undefined) return null;
  return { at, facing: entry.facing, build: { kind: "building", id: KindId(entry.kind) }, locked: fromMap && (entry.locked ?? true) };
}
