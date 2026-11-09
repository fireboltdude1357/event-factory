import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { loadPack, type PackIssue } from "../src/index.js";

const issuesOf = (input: unknown): readonly PackIssue[] => {
  const exit = Effect.runSyncExit(Effect.flip(loadPack(input)));
  if (Exit.isFailure(exit)) throw new Error("pack loaded, expected PackInvalid");
  return exit.value.issues;
};

// Written as plain data, the way a JSON or untyped pack arrives. The authoring types would reject it.
const broken = {
  id: "broken",
  title: "",
  doc: "",
  catalog: {
    belt: { title: "belt", doc: "", ticksPerTile: 2 },
    events: {
      A: { doc: "", fields: { id: "string", n: "number" } },
      B: { doc: "", fields: { id: "string", n: "string" } },
    },
    kinds: {
      Src: { archetype: "source", title: "", doc: "", whenBlocked: "wait", emits: [{ type: "A", every: 1, payloads: [{ values: { id: "x", n: 1 } }] }] },
      M: {
        archetype: "machine",
        title: "",
        doc: "",
        workers: 1,
        outputs: { out: "front" },
        unmatched: "refuse",
        failures: { maxAttempts: 1, exhausted: "drop" },
        recipes: [
          { consume: "Nope", ticks: 1, emit: [{ forward: "out" }] },
          { consume: "A", ticks: 1, emit: [{ forward: "dlq" }, { port: "out", produce: "B", copy: ["id", "n"] }] },
        ],
      },
      Out: { archetype: "sink", title: "", doc: "", ticksPerEvent: 1, role: { kind: "external", dedupe: "none" } },
    },
  },
  scenarios: [
    {
      id: "l",
      title: "",
      brief: "",
      seed: 1,
      maxTicks: 10,
      map: [".S.O.", ".?.."],
      legend: { S: { kind: "Src", facing: "east" }, O: { kind: "Out", facing: "east" } },
      unlocked: ["belt"],
      goals: [{ deliver: 1, at: "M" }],
      solution: { map: ["..>..", "....."], legend: {} },
    },
  ],
};

