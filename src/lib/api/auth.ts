import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/current-user';
import { createClient } from '@/lib/supabase/server';

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/**
 * Resolves the caller and requires a signed-in user.
 *
 * Returns the user on success, or a ready-to-return response on failure — the
 * `if (!session.ok)` shape makes it hard to forget the error branch.
 */
export async function requireUser(): Promise<
  { ok: true; user: SessionUser } | { ok: false; response: NextResponse }
> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
    };
  }
  return { ok: true, user };
}

export async function requireAdmin(): Promise<
  { ok: true; user: SessionUser } | { ok: false; response: NextResponse }
> {
  const session = await requireUser();
  if (!session.ok) return session;
  if (session.user.role !== 'admin') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    };
  }
  return session;
}

/**
 * Re-reads the profile through PostgREST rather than trusting a cached lookup.
 *
 * `getCurrentUser` is wrapped in React `cache`, so within a single render it is
 * memoised; this route is a fresh request each time, which is exactly the scope
 * where a stale role could otherwise slip through.
 */
export async function verifyAdminViaRls(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();

  return data?.role === 'admin';
}