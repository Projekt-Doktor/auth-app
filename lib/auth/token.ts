import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const TOKEN_EXPIRY_MINUTES = 15;
const TOKEN_BYTES = 32;

export function generateRawToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Constant-time comparison to prevent timing attacks */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function createMagicToken(email: string): Promise<string> {
  // Invalidate any previous unused tokens for this email
  await prisma.magicLinkToken.updateMany({
    where: { email, usedAt: null, expiresAt: { gt: new Date() } },
    data: { expiresAt: new Date() }, // expire them immediately
  });

  const raw = generateRawToken();
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000);

  await prisma.magicLinkToken.create({
    data: { email, tokenHash, expiresAt },
  });

  return raw;
}

export type VerifyResult =
  | { ok: true; email: string }
  | { ok: false; reason: "not_found" | "expired" | "used" };

type TokenRow = { id: string; email: string; token_hash: string; expires_at: Date; used_at: Date | null };

export async function verifyMagicToken(raw: string): Promise<VerifyResult> {
  const tokenHash = hashToken(raw);

  const record = await prisma.magicLinkToken.findUnique({
    where: { tokenHash },
  });

  if (!record) return { ok: false, reason: "not_found" };
  if (record.usedAt !== null) return { ok: false, reason: "used" };
  if (record.expiresAt < new Date()) return { ok: false, reason: "expired" };

  // Atomically consume the token
  const rows = await prisma.$queryRaw<TokenRow[]>`
    UPDATE magic_link_tokens
    SET    used_at = NOW()
    WHERE  token_hash = ${tokenHash}
      AND  used_at IS NULL
      AND  expires_at > NOW()
    RETURNING id, email, token_hash, expires_at, used_at
  `;

  if (rows.length === 0) {
    return { ok: false, reason: "used" };
  }

  if (!safeEqual(rows[0].token_hash, tokenHash)) {
    return { ok: false, reason: "not_found" };
  }

  return { ok: true, email: rows[0].email };
}
