import { ChatView } from '@/components/chat/chat-view';
import { getCurrentUser } from '@/lib/auth/current-user';
import { defaultModelId, listSelectableModels } from '@/lib/ai/resolve';
import { ChatErrorBoundary } from '@/components/error-boundary';

/** Credits and the model catalogue are per-request, so blocking is expected. */
export const instant = false;

export default async function HomePage() {
  const [user, models] = await Promise.all([getCurrentUser(), listSelectableModels()]);

  return (
    <ChatErrorBoundary>
      <ChatView
        credits={user?.credits ?? 0}
        initialModelId={defaultModelId(models)}
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
    </ChatErrorBoundary>
  );
}