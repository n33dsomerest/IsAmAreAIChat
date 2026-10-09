import Link from 'next/link';

import { AuthSetupNotice } from '@/components/auth/auth-setup-notice';
import { GoogleButton } from '@/components/auth/google-button';
import { FREE_TIER, SITE } from '@/lib/site-config';

type AuthShellProps = {
  title: string;
  subtitle: string;
  footer: React.ReactNode;
  children: React.ReactNode;
};

export function AuthShell({ title, subtitle, footer, children }: AuthShellProps) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2">
          <span className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-lg">
            <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
              <path
                fill="currentColor"
                d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2z"
              />
            </svg>
          </span>
          <span className="text-lg font-semibold">{SITE.name}</span>
        </Link>

        <div className="bg-card text-card-foreground rounded-xl border p-6 shadow-sm">
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>

          <div className="mt-6 space-y-4">
            <AuthSetupNotice />
            {children}
          </div>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="bg-border w-full border-t" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-card text-muted-foreground px-2 text-xs">หรือ</span>
            </div>
          </div>

          <GoogleButton />
        </div>

        <div className="mt-4 text-center text-sm">{footer}</div>

        <p className="text-muted-foreground mt-8 text-center text-xs">
          ผู้ใช้ใหม่เริ่มต้นฟรี {FREE_TIER.welcomeCredits} เครดิต ไม่ต้องชำระเงินก่อนลองใช้
        </p>
      </div>
    </div>
  );
}

/** Inline error / success banner. */
export function AuthAlert({ tone, children }: { tone: 'error' | 'info'; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={
        tone === 'error'
          ? 'border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm'
          : 'border-border bg-muted text-muted-foreground rounded-md border px-3 py-2 text-sm'
      }
    >
      {children}
    </div>
  );
}