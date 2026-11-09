import { useSyncExternalStore } from "react"
import type { FxKind } from "./fx"

export type Cue = FxKind | "won" | "lost" | "play" | "pause" | "pick" | "goal"

type Wave = OscillatorType
/** One note: frequency in Hz, start offset and length in seconds, peak gain. */
type Note = readonly [freq: number, at: number, length: number, gain: number, wave?: Wave]

const cues: Record<Cue, readonly Note[] | null> = {
  emitted: null,
  produced: [[520, 0, 0.05, 0.03, "triangle"]],
  delivered: [
    [880, 0, 0.07, 0.07, "triangle"],
    [1320, 0.05, 0.12, 0.06, "triangle"],
  ],
  failed: [
    [196, 0, 0.09, 0.07, "sawtooth"],
    [147, 0.07, 0.14, 0.07, "sawtooth"],
  ],
  retrying: [[330, 0, 0.06, 0.04, "square"]],
  dropped: [
    [220, 0, 0.1, 0.08, "sawtooth"],
    [110, 0.08, 0.25, 0.08, "sawtooth"],
  ],
  deadLettered: [
    [262, 0, 0.1, 0.06, "square"],
    [196, 0.1, 0.2, 0.06, "square"],
  ],
  duplicateApplied: [
    [233, 0, 0.08, 0.08, "sawtooth"],
    [233, 0.12, 0.16, 0.08, "sawtooth"],
  ],
  duplicateIgnored: [
    [660, 0, 0.05, 0.05, "sine"],
    [660, 0.08, 0.05, 0.03, "sine"],
  ],
  outOfOrder: [[277, 0, 0.12, 0.05, "square"]],
  placed: [
    [180, 0, 0.04, 0.09, "square"],
    [360, 0.02, 0.05, 0.05, "triangle"],
  ],
  removed: [[140, 0, 0.07, 0.07, "triangle"]],
  rejected: [[120, 0, 0.1, 0.07, "sawtooth"]],
  pick: [[620, 0, 0.03, 0.04, "triangle"]],
  play: [
    [392, 0, 0.06, 0.05, "triangle"],
    [587, 0.06, 0.1, 0.05, "triangle"],
  ],
  pause: [
    [587, 0, 0.06, 0.05, "triangle"],
    [392, 0.06, 0.1, 0.05, "triangle"],
  ],
  goal: [
    [784, 0, 0.1, 0.07, "triangle"],
    [988, 0.09, 0.1, 0.07, "triangle"],
    [1175, 0.18, 0.2, 0.07, "triangle"],
  ],
  won: [
    [523, 0, 0.14, 0.09, "triangle"],
    [659, 0.12, 0.14, 0.09, "triangle"],
    [784, 0.24, 0.14, 0.09, "triangle"],
    [1047, 0.36, 0.5, 0.1, "triangle"],
    [262, 0.36, 0.5, 0.06, "sine"],
  ],
  lost: [
    [330, 0, 0.2, 0.08, "sawtooth"],
    [262, 0.18, 0.2, 0.08, "sawtooth"],
    [175, 0.36, 0.5, 0.09, "sawtooth"],
  ],
}

/** Shortest gap between two plays of one cue, so 8x speed does not turn into noise. */
const minGapMs = 70
const storageKey = "event-factory:muted"

let context: AudioContext | null = null
let muted = readMuted()
const lastPlayed = new Map<Cue, number>()
const listeners = new Set<() => void>()

function readMuted(): boolean {
  try {
    return localStorage.getItem(storageKey) === "1"
  } catch {
    return false
  }
}

/**
 * Plays a short synthesized cue. The AudioContext is created on first use,
 * which the browser allows only after the player has clicked or pressed a key.
 */
export function play(cue: Cue): void {
  const notes = cues[cue]
  if (muted || notes === null) return
  const now = performance.now()
  if (now - (lastPlayed.get(cue) ?? -Infinity) < minGapMs) return
  lastPlayed.set(cue, now)
  try {
    context ??= new AudioContext()
    if (context.state === "suspended") void context.resume()
    const t0 = context.currentTime
    for (const [freq, at, length, gain, wave = "sine"] of notes) {
      const osc = context.createOscillator()
      const amp = context.createGain()
      osc.type = wave
      osc.frequency.value = freq
      amp.gain.setValueAtTime(0, t0 + at)
      amp.gain.linearRampToValueAtTime(gain, t0 + at + 0.008)
      amp.gain.exponentialRampToValueAtTime(0.0001, t0 + at + length)
      osc.connect(amp).connect(context.destination)
      osc.start(t0 + at)
      osc.stop(t0 + at + length + 0.02)
    }
  } catch {
    // No audio device or autoplay blocked: the game is fully playable silent.
  }
}

export function setMuted(next: boolean): void {
  muted = next
  try {
    localStorage.setItem(storageKey, next ? "1" : "0")
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  for (const notify of listeners) notify()
}

const subscribe = (onChange: () => void) => {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

export const useMuted = (): boolean => useSyncExternalStore(subscribe, () => muted)
