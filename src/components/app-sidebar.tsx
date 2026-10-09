'use client';

import {
  CreditCard,
  LogOut,
  MessageSquarePlus,
  MoreHorizontal,
  Settings,
  Shield,
  Sparkles,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { ThemeToggle } from '@/components/theme-toggle';
import { ConversationList } from '@/components/chat/conversation-list';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { SITE } from '@/lib/site-config';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';

type AppSidebarProps = {
  credits: number;
  isSignedIn: boolean;
  username?: string;
  isAdmin?: boolean;
  /** Highlights the current conversation in the list. */
  activeId?: string;
  className?: string;
};

export function AppSidebar({
  credits,
  isSignedIn,
  username,
  isAdmin = false,
  activeId,
  className,
}: AppSidebarProps) {
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  return (
    <aside
      className={cn(
        'bg-sidebar text-sidebar-foreground flex h-full w-64 shrink-0 flex-col border-r',
        className,
      )}
    >
      <div className="flex items-center gap-2 px-3 py-3">
        <Link href="/" className="flex min-w-0 items-center gap-2">
          <span className="bg-primary text-primary-foreground grid size-7 shrink-0 place-items-center rounded-md">
            <Sparkles className="size-4" />
          </span>
          <span className="truncate text-sm font-semibold">{SITE.name}</span>
        </Link>

        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label="เมนู">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>{SITE.name}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/pricing">
                  <CreditCard className="size-4" />
                  เติมเครดิต
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/settings">
                  <Settings className="size-4" />
                  ตั้งค่า
                </Link>
              </DropdownMenuItem>
              {isAdmin && (
                <DropdownMenuItem asChild>
                  <Link href="/admin">
                    <Shield className="size-4" />
                    ผู้ดูแลระบบ
                  </Link>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="px-3 pb-2">
        <Button asChild className="w-full justify-start gap-2">
          <Link href="/" onClick={() => router.push('/')}>
            <MessageSquarePlus className="size-4" />
            แชทใหม่
          </Link>
        </Button>
      </div>

      <Separator className="mx-3 w-auto" />

      <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <ConversationList activeId={activeId} />
      </div>

      <div className="space-y-2 border-t p-3">
        <div className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5">
          <span className="text-muted-foreground text-xs">เครดิตคงเหลือ</span>
          <span className="text-sm font-semibold tabular-nums">{credits}</span>
        </div>

        <div className="flex items-center gap-1">
          <Button asChild variant="outline" size="sm" className="flex-1">
            <Link href="/pricing">เติมเครดิต</Link>
          </Button>
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="บัญชีผู้ใช้"
              >
                <User className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {isSignedIn ? (
                <>
                  <DropdownMenuLabel>{username}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/billing">ประวัติการซื้อ</Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={signOut}>
                    <LogOut className="size-4" />
                    ออกจากระบบ
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuLabel>ยังไม่ได้เข้าสู่ระบบ</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/login">เข้าสู่ระบบ</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/register">สมัครสมาชิก</Link>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </aside>
  );
}