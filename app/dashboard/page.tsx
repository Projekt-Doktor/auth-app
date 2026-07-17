import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import LogoutButton from './LogoutButton';

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect('/');

  const user = await prisma.user.findUnique({ where: { id: session.sub } });
  if (!user) redirect('/');

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Dashboard</h1>
        <div className="mb-6 rounded-md border border-zinc-200 bg-white p-4 text-sm">
          <p className="mb-1 text-zinc-500">Signed in as</p>
          <p className="font-medium">{user.email}</p>
          <p className="mt-3 text-zinc-500">
            Member since{' '}
            <span className="text-zinc-700">
              {user.createdAt.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
          </p>
        </div>
        <LogoutButton />
      </div>
    </main>
  );
}
