import Link from 'next/link';

export default function CheckInboxPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mb-4 text-4xl">📬</div>
        <h1 className="mb-2 text-2xl font-semibold tracking-tight">Check your inbox</h1>
        <p className="mb-6 text-sm text-zinc-500">
          We sent a magic link to your email. Click it to sign in — it expires in 15 minutes.
        </p>
        <p className="text-xs text-zinc-400">
          Wrong email?{' '}
          <Link href="/" className="underline underline-offset-2 hover:text-zinc-600">
            Go back
          </Link>
        </p>
      </div>
    </main>
  );
}
