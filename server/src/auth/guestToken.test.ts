// These tests are the guard on the impersonation hole. Before guest tokens,
// a client could send any userId and load that player's farm and wallet.

import { describe, it, expect } from "vitest";
import {
  issueGuestToken,
  verifyGuestToken,
  soloFarmId,
  isSoloFarmId,
} from "./guestToken.js";

describe("guest tokens", () => {
  it("round-trips a freshly issued token", () => {
    const { userId, token } = issueGuestToken();
    expect(verifyGuestToken(token)).toBe(userId);
  });

  it("issues a distinct identity every time", () => {
    const a = issueGuestToken();
    const b = issueGuestToken();
    expect(a.userId).not.toBe(b.userId);
    expect(a.token).not.toBe(b.token);
  });

  it("rejects a token whose userId was swapped for someone else's", () => {
    // The whole attack: take a valid token, substitute the victim's id.
    const victim = issueGuestToken();
    const attacker = issueGuestToken();
    const signature = attacker.token.slice(attacker.token.lastIndexOf(".") + 1);
    const forged = `${victim.userId}.${signature}`;
    expect(verifyGuestToken(forged)).toBeNull();
  });

  it("rejects an unsigned bare userId", () => {
    const { userId } = issueGuestToken();
    expect(verifyGuestToken(userId)).toBeNull();
  });

  it("rejects tampered signatures", () => {
    const { token } = issueGuestToken();
    expect(verifyGuestToken(token + "x")).toBeNull();
    expect(verifyGuestToken(token.slice(0, -1))).toBeNull();
  });

  it("rejects malformed and non-string input without throwing", () => {
    for (const bad of ["", ".", "abc", "abc.", ".abc", null, undefined, 42, {}]) {
      expect(verifyGuestToken(bad)).toBeNull();
    }
  });
});

describe("solo farm ids", () => {
  it("derives a stable id from a userId", () => {
    expect(soloFarmId("abc")).toBe("solo:abc");
    expect(isSoloFarmId(soloFarmId("abc"))).toBe(true);
  });

  it("recognises any claim to a private farm, so it can be checked", () => {
    expect(isSoloFarmId("solo:someone-else")).toBe(true);
    expect(isSoloFarmId("coop:party-code")).toBe(false);
    expect(isSoloFarmId(undefined)).toBe(false);
  });
});
