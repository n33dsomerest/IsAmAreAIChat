import type { CurrentUser } from '@/lib/auth/current-user';
import { AppSidebar } from '@/components/app-sidebar';

/**
 * Chrome shared by every signed-in page: sidebar on the left, content on the
 * right. On small screens the sidebar collapses into a sheet.
 */
export function AppShell({
  user,
  children,
}: {
  user: CurrentUser | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh overflow-hidden">
      <AppSidebar
        className="hidden md:flex"
        credits={user?.credits ?? 0}
        username={user?.username}
        isSignedIn={Boolean(user)}
        isAdmin={user?.role === 'admin'}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader user={user} />
        {children}
      </div>
    </div>
  );
}

function MobileHeader({ user }: { user: CurrentUser | null }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4 md:hidden">
      <span className="text-sm font-semibold">AIChat</span>
      <span className="text-muted-foreground ml-auto text-xs tabular-nums">
        {user ? `${user.credits} เครดิต` : 'ยังไม่ได้เข้าสู่ระบบ'}
      </span>
    </header>
  );
}