describe("loadPack", () => {
  it("reports every broken reference at once, each at its path", () => {
    const issues = issuesOf(broken);
    const at = (path: string) => issues.filter((i) => i.path === path).map((i) => i.message);
    expect(at("catalog.kinds.M.recipes[0].consume")).toEqual(['unknown event "Nope"']);
    expect(at("catalog.kinds.M.recipes[1].emit[0].forward")).toEqual(['port "dlq" is not in outputs (out)']);
    expect(at("catalog.kinds.M.recipes[1].emit[1].copy[1]")).toEqual(['"n" is number on A but string on B']);
    expect(at("scenarios[0].map[1]")).toEqual(expect.arrayContaining(["row is 4 wide; row 0 is 5", expect.stringContaining('unknown character "?"')]));
    expect(at("scenarios[0].goals[0].at")).toEqual(['"M" is a machine, not an external sink']);
  });

  it("reports every structural problem at once, and references only once the structure is valid", () => {
    const issues = issuesOf({
      ...broken,
      catalog: { ...broken.catalog, belt: { title: "belt", doc: "", ticksPerTile: "fast" } },
      scenarios: [{ ...broken.scenarios[0], seed: "one" }],
    });
    expect(issues).toEqual([
      { path: "catalog.belt.ticksPerTile", message: "Expected number, got \"fast\"" },
      { path: "scenarios[0].seed", message: "Expected number, got \"one\"" },
    ]);
  });

  it("counts unlocked map buildings against the budget, as the engine does", () => {
    const decl = {
      ...broken,
      catalog: { ...broken.catalog, kinds: { Src: broken.catalog.kinds.Src, Out: broken.catalog.kinds.Out } },
      scenarios: [
        {
          ...broken.scenarios[0],
          map: [".S..O."],
          legend: { S: { kind: "Src", facing: "east" }, O: { kind: "Out", facing: "east", locked: false } },
          unlocked: ["belt", "Out"],
          budget: { Out: 1 },
          goals: [{ deliver: 1 }],
          solution: { map: ["..>O.."], legend: { O: { kind: "Out", facing: "east" } } },
        },
      ],
    };
    expect(issuesOf(decl)).toEqual([{ path: "scenarios[0].solution.map[0]", message: 'more "Out" than the budget of 1 (unlocked map buildings count too)' }]);
  });

  it("rejects hints on run records that never fire one", () => {
    const hints = ["objectiveProgress", "hint", "finished", "stalled"].map((on) => ({ text: "", when: { on } }));
    const issues = issuesOf({ ...broken, scenarios: [{ ...broken.scenarios[0], hints }] });
    expect(issues.filter((i) => i.path.startsWith("scenarios[0].hints")).map((i) => i.path)).toEqual([
      "scenarios[0].hints[0].when.on",
      "scenarios[0].hints[0].when.tick",
      "scenarios[0].hints[1].when.on",
      "scenarios[0].hints[1].when.tick",
      "scenarios[0].hints[2].when.on",
      "scenarios[0].hints[2].when.tick",
    ]);
  });

  it("limits seeds to 32-bit unsigned integers, which roll distinct luck", () => {
    const seedIssues = (seed: number) =>
      issuesOf({ ...broken, scenarios: [{ ...broken.scenarios[0], seed }] }).filter((i) => i.path === "scenarios[0].seed");
    expect(seedIssues(2 ** 32 + 7)).toEqual([{ path: "scenarios[0].seed", message: "must be an integer from 0 to 4294967295, got 4294967303" }]);
    expect(seedIssues(-1)).toHaveLength(1);
    expect(seedIssues(2 ** 32 - 1)).toEqual([]);
  });

  it("checks the map's own unlocked buildings against the budget", () => {
    const decl = {
      ...broken,
      catalog: { ...broken.catalog, kinds: { Src: broken.catalog.kinds.Src, Out: broken.catalog.kinds.Out } },
      scenarios: [
        {
          ...broken.scenarios[0],
          map: [".S..OO"],
          legend: { S: { kind: "Src", facing: "east" }, O: { kind: "Out", facing: "east", locked: false } },
          unlocked: ["belt", "Out"],
          budget: { Out: 1 },
          goals: [{ deliver: 1 }],
          solution: { map: ["..>..."], legend: {} },
        },
      ],
    };
    expect(issuesOf(decl)).toEqual([{ path: "scenarios[0].budget.Out", message: 'the map already has 2 unlocked "Out", over the budget of 1' }]);
  });

  it("rejects names that would break idempotency keys", () => {
    const issues = issuesOf({
      ...broken,
      catalog: {
        ...broken.catalog,
        events: { ...broken.catalog.events, "bad:type": { doc: "", fields: { id: "string" } } },
        kinds: { ...broken.catalog.kinds, "Billing.0.0/Shipping": broken.catalog.kinds.Out },
      },
    });
    const paths = issues.map((i) => i.path);
    expect(paths).toContain("catalog.events.bad:type");
    expect(paths).toContain("catalog.kinds.Billing.0.0/Shipping");
  });

  it("rejects a pack with no scenarios", () => {
    expect(issuesOf({ ...broken, scenarios: [] })).toContainEqual({ path: "scenarios", message: "needs at least one scenario" });
  });

  it("reserves the names that mean every event type or every sink", () => {
    const issues = issuesOf({
      ...broken,
      catalog: {
        ...broken.catalog,
        events: { ...broken.catalog.events, any: { doc: "", fields: { id: "string" } } },
        kinds: { ...broken.catalog.kinds, any: broken.catalog.kinds.Out, anyExternal: broken.catalog.kinds.Out },
      },
    });
    const paths = issues.map((i) => i.path);
    expect(paths).toContain("catalog.events.any");
    expect(paths).toContain("catalog.kinds.any");
    expect(paths).toContain("catalog.kinds.anyExternal");
  });

  it("reports a missing field even when its name is an Object.prototype member", () => {
    const issues = issuesOf({
      ...broken,
      catalog: {
        ...broken.catalog,
        events: { Foo: { doc: "", fields: { constructor: "string" } } },
        kinds: {
          Src: { ...broken.catalog.kinds.Src, emits: [{ type: "Foo", every: 1, payloads: [{ values: {} }] }] },
          M: { ...broken.catalog.kinds.M, recipes: [{ consume: "Foo", ticks: 1, emit: [{ port: "out", produce: "Foo" }] }] },
          Out: broken.catalog.kinds.Out,
        },
      },
    });
    expect(issues).toEqual(
      expect.arrayContaining([
        { path: "catalog.kinds.Src.emits[0].payloads[0].values", message: 'missing field "constructor"' },
        { path: "catalog.kinds.M.recipes[0].emit[0]", message: 'Foo needs "constructor": add to copy or set' },
      ]),
    );
  });

  it("accepts event type names in the styles real buses use", () => {
    const names = ["OrderPlaced", "orders.v1.placed", "Order Placed", "order-placed"];
    const issues = issuesOf({
      ...broken,
      catalog: { ...broken.catalog, events: { ...broken.catalog.events, ...Object.fromEntries(names.map((n) => [n, { doc: "", fields: { id: "string" } }])) } },
    });
    expect(issues.filter((i) => names.some((n) => i.path === `catalog.events.${n}`))).toEqual([]);
  });

  it("rejects range predicates that cannot match", () => {
    const where = (w: object) => ({ consume: "A", where: w, ticks: 1, emit: [{ forward: "out" }] });
    const issuesWith = (w: object) =>
      issuesOf({ ...broken, catalog: { ...broken.catalog, kinds: { ...broken.catalog.kinds, M: { ...broken.catalog.kinds.M, recipes: [where(w)] } } } });
    expect(issuesWith({ field: "n", above: NaN }).some((i) => i.path.startsWith("catalog.kinds.M.recipes[0].where"))).toBe(true);
    expect(issuesWith({ field: "n" })).toContainEqual({ path: "catalog.kinds.M.recipes[0].where", message: "a field predicate needs is, oneOf, above or below" });
  });

  it("rejects a bad bound or value instead of reading the predicate as another form", () => {
    const where = (w: object) => ({ consume: "A", where: w, ticks: 1, emit: [{ forward: "out" }] });
    const issues = issuesOf({
      ...broken,
      catalog: {
        ...broken.catalog,
        kinds: { ...broken.catalog.kinds, M: { ...broken.catalog.kinds.M, recipes: [where({ field: "n", above: NaN, below: 10 }), where({ field: "n", is: NaN })] } },
      },
    });
    expect(issues.some((i) => i.path.startsWith("catalog.kinds.M.recipes[0].where"))).toBe(true);
    expect(issues).toContainEqual({ path: "catalog.kinds.M.recipes[1].where.is", message: "Expected a finite number, got NaN" });
  });

  it("rejects ranges with no room between their bounds and versions that are not whole", () => {
    const where = (w: object) => ({ consume: "A", where: w, ticks: 1, emit: [{ forward: "out" }] });
    const recipes = [where({ field: "n", above: 100, below: 50 }), where({ field: "n", above: 5, below: 5 }), where({ version: 1.5 }), where({ field: "n", above: 1, below: 9 })];
    const issues = issuesOf({ ...broken, catalog: { ...broken.catalog, kinds: { ...broken.catalog.kinds, M: { ...broken.catalog.kinds.M, recipes } } } });
    const at = (i: number) => issues.filter((issue) => issue.path.startsWith(`catalog.kinds.M.recipes[${i}].where`)).map((issue) => issue.message);
    expect(at(0)).toEqual(["above (100) must be less than below (50), or nothing matches"]);
    expect(at(1)).toEqual(["above (5) must be less than below (5), or nothing matches"]);
    expect(at(2)).toEqual(["must be an integer >= 1, got 1.5"]);
    expect(at(3)).toEqual([]);
  });

  it("rejects payload numbers that are not finite", () => {
    const issues = issuesOf({
      ...broken,
      catalog: {
        ...broken.catalog,
        kinds: { ...broken.catalog.kinds, Src: { ...broken.catalog.kinds.Src, emits: [{ type: "A", every: 1, payloads: [{ values: { id: "x", n: Infinity } }] }] } },
      },
    });
    expect(issues.some((i) => i.path.startsWith("catalog.kinds.Src.emits[0].payloads[0].values.n"))).toBe(true);
  });
});
