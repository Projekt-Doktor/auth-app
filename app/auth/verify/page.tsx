import Link from 'next/link';

interface Props {
  searchParams: Promise<{ error?: string }>;
}

export default async function VerifyErrorPage({ searchParams }: Props) {
  const { error } = await searchParams;

  const message =
    error === 'used'
      ? 'This link has already been used. Please request a new one.'
      : error === 'missing'
        ? 'Missing token. Please request a new magic link.'
        : 'This link is invalid or has expired. Please request a new one.';

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
