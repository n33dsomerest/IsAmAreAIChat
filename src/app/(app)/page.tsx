import { getCurrentUser } from '@/lib/auth/current-user';
import { ChatComposer } from '@/components/chat/chat-composer';
import { listSelectableModels } from '@/lib/ai/resolve';

export default async function HomePage() {
  const [user, models] = await Promise.all([getCurrentUser(), listSelectableModels()]);

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <span className="text-sm font-medium">แชทใหม่</span>
        {user && (
          <span className="text-muted-foreground ml-auto text-xs tabular-nums">
            {user.credits} เครดิต
          </span>
        )}
      </header>

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
        credits={user?.credits ?? 0}
      />
    </main>
  );
}