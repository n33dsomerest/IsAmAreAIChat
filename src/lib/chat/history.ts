import { asc, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { messages } from '@/lib/db/schema';
import { SITE } from '@/lib/site-config';
import type { UIMessage } from 'ai';

export const DEFAULT_SYSTEM_PROMPT = `You are ${SITE.name}, a helpful AI assistant.

Answer in the user's language. Be concise and concrete — prefer an example or a
table over a paragraph when it is clearer. If you are unsure about something, say
so rather than guessing.`;

/**
 * Turns stored UI message parts back into the plain text the model API wants.
 *
 * Tool calls and result parts are dropped on purpose: they are UI-only here and
 * replaying them to a fresh request would produce invalid history.
 */
export function toModelMessages(history: UIMessage[]): {
  role: 'system' | 'user' | 'assistant';
  content: string;
}[] {
  const out: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];

  for (const message of history) {
    const text = message.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
      .trim();

    if (!text) continue;
    if (message.role === 'user' || message.role === 'assistant') {
      out.push({ role: message.role, content: text });
    }
  }

  return out;
}

/** Loads a conversation's messages oldest-first, skipping deleted branches. */
export async function loadHistory(
  conversationId: string,
): Promise<{ messages: UIMessage[]; lastUserMessage: string }> {
  const rows = await db
    .select({
      id: messages.id,
      role: messages.role,
      parts: messages.parts,
      status: messages.status,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));

  const history = rows.map(
    (r): UIMessage => ({
      id: r.id,
      role: r.role as UIMessage['role'],
      parts: (r.parts as UIMessage['parts']) ?? [],
    }),
  );

  const lastUser = [...history].reverse().find((m) => m.role === 'user');
  const lastUserMessage = lastUser
    ? lastUser.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('')
    : '';

  return { messages: history, lastUserMessage };
}

/** First line of the first user message, used as the conversation title. */
export function deriveTitle(text: string, fallback = 'New chat'): string {
  const line = text.trim().split('\n')[0] ?? '';
  if (!line) return fallback;
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}