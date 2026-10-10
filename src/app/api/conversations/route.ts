import { NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';

import { requireUser } from '@/lib/api/auth';
import { PLACEHOLDER_TITLES } from '@/lib/chat/history';
import { db } from '@/lib/db';
import { conversations, providerModels } from '@/lib/db/schema';

export async function GET() {
  const session = await requireUser();
  if (!session.ok) return session.response;

  const rows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      folder: conversations.folder,
      pinned: conversations.pinned,
      archived: conversations.archived,
      updatedAt: conversations.updatedAt,
      createdAt: conversations.createdAt,
      modelId: conversations.modelId,
      modelName: providerModels.displayName,
      messageCount: sql<number>`(
        select count(*) from public.messages m where m.conversation_id = ${conversations.id}
      )::int`,
    })
    .from(conversations)
    .leftJoin(providerModels, eq(conversations.modelId, providerModels.id))
    .where(
      and(eq(conversations.userId, session.user.id), eq(conversations.archived, false)),
    )
    .orderBy(desc(conversations.pinned), desc(conversations.updatedAt))
    .limit(200);

  const folders = [...new Set(rows.map((r) => r.folder).filter(Boolean))] as string[];

  return NextResponse.json({ conversations: rows, folders });
}

/** Creates an empty conversation so the sidebar has something to link to. */
export async function POST() {
  const session = await requireUser();
  if (!session.ok) return session.response;

  // A new conversation starts as a placeholder so uploads have something to
  // hang off before the first message exists; /api/chat replaces it with a real
  // title once that message arrives.
  const [row] = await db
    .insert(conversations)
    .values({ userId: session.user.id, title: PLACEHOLDER_TITLES[0] })
    .returning({ id: conversations.id });

  return NextResponse.json({ id: row.id }, { status: 201 });
}