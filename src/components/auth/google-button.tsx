'use client';

import { Loader2 } from 'lucide-react';
import { useState } from 'react';

import { createClient } from '@/lib/supabase/client';

export function GoogleButton({ label = 'ต่อด้วย Google' }: { label?: string }) {
  const [busy, setBusy] = useState(false);

  async function signInWithGoogle() {
    setBusy(true);
    const supabase = createClient();
    const next = new URLSearchParams(window.location.search).get('next') ?? '/';
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      // Nothing to recover to here — surface it rather than leaving a stuck spinner.
      console.error(error.message);
      setBusy(false);
    }
    // On success the browser navigates away, so `busy` intentionally stays true.
  }

  return (
    <button
      type="button"
      onClick={signInWithGoogle}
      disabled={busy}
      className="border-input bg-background hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring/50 inline-flex h-10 w-full items-center justify-center gap-3 rounded-md border text-sm font-medium transition-colors focus-visible:ring-[3px] focus-visible:outline-1 disabled:opacity-50"
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <svg className="size-4" viewBox="0 0 24 24" aria-hidden>
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a11 11 0 0 0-9.82 6.05l3.66 2.84c.87-2.6 3.3-4.51 6.16-4.51Z"
          />
        </svg>
      )}
      {label}
    </button>
  );
}