'use client';

import { AlertTriangle, ExternalLink } from 'lucide-react';

/**
 * The two Supabase dashboard settings this auth flow silently depends on.
 *
 * 1. Email confirmation MUST be off — username accounts use a synthetic address
 *    that cannot receive mail, so a confirmation link would never arrive.
 * 2. Google needs Supabase's OWN callback URL registered, not the app's. The
 *    browser lands on `/auth/callback`, but the redirect_uri Google actually
 *    validates is `https://<ref>.supabase.co/auth/v1/callback`.
 *
 * Development only. `NODE_ENV` is inlined at build time, so the server and the
 * client agree on the answer — reading `window.location` here instead would
 * make the two sides disagree and trip a hydration mismatch. It is also the
 * right audience: once the project is set up, a real user has no business
 * seeing a Supabase configuration checklist.
 */
export function AuthSetupNotice() {
  if (process.env.NODE_ENV !== 'development') return null;

  const supabaseRef =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.split('//')[1]?.split('.')[0] ?? '';

  return (
    <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        ตั้งค่า Supabase ให้ครบก่อนสมัคร
      </p>

      <ol className="space-y-2 pl-1 text-xs">
        <li>
          <span className="font-medium">1. ปิด Email confirmation</span>
          <br />
          Supabase → Authentication → Sign In / Providers → Email → ปิด{' '}
          <em>Confirm email</em>
          <br />
          <span className="text-muted-foreground">
            บัญชีที่สมัครด้วยชื่อผู้ใช้มีอีเมลสมมติที่รับเมลไม่ได้
          </span>
        </li>

        <li>
          <span className="font-medium">2. เปิดใช้ Google provider</span>
          <br />
          Supabase → Authentication → Sign In / Providers → Google → เปิดใช้ →
          กรอก Client ID / Client Secret
          <br />
          <span className="text-muted-foreground">
            แล้วใน Google Console ต้องมี{' '}
            <code className="bg-muted rounded px-1">
              https://{supabaseRef}.supabase.co/auth/v1/callback
            </code>{' '}
            ใน Authorized redirect URIs — <strong>ไม่ใช่</strong>{' '}
            <code className="bg-muted rounded px-1">/auth/callback</code> ของเว็บเรา
          </span>
        </li>

        <li>
          <span className="font-medium">3. เพิ่ม Redirect URL ใน Supabase</span>
          <br />
          Supabase → Authentication → URL Configuration →{' '}
          <code className="bg-muted rounded px-1">http://localhost:3000/auth/callback</code>
        </li>
      </ol>

      <a
        href="https://supabase.com/dashboard"
        target="_blank"
        rel="noreferrer"
        className="text-muted-foreground inline-flex items-center gap-1 text-xs underline underline-offset-4 hover:text-foreground"
      >
        เปิด Supabase Dashboard
        <ExternalLink className="size-3" />
      </a>
    </div>
  );
}