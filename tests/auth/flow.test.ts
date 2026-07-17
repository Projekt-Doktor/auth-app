import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// Mock Prisma so these tests run without a real DB connection
// ---------------------------------------------------------------------------
vi.mock("../../src/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    magicLinkToken: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { prisma } from "../../src/lib/prisma";
import { verifyMagicToken, hashToken } from "../../src/lib/auth/token";
import { parseSession, issueSession, clearSession } from "../../src/lib/auth/session";
import { requireAuth } from "../../src/middleware/requireAuth";

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
      expiresAt: new Date(Date.now() - 60_000), // in the past
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
    // Simulate the atomic UPDATE … RETURNING row
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
    // Another request won the race — UPDATE returns 0 rows
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

    const result = await verifyMagicToken(rawToken);
    expect(result).toEqual({ ok: false, reason: "used" });
  });
});

// ---------------------------------------------------------------------------
// session helpers
// ---------------------------------------------------------------------------
describe("session helpers", () => {
  const payload = { sub: "user-123", email: "user@example.com" };

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret-long-enough-for-hs256-algorithm";
    process.env.JWT_EXPIRES_IN = "7d";
  });

  it("issueSession sets an httpOnly cookie", () => {
    const cookies: Record<string, unknown> = {};
    const res = {
      cookie: (name: string, val: string, opts: object) => {
        cookies[name] = { val, opts };
      },
    } as unknown as Response;

    issueSession(res, payload);
    expect(cookies["auth_token"]).toBeDefined();
    expect((cookies["auth_token"] as { opts: { httpOnly: boolean } }).opts.httpOnly).toBe(true);
  });

  it("parseSession returns null when no cookie is present", () => {
    const req = { cookies: {} } as Request;
    expect(parseSession(req)).toBeNull();
  });

  it("round-trips: issueSession → parseSession", () => {
    let cookieValue = "";
    const res = {
      cookie: (_name: string, val: string) => {
        cookieValue = val;
      },
    } as unknown as Response;

    issueSession(res, payload);

    const req = { cookies: { auth_token: cookieValue } } as unknown as Request;
    const parsed = parseSession(req);
    expect(parsed?.sub).toBe(payload.sub);
    expect(parsed?.email).toBe(payload.email);
  });
});

// ---------------------------------------------------------------------------
// requireAuth middleware
// ---------------------------------------------------------------------------
describe("requireAuth middleware", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret-long-enough-for-hs256-algorithm";
  });

  function makeRes() {
    const locals: Record<string, unknown> = {};
    const body: { status?: number; json?: unknown } = {};
    return {
      locals,
      status(code: number) {
        body.status = code;
        return this;
      },
      json(data: unknown) {
        body.json = data;
        return this;
      },
      _body: body,
    };
  }

  it("rejects requests without a cookie with 401", () => {
    const req = { cookies: {} } as Request;
    const res = makeRes() as unknown as Response;
    const next = vi.fn();

    requireAuth(req, res, next as NextFunction);

    expect((res as unknown as ReturnType<typeof makeRes>)._body.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() and attaches session for a valid cookie", () => {
    // Build a valid token
    let cookieValue = "";
    const fakeRes = {
      cookie: (_: string, val: string) => { cookieValue = val; },
    } as unknown as Response;
    issueSession(fakeRes, { sub: "u1", email: "ok@example.com" });

    const req = { cookies: { auth_token: cookieValue } } as unknown as Request;
    const res = makeRes() as unknown as Response;
    const next = vi.fn();

    requireAuth(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect((res as unknown as ReturnType<typeof makeRes>).locals.session).toMatchObject({
      sub: "u1",
      email: "ok@example.com",
    });
  });
});
