// Draws a character into canvas textures at runtime.
//
// No third-party art: every pixel here is generated from the player's chosen
// palette indices. That keeps the asset-licensing story clean (see
// assets/CREDITS.md) while giving something that actually reads as a person
// instead of a blue rectangle.
//
// Three facings are generated — down, up, side — and one horizontal direction is
// the other mirrored, which halves the drawing work for no visible difference at
// this fidelity.
//
// IMPORTANT: the `side` sprite is drawn facing RIGHT (eye and nose sit right of
// centre). Use SIDE_FACES_RIGHT rather than assuming, so the flip can't get
// inverted again.

import Phaser from "phaser";
import {
  HAIR_COLORS,
  HAIR_STYLES,
  PANTS_COLORS,
  SHIRT_COLORS,
  SKIN_TONES,
  type Appearance,
} from "@pollen/shared";

export const CHAR_W = 20;
export const CHAR_H = 30;

export type Facing = "down" | "up" | "side";

/**
 * Which way the un-flipped `side` sprite looks. Exported so callers derive the
 * flip from the art instead of hard-coding an assumption about it — getting this
 * backwards puts the eye on the back of the character's head.
 */
export const SIDE_FACES_RIGHT = true;

/** Should the `side` sprite be mirrored to face the given direction? */
export function shouldFlipSide(facingRight: boolean): boolean {
  return facingRight !== SIDE_FACES_RIGHT;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

/** Slightly darker shade, for outlines and shadowed panels. */
function shade(color: number, amount = 0.72): string {
  const r = Math.round(((color >> 16) & 0xff) * amount);
  const g = Math.round(((color >> 8) & 0xff) * amount);
  const b = Math.round((color & 0xff) * amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** A stable key per appearance, so identical looks reuse one texture. */
export function appearanceKey(a: Appearance, facing: Facing, step: 0 | 1): string {
  return `char:${a.skin}.${a.hair}.${a.hairColor}.${a.shirt}.${a.pants}:${facing}:${step}`;
}

function drawCharacter(
  ctx: CanvasRenderingContext2D,
  a: Appearance,
  facing: Facing,
  step: 0 | 1,
) {
  const skin = hex(SKIN_TONES[a.skin]);
  const hair = hex(HAIR_COLORS[a.hairColor]);
  const shirt = hex(SHIRT_COLORS[a.shirt]);
  const pants = hex(PANTS_COLORS[a.pants]);
  const style = HAIR_STYLES[a.hair];

  const px = (x: number, y: number, w: number, h: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  };

  // Ground shadow — the cheapest cue that the character is standing ON something
  // rather than floating above it.
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(CHAR_W / 2, CHAR_H - 1.5, 6, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs. The two frames swap which leg leads, which reads as walking once the
  // sprite is also bobbing.
  const legLead = step === 0 ? 0 : 1;
  px(6, 21, 3, 6 - legLead, pants);
  px(11, 21, 3, 6 - (1 - legLead), pants);
  px(6, 27 - legLead, 3, 2, "#2a2118"); // boots
  px(11, 27 - (1 - legLead), 3, 2, "#2a2118");

  // Torso
  px(5, 12, 10, 9, shirt);
  px(5, 19, 10, 2, shade(SHIRT_COLORS[a.shirt])); // hem shading

  // Arms
  if (facing === "side") {
    px(9, 13, 3, 6, shade(SHIRT_COLORS[a.shirt], 0.85));
    px(9, 19, 3, 2, skin); // hand
  } else {
    px(3, 13, 2, 6, shirt);
    px(15, 13, 2, 6, shirt);
    px(3, 19, 2, 2, skin);
    px(15, 19, 2, 2, skin);
  }

  // Head
  px(5, 3, 10, 10, skin);

  // Face — only when facing the camera. Facing away deliberately has no face,
  // which is what sells the turn at this resolution.
  if (facing === "down") {
    px(7, 7, 2, 2, "#2a2118");
    px(11, 7, 2, 2, "#2a2118");
    px(9, 10, 2, 1, shade(SKIN_TONES[a.skin], 0.8));
  } else if (facing === "side") {
    // Drawn looking RIGHT — see SIDE_FACES_RIGHT.
    px(12, 7, 2, 2, "#2a2118");
    px(14, 9, 1, 2, skin); // nose
  }

  // Hair, drawn over the head so styles can frame the face.
  switch (style) {
    case "short":
      px(5, 2, 10, 3, hair);
      px(4, 4, 2, 3, hair);
      px(14, 4, 2, 3, hair);
      break;
    case "long":
      px(5, 2, 10, 3, hair);
      px(3, 4, 3, 11, hair);
      px(14, 4, 3, 11, hair);
      break;
    case "bun":
      px(5, 2, 10, 3, hair);
      px(4, 4, 2, 2, hair);
      px(14, 4, 2, 2, hair);
      px(8, 0, 4, 3, hair); // the bun itself
      break;
    case "cap":
      px(4, 1, 12, 4, hair);
      px(3, 4, 14, 1, shade(HAIR_COLORS[a.hairColor], 0.6)); // brim
      break;
  }

  if (facing === "up") {
    // Back of the head is all hair, so the style still reads from behind.
    px(5, 3, 10, 6, hair);
  }
}

/**
 * Ensure textures exist for this appearance, returning the key prefix.
 * Safe to call repeatedly — existing textures are reused.
 */
export function ensureCharacterTextures(scene: Phaser.Scene, a: Appearance) {
  const facings: Facing[] = ["down", "up", "side"];
  for (const facing of facings) {
    for (const step of [0, 1] as const) {
      const key = appearanceKey(a, facing, step);
      if (scene.textures.exists(key)) continue;

      const canvas = scene.textures.createCanvas(key, CHAR_W, CHAR_H);
      if (!canvas) continue;
      const ctx = canvas.getContext();
      ctx.clearRect(0, 0, CHAR_W, CHAR_H);
      ctx.imageSmoothingEnabled = false;
      drawCharacter(ctx, a, facing, step);
      canvas.refresh();
    }
  }
}

/**
 * Drop textures for an appearance. The character creator regenerates on every
 * change, so without this each click would leak a texture.
 */
export function releaseCharacterTextures(scene: Phaser.Scene, a: Appearance) {
  for (const facing of ["down", "up", "side"] as Facing[]) {
    for (const step of [0, 1] as const) {
      const key = appearanceKey(a, facing, step);
      if (scene.textures.exists(key)) scene.textures.remove(key);
    }
  }
}
