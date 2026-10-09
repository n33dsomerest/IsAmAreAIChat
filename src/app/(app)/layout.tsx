import type { Metadata } from 'next';

import { ShellClient } from '@/components/shell-client';
import { getCurrentUser } from '@/lib/auth/current-user';

export const metadata: Metadata = {
  title: 'แชท',
};

/**
 * The layout reads the session cookie, so this subtree can never be
 * prerendered — without this Next 16 refuses to build it.
 */
export const instant = false;

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const user = await getCurrentUser();

  // The middleware guarantees a session for this subtree, so a null here means
  // the profile row is missing — render signed out rather than crash.
  return <ShellClient user={user}>{children}</ShellClient>;
}