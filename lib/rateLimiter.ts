// In-memory rate limiter — resets on server restart; sufficient for v1 single-instance.
// Replace with Redis-backed solution for multi-instance deployments.

interface RateLimitEntry {
  count: number;
  resetAt: number; // epoch ms
}

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS = 5;

const store = new Map<string, RateLimitEntry>();

export function checkRateLimit(ip: string): { limited: boolean } {
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now > entry.resetAt) {
    store.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { limited: false };
  }

  if (entry.count >= MAX_REQUESTS) {
    return { limited: true };
  }

  entry.count += 1;
  return { limited: false };
}
