'use client';

import { useParams } from 'next/navigation';

import { AppShell } from '@/components/app-shell';
import type { CurrentUser } from '@/lib/auth/current-user';

/**
 * The layout is a server component but the sidebar needs to know which
 * conversation is open so it can highlight it. `useParams` only runs on the
 * client, so the shell is rendered from here.
 */
export function ShellClient({
  user,
  children,
}: {
  user: CurrentUser | null;
  children: React.ReactNode;
}) {
  const params = useParams<{ id?: string }>();
  const activeId = typeof params?.id === 'string' ? params.id : undefined;

  return (
    <AppShell user={user} activeId={activeId}>
      {children}
    </AppShell>
  );
}