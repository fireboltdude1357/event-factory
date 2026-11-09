import { Result } from "effect";
import { describe, expect, it } from "vitest";
import examplePack from "../../../packs/order-processing/pack.js";
import { createSession } from "../src/index.js";
import { ScenarioId } from "../src/ids.js";
import { load } from "./helpers.js";

const pack = load(examplePack);

/** A frames driver the test advances by hand, 100ms per frame. */
function manualFrames() {
  let onFrame: ((now: number) => void) | null = null;
  let now = 0;
  return {
    frames: (callback: (now: number) => void) => {
      onFrame = callback;
      return () => {
        onFrame = null;
      };
    },
    advance(count: number) {
      for (let i = 0; i < count && onFrame !== null; i++) {
        onFrame(now);
        now += 100;
      }
    },
    get running() {
      return onFrame !== null;
    },
  };
}

/**
 * A stand-in for the browser's requestAnimationFrame, installed on globalThis
 * so the session uses its default frame driver. Like the browser, cancelling
 * the frame that is running does nothing.
 */
function browserFrames() {
  let queue = new Map<number, (now: number) => void>();
  let nextId = 1;
  let now = 0;
  const g = globalThis as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
  g.requestAnimationFrame = (callback: (now: number) => void) => {
    queue.set(nextId, callback);
    return nextId++;
  };
  g.cancelAnimationFrame = (id: number) => queue.delete(id);
  return {
    advance(count: number) {
      for (let i = 0; i < count; i++) {
        const due = queue;
        queue = new Map();
        for (const callback of due.values()) callback(now);
        now += 100;
      }
    },
    get pending() {
      return queue.size;
    },
    uninstall() {
      delete g.requestAnimationFrame;
      delete g.cancelAnimationFrame;
    },
  };
}

describe("session", () => {
  it("stops its animation frames when a level finishes, so a reset level stays paused", () => {
    const clock = browserFrames();
    const session = createSession(pack, ScenarioId("hello-event"), { ticksPerSecond: 10 });
    session.loadSolution();
    session.play();
    clock.advance(2000);
    expect(session.getSnapshot().status.kind).toBe("finished");
    expect(clock.pending).toBe(0);

    session.reset();
    clock.advance(50);
    expect(session.getSnapshot().clock).toBe("paused");
    expect(session.frame().tick).toBe(0);
    session.dispose();
    clock.uninstall();
  });

  it("flashes retries and deliveries on the map", () => {
    const session = createSession(pack, ScenarioId("when-payments-fail"));
    session.loadSolution();
    const tags = new Set<string>();
    while (session.getSnapshot().status.kind === "running") {
      session.step();
      for (const f of session.frame().flashes) tags.add(f.tag);
    }
    expect(tags).toContain("retrying");
    expect(tags).toContain("delivered");
    session.dispose();
  });

  it("play advances ticks from the injected clock", () => {
    const clock = manualFrames();
    const session = createSession(pack, ScenarioId("hello-event"), { frames: clock.frames, ticksPerSecond: 10 });
    session.play();
    clock.advance(11);
    expect(session.frame().tick).toBe(10);
    session.dispose();
  });

  it("keeps the snapshot identity while nothing visible changes", () => {
    const clock = manualFrames();
    const session = createSession(pack, ScenarioId("hello-event"), { frames: clock.frames });
    let notified = 0;
    session.subscribe(() => notified++);
    session.play();
    const playing = session.getSnapshot();
    expect(playing.clock).toBe("playing");
    // Bare map: the storefront has nowhere to publish, so nothing the HUD shows changes.
    clock.advance(30);
    expect(session.frame().tick).toBeGreaterThan(20);
    expect(session.getSnapshot()).toBe(playing);
    expect(notified).toBe(1);
    session.dispose();
  });

  it("loadSolution then playing to the end reports won and fires delivered listeners", () => {
    const clock = manualFrames();
    const session = createSession(pack, ScenarioId("hello-event"), { frames: clock.frames });
    const delivered: number[] = [];
    session.on("delivered", (t) => delivered.push(t.event));
    session.loadSolution();
    session.play();
    clock.advance(500);
    const status = session.getSnapshot().status;
    expect(status.kind === "finished" && status.outcome).toEqual({ kind: "won" });
    expect(delivered).toHaveLength(12);
    expect(session.getSnapshot().clock).toBe("paused");
    expect(clock.running).toBe(false);
    session.dispose();
  });
});

describe("a finished run", () => {
  it.each(["won", "lost"] as const)("rejects layout edits once %s", (outcome) => {
    const session = createSession(pack, ScenarioId("hello-event"));
    if (outcome === "won") session.loadSolution();
    while (session.getSnapshot().status.kind === "running") session.step();
    const status = session.getSnapshot().status;
    expect(status.kind === "finished" && status.outcome.kind).toBe(outcome);

    const before = session.frame();
    const belt = before.belts[0]?.at ?? { x: 2, y: 1 };
    const results = [
      session.dispatch({ kind: "remove", at: belt }),
      session.dispatch({ kind: "rotate", at: belt, to: "north" }),
      session.dispatch({ kind: "place", at: { x: 0, y: 0 }, facing: "east", build: { kind: "belt" } }),
    ];
    for (const result of results) expect(Result.isFailure(result) && result.failure.reason).toEqual({ kind: "finished" });
    expect(session.frame()).toEqual(before);
    expect(session.getSnapshot().status).toBe(status);
    session.dispose();
  });
});
