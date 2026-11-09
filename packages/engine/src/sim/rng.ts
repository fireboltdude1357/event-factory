// Counter-based randomness. There is no RNG state anywhere in the sim. Each
// roll is a hash of the scenario seed and the identity of the thing being
// decided, e.g. (seed, "fault", 2, idempotencyKey, attempt). No part names a
// position or an entity id.
//
// Consequence: whether order #17 fails on its second payment attempt does
// not depend on where the player put their buildings or how many others they
// placed. The reference solution and the player's layout see the same luck,
// so a level calibrated by pack:check stays fair for every layout.
//
// The loader limits seeds to 0..2^32-1, so `seed | 0` is one-to-one and
// every seed rolls different luck.

/** Uniform in [0, 1). */
export function roll(seed: number, ...parts: readonly (string | number)[]): number {
  let hash = 0x811c9dc5;
  const text = parts.join("\u0001");
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  let z = (hash ^ Math.imul(seed | 0, 0x9e3779b9)) + 0x9e3779b9;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  z ^= z >>> 16;
  return (z >>> 0) / 0x1_0000_0000;
}

export function pickWeighted<T>(r: number, items: readonly [{ readonly weight: number; readonly value: T }, ...{ readonly weight: number; readonly value: T }[]]): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let target = r * total;
  for (const item of items) {
    target -= item.weight;
    if (target < 0) return item.value;
  }
  return items[items.length - 1]?.value ?? items[0].value;
}
