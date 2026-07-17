import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateRawToken, hashToken } from "@/lib/auth/token";

// We unit-test only the pure functions here.
// DB-dependent functions (createMagicToken, verifyMagicToken) belong in
// integration tests that run against a real or in-memory database.

describe("generateRawToken", () => {
  it("returns a non-empty string", () => {
    const token = generateRawToken();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("produces unique tokens on each call", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateRawToken()));
    expect(tokens.size).toBe(100);
  });

  it("produces URL-safe characters only", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateRawToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("is at least 32 bytes of entropy (43+ base64url chars)", () => {
    // 32 raw bytes → ~43 base64url chars
    expect(generateRawToken().length).toBeGreaterThanOrEqual(43);
  });
});

describe("hashToken", () => {
  it("returns a 64-char hex string (SHA-256)", () => {
    const hash = hashToken("some-token");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("is deterministic for the same input", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  it("produces different hashes for different inputs", () => {
    expect(hashToken("token-a")).not.toBe(hashToken("token-b"));
  });

  it("does not return the raw input", () => {
    const raw = "my-secret-token";
    expect(hashToken(raw)).not.toBe(raw);
  });
});
