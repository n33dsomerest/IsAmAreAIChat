import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';

import { requireUser } from '@/lib/api/auth';
import { db } from '@/lib/db';
import { artifacts, conversations, messages } from '@/lib/db/schema';

/** Everything the model has produced as an artifact, newest first. */
export async function GET() {
  const session = await requireUser();
  if (!session.ok) return session.response;

  const rows = await db
    .select({
      id: artifacts.id,
      title: artifacts.title,
      language: artifacts.language,
      source: artifacts.source,
      updatedAt: artifacts.updatedAt,
      conversationId: conversations.id,
      conversationTitle: conversations.title,
      messageId: messages.id,
    })
    .from(artifacts)
    .innerJoin(messages, eq(artifacts.messageId, messages.id))
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(eq(conversations.userId, session.user.id))
    .orderBy(desc(artifacts.updatedAt))
    .limit(200);

  return NextResponse.json({ artifacts: rows });
}

