// World palette and the deterministic variation that stops the ground looking
// like graph paper.
//
// The key trick: every "random" detail is derived from the tile's coordinates
// via a hash, never from Math.random(). The ground is redrawn constantly as the
// camera moves, so anything genuinely random would shimmer and crawl.

export const WORLD = {
  grass: [0x4a6b34, 0x52753a, 0x456530, 0x577a3d],
  grassTuft: 0x6b8f4a,
  soil: 0x6b4f37,
  soilDark: 0x5a4230,
  soilWet: 0x4a3626,
  grid: 0x000000,

  stem: 0x4c7a2f,
  leaf: 0x7cb342,
  ripe: 0xffd54a,
  flower: [0xe8a5d8, 0xc77dff, 0xffd166],

  hiveBody: 0xd9a441,
  hiveBand: 0xb5822c,
  hiveRoof: 0x6b4f37,
  hiveHole: 0x3a2a1a,
  honey: 0xffe082,
  hiveRange: 0xffd54a,

  hover: 0xffffff,
  hoverBlocked: 0xff6b6b,
  reach: 0xffffff,
} as const;

/**
 * Stable per-tile hash. Same tile always yields the same value, so grass
 * variation is fixed to the world rather than flickering as you walk.
 */
export function tileHash(x: number, y: number): number {
  let h = (x * 73856093) ^ (y * 19349663);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/** A stable pseudo-random float in [0,1) for a tile, varied by `salt`. */
export function tileNoise(x: number, y: number, salt = 0): number {
  return (tileHash(x + salt * 977, y - salt * 331) % 1000) / 1000;
}
