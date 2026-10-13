import { cache } from 'react';
import { connection } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import logger from '@/lib/logger';

export type CurrentUser = {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  role: 'user' | 'admin';
  credits: number;
  /** true once they have ever paid — the daily request cap is lifted. */
  hasPaid: boolean;
};

/**
 * The signed-in user's profile, or null.
 *
 * Wrapped in React `cache` so the layout, sidebar and page can each ask for it
 * during one render without re-running the query. Reads go through the Supabase
 * client (not Drizzle) so Row Level Security applies.
 *
 * `connection()` is not optional here. The auth client reads the clock, and
 * Partial Prefetching prerenders each segment on its own — without a
 * request-time boundary Next aborts the whole route with "unstable value
 * Date.now() while prerendering".
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  await connection();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile, error } = await supabase
    .from('users')
    .select('username, email, display_name, role, credits_balance, first_paid_at')
    .eq('id', user.id)
    .single();

  // The profile is written by a database trigger on signup. Anything other
  // than "row missing" is a real problem — most often missing table grants,
  // which otherwise looks identical to being signed out and hides the bug.
  if (error) {
    logger.error(
      { error: { message: error.message, code: error.code, hint: error.hint } },
      'failed to load profile',
    );
    return null;
  }
  if (!profile) {
    logger.error({ userId: user.id }, 'signed-in user has no profile row');
    return null;
  }

  return {
    id: user.id,
    username: profile.username,
    email: profile.email,
    displayName: profile.display_name,
    role: profile.role,
    credits: profile.credits_balance,
    hasPaid: Boolean(profile.first_paid_at),
  };
});

export const isAdmin = (user: CurrentUser | null) => user?.role === 'admin';