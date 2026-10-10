'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';

import { AppSidebar } from '@/components/app-sidebar';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { CurrentUser } from '@/lib/auth/current-user';

/**
 * The sidebar is `hidden md:flex`, so on a phone it was simply unreachable —
 * no new chat, no history, no sign out. This puts it in a sheet behind a menu
 * button, which is what the shell's comment always claimed it did.
 *
 * It is a separate client component rather than a change to app-shell.tsx so
 * that file can stay a server component.
 */
export function MobileNav({ user, activeId }: { user: CurrentUser | null; activeId?: string }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="-ml-1 size-9 shrink-0"
          aria-label="เปิดเมนู"
        >
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>

      <SheetContent
        side="left"
        // The sidebar draws its own background, so the sheet is a bare frame:
        // no padding, and the close button sits over it.
        className="w-[17rem] max-w-[85vw] gap-0 p-0"
      >
        <SheetTitle className="sr-only">เมนูหลัก</SheetTitle>
        <AppSidebar
          className="w-full border-r-0"
          credits={user?.credits ?? 0}
          username={user?.username}
          isSignedIn={Boolean(user)}
          isAdmin={user?.role === 'admin'}
          activeId={activeId}
          onNavigate={close}
        />
      </SheetContent>
    </Sheet>
  );
}