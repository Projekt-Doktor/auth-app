import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createMagicToken } from '@/lib/auth/token';
import { sendMagicLink } from '@/lib/auth/email';
import { checkRateLimit } from '@/lib/rateLimiter';

const bodySchema = z.object({
  email: z.string().email(),
});

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    '127.0.0.1';

  if (checkRateLimit(ip).limited) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait before requesting another link.' },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 });
  }

  // Fire-and-forget — always return 200 to prevent email enumeration
  try {
    const token = await createMagicToken(parsed.data.email);
    if (process.env.NODE_ENV === 'development') {
      const base = process.env.APP_URL ?? 'http://localhost:3000';
      console.log(`[magic-link] DEV verify URL: ${base}/api/auth/verify?token=${encodeURIComponent(token)}`);
    }
    await sendMagicLink(parsed.data.email, token);
  } catch (err) {
    console.error('[magic-link] Failed to send:', err);
  }

  return NextResponse.json({ message: 'If that email is valid, a link is on its way.' });
}
