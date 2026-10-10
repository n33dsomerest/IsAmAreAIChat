import type { Metadata } from 'next';
import { connection } from 'next/server';

import { ShellClient } from '@/components/shell-client';
import { getCurrentUser } from '@/lib/auth/current-user';

export const metadata: Metadata = {
  title: 'แชท',
};

/**
 * Navigating into this shell waits on the session, so it is allowed to block.
 * Unrelated to prerendering — see the `connection()` call below.
 */
export const instant = false;

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  // Partial Prefetching prerenders the shell of a dynamic route before any
  // request exists. `getCurrentUser` reaches Supabase's auth client, which
  // reads the clock, so that pass trips Next's unstable-value check and the
  // route errors out. Stopping prerendering here says what is already true:
  // this subtree is per-request, and nothing below it can be cached.
  await connection();

  const user = await getCurrentUser();

  // The middleware guarantees a session for this subtree, so a null here means
  // the profile row is missing — render signed out rather than crash.
  return <ShellClient user={user}>{children}</ShellClient>;
}