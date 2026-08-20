// The RNG lives ONLY on the server. This is the single most important file for
// your "unknown result / reward" design goal, and for anti-cheat.
//
// Why a seeded PRNG instead of Math.random()?
//   1. Reproducibility: given a seed + sequence, you can replay any outcome.
//      Priceless for debugging "why did this player get a rare drop" and for
//      writing deterministic tests (right up your QA alley — you can assert
//      exact yields for a known seed).
//   2. Auditability: if you ever want provably-fair mechanics, a seeded stream
//      you can later reveal is the foundation.
//   3. The client NEVER runs this. It only ever learns the *result* the server
//      already committed. No amount of client tampering changes a roll.

// mulberry32 — tiny, fast, good enough for game rewards (NOT for cryptography).
export function makeRng(seed: number) {
  let s = seed >>> 0;
  return function next(): number {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Roll an integer yield in [min, max] inclusive.
export function rollYield(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

// Roll a "did the rare mutation trigger" boolean.
export function rollRare(rng: () => number, chance: number): boolean {
  return rng() < chance;
}
