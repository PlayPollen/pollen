// What a character looks like.
//
// Lives in shared/ rather than the client because appearance is saved with the
// farm — and if co-op ever happens, everyone needs to agree on how to draw
// everyone else. The renderer interprets these; nothing here knows about pixels.
//
// Deliberately few options. A character creator with forty sliders is a worse
// first five minutes than one with four choices you can actually take in.

export interface Appearance {
  skin: number;
  hair: number;
  hairColor: number;
  shirt: number;
  pants: number;
}

/** Indexes into the palettes below, so a save is five small integers. */
export const SKIN_TONES = [0xffd9b3, 0xf0b98a, 0xc68642, 0x8d5524, 0x5c3317] as const;

export const HAIR_STYLES = ["short", "long", "bun", "cap"] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

export const HAIR_COLORS = [0x2b1b12, 0x6b4423, 0xb5651d, 0xd9b382, 0x8e8e8e, 0x7b3fa0] as const;

export const SHIRT_COLORS = [0x4a90d9, 0xd94a4a, 0x4ad97a, 0xd9b34a, 0xa14ad9, 0xe8e2cf] as const;

export const PANTS_COLORS = [0x3b4a6b, 0x5a4632, 0x2f3a24, 0x6b3b4a] as const;

/** Palette sizes, so UI can cycle without importing every array. */
export const APPEARANCE_LIMITS = {
  skin: SKIN_TONES.length,
  hair: HAIR_STYLES.length,
  hairColor: HAIR_COLORS.length,
  shirt: SHIRT_COLORS.length,
  pants: PANTS_COLORS.length,
} as const;

export type AppearanceKey = keyof typeof APPEARANCE_LIMITS;

export function defaultAppearance(): Appearance {
  return { skin: 0, hair: 0, hairColor: 0, shirt: 0, pants: 0 };
}

export function randomAppearance(): Appearance {
  const pick = (n: number) => Math.floor(Math.random() * n);
  return {
    skin: pick(APPEARANCE_LIMITS.skin),
    hair: pick(APPEARANCE_LIMITS.hair),
    hairColor: pick(APPEARANCE_LIMITS.hairColor),
    shirt: pick(APPEARANCE_LIMITS.shirt),
    pants: pick(APPEARANCE_LIMITS.pants),
  };
}

/** Wrap an option index, so cycling past the end comes back around. */
export function cycle(value: number, delta: number, key: AppearanceKey): number {
  const n = APPEARANCE_LIMITS[key];
  return (value + delta + n) % n;
}

/**
 * Clamp a loaded appearance into range. A save written before a palette shrank
 * would otherwise index off the end and render an undefined colour.
 */
export function sanitizeAppearance(a: Partial<Appearance> | undefined): Appearance {
  const base = defaultAppearance();
  if (!a) return base;
  const fix = (v: unknown, key: AppearanceKey) =>
    typeof v === "number" && Number.isFinite(v)
      ? ((Math.floor(v) % APPEARANCE_LIMITS[key]) + APPEARANCE_LIMITS[key]) % APPEARANCE_LIMITS[key]
      : base[key];
  return {
    skin: fix(a.skin, "skin"),
    hair: fix(a.hair, "hair"),
    hairColor: fix(a.hairColor, "hairColor"),
    shirt: fix(a.shirt, "shirt"),
    pants: fix(a.pants, "pants"),
  };
}

export const MAX_NAME_LENGTH = 14;

/** Names are shown to other players eventually, so keep them plain and short. */
export function sanitizeName(raw: string): string {
  const cleaned = raw.replace(/[^\p{L}\p{N} '_-]/gu, "").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, MAX_NAME_LENGTH) || "Farmer";
}
