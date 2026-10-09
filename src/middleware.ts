import type { NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. Excluding them keeps
     * the session refresh off the hot path for CSS/JS/font requests.
     *
     * The PWA files are named explicitly rather than by extension: the service
     * worker must be able to refresh the session when it asks for its own
     * update, and `manifest.webmanifest` has no image extension to match.
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};