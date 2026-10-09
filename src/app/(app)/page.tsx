import { ArrowUp, Paperclip, Sparkles } from 'lucide-react';

import { getCurrentUser } from '@/lib/auth/current-user';
import { Button } from '@/components/ui/button';

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center border-b px-4">
        <span className="text-sm font-medium">แชทใหม่</span>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="w-full max-w-2xl">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">
              สวัสดี{user?.username ? `, ${user.username}` : ''}
            </h1>
            <p className="text-muted-foreground mt-2 text-sm">
              คุณมี <span className="font-medium tabular-nums">{user?.credits ?? 0}</span>{' '}
              เครดิต · การสนทนาจะเริ่มทำงานในเฟส 4
            </p>
          </div>

          {/* Chat composer placeholder — wired to /api/chat in Phase 4. */}
          <div className="rounded-xl border p-3">
            <div className="text-muted-foreground min-h-16 text-sm">
              พิมพ์ข้อความเพื่อเริ่มแชท…
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Button variant="ghost" size="icon" disabled aria-label="แนบไฟล์">
                <Paperclip className="size-4" />
              </Button>
              <Button size="icon" className="ml-auto" disabled aria-label="ส่งข้อความ">
                <ArrowUp className="size-4" />
              </Button>
            </div>
          </div>

          <p className="text-muted-foreground mt-4 flex items-center justify-center gap-1.5 text-xs">
            <Sparkles className="size-3.5" />
            เข้าสู่ระบบสำเร็จ — เฟส 2 เสร็จแล้ว
          </p>
        </div>
      </div>
    </main>
  );
}