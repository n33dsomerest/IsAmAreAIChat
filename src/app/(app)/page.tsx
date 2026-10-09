import { Sparkles } from 'lucide-react';

import { ChatComposer } from '@/components/chat/chat-composer';
import { getCurrentUser } from '@/lib/auth/current-user';
import { listSelectableModels } from '@/lib/ai/resolve';

export default async function HomePage() {
  const [user, models] = await Promise.all([getCurrentUser(), listSelectableModels()]);

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
              เครดิต · เลือกได้ {models.length} โมเดล
            </p>
          </div>

          {/* The composer is wired to the model catalogue; the streaming route
              and credit reservation land in Phase 4. */}
          <ChatComposer
            models={models.map((m) => ({
              id: m.id,
              label: m.displayName,
              provider: m.providerName,
              providerId: m.providerId,
              isFallback: m.isFallback,
              contextWindow: m.contextWindow,
              maxOutput: m.maxOutput,
              capabilities: m.capabilities,
            }))}
          />

          <p className="text-muted-foreground mt-4 flex items-center justify-center gap-1.5 text-xs">
            <Sparkles className="size-3.5" />
            เฟส 3 เสร็จแล้ว — ระบบโมเดลและผู้ดูแลระบบพร้อมใช้งาน
          </p>
        </div>
      </div>
    </main>
  );
}