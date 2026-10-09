import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireUser } from '@/lib/api/auth';
import { db } from '@/lib/db';
import { conversations, messages } from '@/lib/db/schema';

const bodySchema = z.object({
  messageId: z.string().uuid(),
  /** Omit to regenerate an assistant turn unchanged. */
  text: z.string().trim().min(1).max(32_000).optional(),
});

/**
 * Forks a turn: the new message replaces the given one on a branch of its own.
 *
 * Nothing is deleted. The original keeps its subtree and the new message points
 * at the same parent, so both paths stay readable.
 *
 * `messageId` travels in the body rather than the path: Next 16's generated
 * route types only describe the first dynamic segment, and a second one would
 * silently type as `never`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireUser();
  if (!session.ok) return session.response;

  const { id } = await params;
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }

  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, session.user.id)))
    .limit(1);

  if (!conversation) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const [original] = await db
    .select({
      id: messages.id,
      parentId: messages.parentId,
      role: messages.role,
      parts: messages.parts,
    })
    .from(messages)
    .where(and(eq(messages.id, body.data.messageId), eq(messages.conversationId, id)))
    .limit(1);

  if (!original) {
    return NextResponse.json({ error: 'message_not_found' }, { status: 404 });
  }

  const [fork] = await db
    .insert(messages)
    .values({
      conversationId: id,
      parentId: original.parentId,
      role: original.role,
      parts:
        original.role === 'user'
          ? [{ type: 'text', text: body.data.text ?? textOf(original.parts) }]
          : [],
      status: original.role === 'user' ? 'complete' : 'pending',
    })
    .returning({
      id: messages.id,
      role: messages.role,
      parentId: messages.parentId,
    });

  return NextResponse.json({
    messageId: fork.id,
    role: fork.role,
    parentId: fork.parentId,
  });
}

function textOf(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p): p is { type: 'text'; text: string } =>
      Boolean(p && typeof p === 'object' && (p as { type?: string }).type === 'text'),
    )
    .map((p) => p.text)
    .join('');
}