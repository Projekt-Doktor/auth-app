import { redirect } from 'next/navigation';
import { verifyMagicToken } from '@/lib/auth/token';
import { issueSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';

interface Props {
  searchParams: Promise<{ token?: string }>;
}

export default async function VerifyPage({ searchParams }: Props) {
  const { token } = await searchParams;

  if (!token) {
    return <ErrorUI message="Missing token. Please request a new magic link." />;
  }

  const result = await verifyMagicToken(token);

  if (!result.ok) {
    const message =
      result.reason === 'used'
        ? 'This link has already been used. Please request a new one.'
        : 'This link is invalid or has expired. Please request a new one.';
    return <ErrorUI message={message} />;
  }

  const user = await prisma.user.upsert({
    where: { email: result.email },
    update: { updatedAt: new Date() },
    create: { email: result.email },
  });

  await issueSession({ sub: user.id, email: user.email });

  redirect('/dashboard');
}

function ErrorUI({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="mb-2 text-2xl font-semibold tracking-tight">Sign-in failed</h1>
        <p className="mb-6 text-sm text-zinc-500">{message}</p>
        <Link
          href="/"
          className="inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Request a new link
        </Link>
      </div>
    </main>
  );
}
