import { ChatView } from '@/components/chat/chat-view';
import { getCurrentUser } from '@/lib/auth/current-user';
import { listSelectableModels } from '@/lib/ai/resolve';

export default async function HomePage() {
  const [user, models] = await Promise.all([getCurrentUser(), listSelectableModels()]);

  return (
    <ChatView
      credits={user?.credits ?? 0}
      initialModelId={null}
      initialTurns={[]}
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
  );
}