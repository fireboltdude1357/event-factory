// Example domain pack: an invented order-processing system.
// This one file is the whole port. A company pack replaces it.

import { defineCatalog, definePack } from "@event-factory/engine/author";

const catalog = defineCatalog({
  belt: {
    title: "Kafka partition",
    doc: "Events on a partition arrive in the order they were written. One event per tile.",
    ticksPerTile: 2,
  },

  events: {
    OrderPlaced: {
      doc: "A customer checked out. Published by the storefront. `total` is in cents.",
      fields: { orderId: "string", region: ["us", "eu"], total: "number" },
      color: "#3b82f6",
    },
    PaymentCaptured: {
      doc: "The card processor took the money. The ledger books it.",
      fields: { orderId: "string", total: "number" },
      color: "#22c55e",
    },
    ShipmentRequested: {
      doc: "Fulfillment asked the warehouse to pick and pack an order.",
      fields: { orderId: "string", region: ["us", "eu"] },
      color: "#f59e0b",
    },
  },

  kinds: {
    Storefront: {
      archetype: "source",
      title: "Storefront",
      doc: "The web shop. Publishes `OrderPlaced` when a customer checks out. If the topic is full it waits.",
      glyph: "S",
      emits: [
        {
          type: "OrderPlaced",
          every: 6,
          count: 12,
          payloads: [
            { weight: 3, values: { orderId: { seq: "ord-" }, region: "us", total: 4200 } },
            { weight: 1, values: { orderId: { seq: "ord-" }, region: "eu", total: 1800 } },
          ],
        },
      ],
      whenBlocked: "wait",
    },

    FlakyStorefront: {
      archetype: "source",
      title: "Storefront (at-least-once)",
      doc: "Same shop, but its publisher retries on timeouts, so sometimes the same `OrderPlaced` goes out twice.",
      glyph: "S",
      emits: [
        {
          type: "OrderPlaced",
          every: 5,
          count: 20,
          duplicateChance: 0.1,
          payloads: [{ values: { orderId: { seq: "ord-" }, region: "us", total: 4200 } }],
        },
        // Two orders over the card limit. PaymentService always fails them (see the level's faults).
        { type: "OrderPlaced", every: 45, count: 2, payloads: [{ values: { orderId: { seq: "big-" }, region: "us", total: 12000 } }] },
      ],
      whenBlocked: "wait",
    },

    RegionalStorefront: {
      archetype: "source",
      title: "Storefront (two regions)",
      doc: "The web shop after the EU launch. Publishes `OrderPlaced` for US and EU customers on the same topic.",
      glyph: "S",
      emits: [
        { type: "OrderPlaced", every: 6, count: 8, payloads: [{ values: { orderId: { seq: "us-" }, region: "us", total: 4200 } }] },
        { type: "OrderPlaced", every: 9, count: 4, payloads: [{ values: { orderId: { seq: "eu-" }, region: "eu", total: 1800 } }] },
      ],
      whenBlocked: "wait",
    },

    OrdersQueue: {
      archetype: "broker",
      delivery: "competing",
      title: "orders queue",
      doc: "A work queue. Each order goes to exactly one consumer. Add consumers to go faster.",
      glyph: "Q",
      capacity: 8,
      whenFull: "block",
    },

    OrderEvents: {
      archetype: "broker",
      delivery: "fanout",
      title: "order-events topic",
      doc: "A topic. Every subscriber gets its own copy of every order. Subscribing late means missing earlier orders.",
      glyph: "T",
      capacity: 4,
      whenFull: "block",
    },

    PaymentService: {
      archetype: "machine",
      title: "PaymentService",
      doc: "Charges the card for an order and publishes `PaymentCaptured`. Tries a charge up to 4 times, retrying a failure 3 times, then parks the order on its `dlq` output.",
      glyph: "$",
      outputs: { out: "front", dlq: "right" },
      workers: 1,
      recipes: [
        {
          consume: "OrderPlaced",
          ticks: 6,
          emit: [{ port: "out", produce: "PaymentCaptured", copy: ["orderId", "total"] }],
        },
      ],
      unmatched: "refuse",
      failures: { maxAttempts: 4, backoff: { doubling: 2 }, exhausted: { route: "dlq" } },
    },

    FulfillmentService: {
      archetype: "machine",
      title: "FulfillmentService",
      doc: "Turns an order into a `ShipmentRequested` for the warehouse.",
      glyph: "F",
      outputs: { out: "front" },
      workers: 1,
      recipes: [
        {
          consume: "OrderPlaced",
          ticks: 4,
          emit: [{ port: "out", produce: "ShipmentRequested", copy: ["orderId", "region"] }],
        },
      ],
      unmatched: "refuse",
      failures: { maxAttempts: 1, exhausted: "drop" },
    },

    // A router is a machine whose recipes take no time and only forward.
    RegionRouter: {
      archetype: "machine",
      title: "region router",
      doc: "Sends EU orders left and everything else straight on. Content-based routing on `region`.",
      glyph: "R",
      outputs: { eu: "left", rest: "front" },
      workers: 1,
      recipes: [
        { consume: "OrderPlaced", where: { field: "region", is: "eu" }, ticks: 0, emit: [{ forward: "eu" }] },
        { consume: "OrderPlaced", ticks: 0, emit: [{ forward: "rest" }] },
      ],
      unmatched: "refuse",
      failures: { maxAttempts: 1, exhausted: "drop" },
    },

    Ledger: {
      archetype: "sink",
      title: "General ledger",
      doc: "Books each captured payment. Its API takes an idempotency key, so booking the same payment twice is a no-op.",
      glyph: "L",
      accepts: ["PaymentCaptured"],
      ticksPerEvent: 1,
      role: { kind: "external", dedupe: "idempotencyKey" },
    },

    Warehouse: {
      archetype: "sink",
      title: "Warehouse",
      doc: "Picks and packs. It has no dedupe: a duplicate request ships the order twice.",
      glyph: "W",
      accepts: ["ShipmentRequested"],
      ticksPerEvent: 2,
      role: { kind: "external", dedupe: "none" },
    },

    EUWarehouse: {
      archetype: "sink",
      title: "EU warehouse",
      doc: "Ships EU orders from Rotterdam. It packs whatever arrives, so sending it US orders ships them from the wrong continent.",
      glyph: "E",
      accepts: ["ShipmentRequested"],
      ticksPerEvent: 2,
      role: { kind: "external", dedupe: "none" },
    },

    DeadLetterQueue: {
      archetype: "sink",
      title: "payments DLQ",
      doc: "Where orders go after every retry failed. Someone on call looks at these in the morning.",
      glyph: "D",
      ticksPerEvent: 1,
      role: { kind: "deadLetter" },
    },
  },
});

