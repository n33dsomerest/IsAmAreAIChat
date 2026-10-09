import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';

/**
 * OAuth landing route. The browser is redirected back here with a
 * `?code=...` (PKCE) or `#access_token=...` (implicit) fragment; the
 * Supabase client exchanges it for a session and sets the cookies.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error_description') ?? searchParams.get('error');

  // Only ever redirect to a path on this origin — never to an arbitrary URL.
  const requested = searchParams.get('next');
  const next = requested?.startsWith('/') && !requested.startsWith('//') ? requested : '/';

  if (error) {
    const url = new URL('/login', origin);
    url.searchParams.set('error', error);
    return NextResponse.redirect(url);
  }

  if (code) {
    const supabase = await createClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      const url = new URL('/login', origin);
      url.searchParams.set('error', exchangeError.message);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}