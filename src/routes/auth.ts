import { Router } from "express";
import { z } from "zod";
import { createMagicToken, verifyMagicToken } from "../lib/auth/token";
import { issueSession, clearSession } from "../lib/auth/session";
import { sendMagicLink } from "../lib/auth/email";
import { prisma } from "../lib/prisma";
import { magicLinkRateLimit } from "../lib/rateLimiter";
import { requireAuth } from "../middleware/requireAuth";
import type { SessionPayload } from "../lib/auth/session";

const router = Router();

const emailSchema = z.object({
  email: z.string().email("Invalid email address"),
});

/**
 * POST /auth/magic-link
 * Request a magic link for the given email address.
 */
router.post("/magic-link", magicLinkRateLimit, async (req, res) => {
  const parsed = emailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const { email } = parsed.data;

  try {
    const rawToken = await createMagicToken(email);
    await sendMagicLink(email, rawToken);

    // Always respond with success — never reveal whether the email exists
    res.status(200).json({ message: "If that address is valid, a sign-in link is on its way." });
  } catch (err) {
    console.error("[magic-link] error:", err);
    res.status(500).json({ error: "Failed to send magic link. Please try again." });
  }
});

/**
 * GET /auth/verify?token=<raw>
 * Consume the magic link token and issue a session.
 */
router.get("/verify", async (req, res) => {
  const raw = typeof req.query.token === "string" ? req.query.token : null;

  if (!raw) {
    res.status(400).json({ error: "Missing token" });
    return;
  }

  let result;
  try {
    result = await verifyMagicToken(raw);
  } catch (err) {
    console.error("[verify] error:", err);
    res.status(500).json({ error: "Internal error. Please request a new link." });
    return;
  }

  if (!result.ok) {
    // "used" gets its own message (helpful UX); not_found and expired are
    // collapsed into a single message to avoid leaking token-existence info.
    const message =
      result.reason === "used"
        ? "This link has already been used. Please request a new one."
        : "Invalid or expired link. Please request a new one.";
    res.status(400).json({ error: message });
    return;
  }

  // Upsert the user record
  const user = await prisma.user.upsert({
    where: { email: result.email },
    create: { email: result.email },
    update: {},
  });

  issueSession(res, { sub: user.id, email: user.email });

  // In a browser flow you would redirect; for an API, return JSON
  const appUrl = process.env.APP_URL ?? "/";
  res.redirect(`${appUrl}/dashboard`);
});

/**
 * POST /auth/logout
 * Clear the session cookie.
 */
router.post("/logout", requireAuth, (_req, res) => {
  clearSession(res);
  res.status(200).json({ message: "Logged out successfully." });
});

/**
 * GET /auth/me
 * Return the authenticated user's profile.
 */
router.get("/me", requireAuth, async (_req, res) => {
  const session = res.locals.session as SessionPayload;

  const user = await prisma.user.findUnique({ where: { id: session.sub } });
  if (!user) {
    clearSession(res);
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.status(200).json({ id: user.id, email: user.email, createdAt: user.createdAt });
});

export default router;
