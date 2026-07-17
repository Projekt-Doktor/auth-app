import rateLimit from "express-rate-limit";

/** 5 magic-link requests per email per 10 minutes (keyed by IP) */
export const magicLinkRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait before requesting another link." },
});

/** General auth route limiter */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests." },
});
