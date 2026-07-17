import { NextRequest, NextResponse } from 'next/server';
import { verifyMagicToken } from '@/lib/auth/token';
import { issueSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');

  if (!token) {
    return NextResponse.redirect(new URL('/auth/verify?error=missing', req.url));
  }

  let result;
  try {
    result = await verifyMagicToken(token);
  } catch (err) {
    console.error('[verify] Token verification error:', err);
    return NextResponse.redirect(new URL('/auth/verify?error=invalid', req.url));
  }

  if (!result.ok) {
    return NextResponse.redirect(
      new URL(`/auth/verify?error=${result.reason}`, req.url),
    );
  }

  try {
    const user = await prisma.user.upsert({
      where: { email: result.email },
      update: { updatedAt: new Date() },
      create: { email: result.email },
    });
    await issueSession({ sub: user.id, email: user.email });
  } catch (err) {
    console.error('[verify] Session error:', err);
    return NextResponse.redirect(new URL('/auth/verify?error=invalid', req.url));
  }

  return NextResponse.redirect(new URL('/dashboard', req.url));
}