export default definePack({
  id: "order-processing",
  title: "Order processing",
  doc: "An invented shop: a storefront, payments, fulfillment, and the systems they talk to.",
  catalog,
  scenarios: [
    {
      id: "hello-event",
      title: "Your first event",
      brief: "The storefront publishes `OrderPlaced`. The ledger only books `PaymentCaptured`. Put a PaymentService between them.",
      seed: 1,
      maxTicks: 400,
      map: [
        "............",
        ".S........L.",
        "............",
      ],
      legend: { S: { kind: "Storefront", facing: "east" }, L: { kind: "Ledger", facing: "east" } },
      unlocked: ["belt", "PaymentService"],
      goals: [{ deliver: 12, type: "PaymentCaptured", at: "Ledger" }],
      constraints: [{ kind: "noLoss" }],
      hints: [{ when: { tick: 60 }, text: "Belts carry events one way. Click a building to see what it consumes." }],
      solution: {
        map: [
          "............",
          "..>>>P>>>>..",
          "............",
        ],
        legend: { P: { kind: "PaymentService", facing: "east" } },
      },
    },

    {
      id: "queue-or-topic",
      title: "Two teams, one order",
      brief: "Payments and fulfillment both need every order. A queue gives each order to one consumer. A topic gives it to all of them.",
      seed: 2,
      maxTicks: 600,
      map: [
        "..........L.",
        "............",
        ".S..........",
        "............",
        "..........W.",
      ],
      legend: {
        S: { kind: "Storefront", facing: "east" },
        L: { kind: "Ledger", facing: "east" },
        W: { kind: "Warehouse", facing: "east" },
      },
      unlocked: ["belt", "OrdersQueue", "OrderEvents", "PaymentService", "FulfillmentService"],
      budget: { PaymentService: 1, FulfillmentService: 1 },
      goals: [
        { deliver: 12, type: "PaymentCaptured", at: "Ledger" },
        { deliver: 12, type: "ShipmentRequested", at: "Warehouse" },
      ],
      constraints: [{ kind: "noLoss" }],
      hints: [{ when: { on: "delivered", kind: "Warehouse" }, text: "Count the orders at each end. Did both teams get all twelve?" }],
      solution: {
        map: [
          "...>>P>>>>..",
          "...^........",
          "..>T........",
          "...v........",
          "...>>F>>>>..",
        ],
        legend: {
          T: { kind: "OrderEvents", facing: "east" },
          P: { kind: "PaymentService", facing: "east" },
          F: { kind: "FulfillmentService", facing: "east" },
        },
      },
      counterexamples: [
        {
          why: "A queue splits the orders between payments and fulfillment, so neither gets all twelve.",
          map: [
            "...>>P>>>>..",
            "...^........",
            "..>Q........",
            "...v........",
            "...>>F>>>>..",
          ],
          legend: {
            Q: { kind: "OrdersQueue", facing: "east" },
            P: { kind: "PaymentService", facing: "east" },
            F: { kind: "FulfillmentService", facing: "east" },
          },
        },
      ],
    },

    {
      id: "route-by-region",
      title: "Ship from the right continent",
      brief: "The shop now sells in the EU. EU orders must ship from the EU warehouse and US orders from the US one. Route on the order's `region` field.",
      seed: 5,
      maxTicks: 600,
      map: [
        "...........E.",
        ".............",
        ".S.........W.",
      ],
      legend: {
        S: { kind: "RegionalStorefront", facing: "east" },
        E: { kind: "EUWarehouse", facing: "east" },
        W: { kind: "Warehouse", facing: "east" },
      },
      unlocked: ["belt", "RegionRouter", "OrdersQueue", "FulfillmentService"],
      budget: { RegionRouter: 1, FulfillmentService: 2 },
      goals: [
        { deliver: 4, type: "ShipmentRequested", at: "EUWarehouse" },
        { deliver: 8, type: "ShipmentRequested", at: "Warehouse" },
      ],
      constraints: [{ kind: "noLoss" }],
      hints: [{ when: { on: "delivered", kind: "EUWarehouse" }, text: "Click the router: it reads `region` on each order and picks a side." }],
      solution: {
        map: [
          "..>>>F>>>>>..",
          "..^..........",
          "..R>>F>>>>>..",
        ],
        legend: {
          R: { kind: "RegionRouter", facing: "east" },
          F: { kind: "FulfillmentService", facing: "east" },
        },
      },
      counterexamples: [
        {
          why: "A queue splits orders by which consumer is free, not by region, so each warehouse gets a mix.",
          map: [
            "..>>>F>>>>>..",
            "..^..........",
            "..Q>>F>>>>>..",
          ],
          legend: {
            Q: { kind: "OrdersQueue", facing: "east" },
            F: { kind: "FulfillmentService", facing: "east" },
          },
        },
      ],
    },

    {
      id: "when-payments-fail",
      title: "When payments fail",
      brief: "The card processor times out now and then, and two orders are over the card limit. Lose nothing, and keep the DLQ to the orders that really cannot be charged.",
      seed: 3,
      maxTicks: 900,
      map: [
        "............",
        ".S........L.",
        "............",
        "............",
      ],
      legend: { S: { kind: "FlakyStorefront", facing: "east" }, L: { kind: "Ledger", facing: "east" } },
      unlocked: ["belt", "PaymentService", "DeadLetterQueue"],
      // The first fault whose roll hits applies, so the over-limit rule goes first:
      // an order that can never be charged must not get a lucky afterEffect charge.
      faults: [
        // Over the limit: fails every attempt.
        { kinds: ["PaymentService"], event: "OrderPlaced", where: { field: "total", above: 10000 }, timing: "beforeEffect" },
        // Timeouts before the charge: a retry is safe.
        { kinds: ["PaymentService"], chance: 0.25, timing: "beforeEffect" },
        // Timeouts after the charge: the retry charges again. The ledger's idempotency key saves us.
        { kinds: ["PaymentService"], chance: 0.1, timing: "afterEffect" },
      ],
      goals: [{ deliver: 20, type: "PaymentCaptured", at: "Ledger" }],
      constraints: [{ kind: "noLoss" }, { kind: "noDuplicateEffects" }, { kind: "maxDeadLettered", n: 2 }],
      hints: [
        { when: { on: "stalled", kind: "PaymentService" }, text: "PaymentService has nowhere to put an order it gave up on. What is on its right side?" },
        { when: { on: "duplicateIgnored" }, text: "The ledger saw the same idempotency key twice and booked it once. Click the payment to see both copies." },
      ],
      solution: {
        map: [
          "............",
          "..>>>P>>>>..",
          ".....v......",
          ".....D......",
        ],
        legend: {
          P: { kind: "PaymentService", facing: "east" },
          D: { kind: "DeadLetterQueue", facing: "south" },
        },
      },
      counterexamples: [
        {
          why: "Without a DLQ the first over-limit order sits in PaymentService forever and the line stops.",
          map: [
            "............",
            "..>>>P>>>>..",
            "............",
            "............",
          ],
          legend: { P: { kind: "PaymentService", facing: "east" } },
        },
      ],
    },
  ],
});
