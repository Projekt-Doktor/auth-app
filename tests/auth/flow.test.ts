import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock Prisma so these tests run without a real DB connection
// ---------------------------------------------------------------------------
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    magicLinkToken: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

// ---------------------------------------------------------------------------
// Mock next/headers so session functions work outside the Next.js runtime
// ---------------------------------------------------------------------------
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifyMagicToken, hashToken } from "@/lib/auth/token";
import { issueSession, getSession, clearSession } from "@/lib/auth/session";

// ---------------------------------------------------------------------------
// verifyMagicToken
// ---------------------------------------------------------------------------
describe("verifyMagicToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns not_found when no record exists", async () => {
    vi.mocked(prisma.magicLinkToken.findUnique).mockResolvedValue(null);
    const result = await verifyMagicToken("fake-token");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns used when token has already been consumed", async () => {
    vi.mocked(prisma.magicLinkToken.findUnique).mockResolvedValue({
      id: "1",
      email: "test@example.com",
      tokenHash: hashToken("used-token"),
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: new Date(),
      createdAt: new Date(),
    });
    const result = await verifyMagicToken("used-token");
    expect(result).toEqual({ ok: false, reason: "used" });
  });

  it("returns expired when token is past expiry", async () => {
    vi.mocked(prisma.magicLinkToken.findUnique).mockResolvedValue({
      id: "1",
      email: "test@example.com",
      tokenHash: hashToken("expired-token"),
      expiresAt: new Date(Date.now() - 60_000),
      usedAt: null,
      createdAt: new Date(),
    });
    const result = await verifyMagicToken("expired-token");
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("returns ok and the email for a valid unused token", async () => {
    const rawToken = "valid-token";
    const hash = hashToken(rawToken);

    vi.mocked(prisma.magicLinkToken.findUnique).mockResolvedValue({
      id: "1",
      email: "success@example.com",
      tokenHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      createdAt: new Date(),
    });
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { id: "1", email: "success@example.com", token_hash: hash, expires_at: new Date(), used_at: new Date() },
    ]);

    const result = await verifyMagicToken(rawToken);
    expect(result).toEqual({ ok: true, email: "success@example.com" });
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
  });

  it("returns used when the atomic UPDATE finds 0 rows (lost race)", async () => {
    const rawToken = "raced-token";

    vi.mocked(prisma.magicLinkToken.findUnique).mockResolvedValue({
      id: "2",
      email: "race@example.com",
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      createdAt: new Date(),
    });
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

    const result = await verifyMagicToken(rawToken);
    expect(result).toEqual({ ok: false, reason: "used" });
  });
});

// ---------------------------------------------------------------------------
// session helpers (Next.js — mocked next/headers)
// ---------------------------------------------------------------------------
describe("session helpers", () => {
  const payload = { sub: "user-123", email: "user@example.com" };

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret-long-enough-for-hs256-algorithm";
    process.env.JWT_EXPIRES_IN = "7d";
    vi.clearAllMocks();
  });

  it("issueSession sets an httpOnly cookie", async () => {
    const mockSet = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(cookies).mockResolvedValue({ set: mockSet } as any);

    await issueSession(payload);

    expect(mockSet).toHaveBeenCalledOnce();
    const [name, , opts] = mockSet.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(name).toBe("auth_token");
    expect(opts.httpOnly).toBe(true);
  });

  it("getSession returns null when no cookie is present", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as any);
    expect(await getSession()).toBeNull();
  });

  it("round-trips: issueSession → getSession preserves payload", async () => {
    let storedToken = "";
    const mockSet = vi.fn((_name: string, val: string) => {
      storedToken = val;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(cookies).mockResolvedValue({ set: mockSet } as any);
    await issueSession(payload);

    vi.mocked(cookies).mockResolvedValue({
      get: (_name: string) => ({ value: storedToken }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const parsed = await getSession();

    expect(parsed?.sub).toBe(payload.sub);
    expect(parsed?.email).toBe(payload.email);
  });

  it("clearSession deletes the auth_token cookie", async () => {
    const mockDelete = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(cookies).mockResolvedValue({ delete: mockDelete } as any);

    await clearSession();

    expect(mockDelete).toHaveBeenCalledWith("auth_token");
  });
});
