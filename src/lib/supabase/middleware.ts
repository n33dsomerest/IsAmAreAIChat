import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

/** Routes that stay reachable without a session. */
const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/auth/callback',
  '/auth/confirm',
  '/pricing',
  '/api/payments',
  '/api/webhooks',
];

/**
 * Refreshes the Supabase session on every request and gates private routes.
 * Returns the response that must be sent — callers should always use this
 * object so refreshed cookies are written back.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() revalidates the JWT against Supabase Auth — never trust
  // getSession(), which only reads unverified claims from the cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  // A PKCE `code` only means something at /auth/callback, which is the one
  // place that exchanges it for a session. Supabase sends it to whatever the
  // project's Site URL is, so if that is set to the root the code would
  // otherwise be carried into /login as a dead `next` and the email link would
  // silently fail to sign anyone in. Forward it instead of losing it.
  if (pathname !== '/auth/callback' && request.nextUrl.searchParams.has('code')) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/callback';
    url.search = search;
    return NextResponse.redirect(url);
  }

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!user && !isPublic) {
    // An API caller cannot follow a redirect to an HTML login page — it needs a
    // status code it can branch on, not a 307 pointing at a form.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (user && (pathname === '/login' || pathname === '/register')) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}