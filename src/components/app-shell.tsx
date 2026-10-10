import type { CurrentUser } from '@/lib/auth/current-user';
import { AppSidebar } from '@/components/app-sidebar';
import { MobileNav } from '@/components/mobile-nav';

/**
 * Chrome shared by every signed-in page: sidebar on the left, content on the
 * right. On small screens the sidebar collapses into a sheet.
 */
export function AppShell({
  user,
  children,
  activeId,
}: {
  user: CurrentUser | null;
  children: React.ReactNode;
  /** Highlights the current conversation in the sidebar. */
  activeId?: string;
}) {
  return (
    <div className="flex h-dvh overflow-hidden">
      <AppSidebar
        className="hidden md:flex"
        credits={user?.credits ?? 0}
        username={user?.username}
        isSignedIn={Boolean(user)}
        isAdmin={user?.role === 'admin'}
        activeId={activeId}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader user={user} activeId={activeId} />
        {children}
      </div>
    </div>
  );
}

function MobileHeader({ user, activeId }: { user: CurrentUser | null; activeId?: string }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4 md:hidden">
      <MobileNav user={user} activeId={activeId} />
      <span className="text-sm font-semibold">AIChat</span>
      <span className="text-muted-foreground ml-auto text-xs tabular-nums">
        {user ? `${user.credits} เครดิต` : 'ยังไม่ได้เข้าสู่ระบบ'}
      </span>
    </header>
  );
}