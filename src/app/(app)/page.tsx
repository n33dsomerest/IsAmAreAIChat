import { redirect } from 'next/navigation';

import { ChatView } from '@/components/chat/chat-view';
import { getCurrentUser } from '@/lib/auth/current-user';
import { defaultModelId, listSelectableModels } from '@/lib/ai/resolve';
import { resolveDraftConversation } from '@/lib/chat/history';
import { ChatErrorBoundary } from '@/components/error-boundary';

/** Credits and the model catalogue are per-request, so blocking is expected. */
export const instant = false;

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // The empty session is resolved here, not by the composer, so `/` is already
  // pointed at a real conversation before anything renders: attachments have
  // something to hang off, and a reload mid-typing does not strand the text in
  // a component that no longer exists.
  const [models, draftId] = await Promise.all([
    listSelectableModels(),
    resolveDraftConversation(user.id),
  ]);

  return (
    <ChatErrorBoundary>
      <ChatView
        conversationId={draftId}
        credits={user.credits}
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