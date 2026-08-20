// Guest identity: a signed token, issued by the server, that proves "I am the
// browser that was given this id" — without any signup.
//
// The problem it solves: `userId` used to arrive as a plain client-supplied
// string that the server took on faith, so anyone who sent someone else's id
// loaded their farm and wallet. Harmless while state was in-memory and
// disposable; account takeover the moment it becomes durable. Hence: fix
// identity BEFORE storage.
//
// This is intentionally NOT a full auth system. It is a bearer credential with
// no expiry and no revocation, which is the correct weight for anonymous guest
// play. When account linking arrives, this becomes one of several ways to prove
// identity rather than the only one.

import { createHmac, randomUUID, timingSafeEqual } from "crypto";

const DEV_SECRET = "pollen-dev-only-insecure-secret";
const SECRET = process.env.POLLEN_TOKEN_SECRET ?? DEV_SECRET;

if (SECRET === DEV_SECRET && process.env.NODE_ENV === "production") {
  // Loud, because a known signing secret means anyone can mint a token for any
  // farm — the exact hole this file exists to close.
  console.error(
    "\n!!! POLLEN_TOKEN_SECRET is unset in production. Guest tokens are forgeable. !!!\n",
  );
}

function sign(userId: string): string {
  return createHmac("sha256", SECRET).update(userId).digest("base64url");
}

export interface GuestCredentials {
  userId: string;
  token: string;
}

/** Mint a brand-new guest identity. The caller stores the token; we store nothing. */
export function issueGuestToken(): GuestCredentials {
  const userId = randomUUID();
  return { userId, token: `${userId}.${sign(userId)}` };
}

/**
 * Recover the userId from a token, or null if the signature doesn't check out.
 *
 * The userId half is deliberately readable — the client needs it to build its
 * farmId for matchmaking. The signature is the part that can't be forged.
 */
export function verifyGuestToken(token: unknown): string | null {
  if (typeof token !== "string") return null;

  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;

  const userId = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = sign(userId);

  // Constant-time compare so the signature can't be recovered byte-by-byte by
  // timing repeated guesses.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? userId : null;
}

/**
 * The matchmaking key for a player's private farm.
 *
 * Derived from the VERIFIED userId, never from anything the client sent —
 * otherwise a crafted farmId would drop an attacker straight into someone
 * else's world regardless of how well their own token checks out.
 */
export function soloFarmId(userId: string): string {
  return `solo:${userId}`;
}

/** True for any farmId that claims to be somebody's private farm. */
export function isSoloFarmId(farmId: unknown): farmId is string {
  return typeof farmId === "string" && farmId.startsWith("solo:");
}
