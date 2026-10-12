import { asc, eq } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';

import { ChatView } from '@/components/chat/chat-view';
import { getCurrentUser } from '@/lib/auth/current-user';
import { defaultModelId, listSelectableModels } from '@/lib/ai/resolve';
import { db } from '@/lib/db';
import { conversations, messages } from '@/lib/db/schema';

export const instant = false;

export async function generateMetadata({ params }: PageProps<'/chat/[id]'>) {
  const { id } = await params;
  const [row] = await db
    .select({ title: conversations.title })
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);
  return { title: row?.title ?? 'แชท' };
}

export default async function ChatPage({ params }: PageProps<'/chat/[id]'>) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { id } = await params;

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);

  // Never distinguish "does not exist" from "not yours".
  if (!conversation || conversation.userId !== user.id) notFound();

  const [rows, models] = await Promise.all([
    db
      .select({
        id: messages.id,
        parentId: messages.parentId,
        role: messages.role,
        parts: messages.parts,
      })
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt)),
    listSelectableModels(),
  ]);

  // Same branch walk as the API: newest leaf, then follow parents back.
  const byId = new Map(rows.map((m) => [m.id, m]));
  const children = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.parentId) continue;
    children.set(row.parentId, [...(children.get(row.parentId) ?? []), row]);
  }

  let leaf = rows.at(-1);
  for (let guard = 0; leaf && guard < rows.length + 1; guard++) {
    const kids = children.get(leaf.id);
    if (!kids?.length) break;
    leaf = kids.at(-1);
  }

  const path: typeof rows = [];
  for (let cursor = leaf; cursor; cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined) {
    path.unshift(cursor);
  }

  // Mirrors the API route: a root outside the path means the chain is broken, and
  // reading the table in order is both complete and correctly sorted — just
  // unpruned.
  const onPath = new Set(path.map((m) => m.id));
  const orphanedRoots = rows.filter((m) => !m.parentId && !onPath.has(m.id));
  const visible: typeof rows = orphanedRoots.length ? rows : path;

  return (
    <ChatView
      conversationId={conversation.id}
      credits={user.credits}
      initialModelId={conversation.modelId ?? defaultModelId(models)}
      initialTurns={visible.map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        parts: Array.isArray(m.parts) ? (m.parts as never) : [],
        branchCount: children.get(m.id)?.length ?? 0,
      }))}
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