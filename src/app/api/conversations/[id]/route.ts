import { NextResponse, type NextRequest } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireUser } from '@/lib/api/auth';
import { db } from '@/lib/db';
import { attachments, conversations, messages } from '@/lib/db/schema';
import { remove } from '@/lib/storage';

type StoredMessage = {
  id: string;
  parentId: string | null;
  role: string;
  parts: unknown;
  status: string;
  error: string | null;
  createdAt: Date;
};

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  folder: z.string().trim().max(60).nullable().optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  systemPrompt: z.string().max(8000).nullable().optional(),
});

/** Ownership is checked on every verb — the id alone is not authorisation. */
async function owned(conversationId: string, userId: string) {
  const [row] = await db
    .select({ id: conversations.id, title: conversations.title })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
    .limit(1);
  return row ?? null;
}

/**
 * The active branch of a conversation.
 *
 * Branching is a linked list: every message points at the one before it on its
 * own branch, so editing an old turn forks the list instead of rewriting it and
 * the original stays reachable. Walking back from the newest leaf yields
 * exactly the path the user is looking at.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireUser();
  if (!session.ok) return session.response;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }

  const conversation = await owned(id, session.user.id);
  if (!conversation) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const all: StoredMessage[] = await db
    .select({
      id: messages.id,
      parentId: messages.parentId,
      role: messages.role,
      parts: messages.parts,
      status: messages.status,
      error: messages.error,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt));

  if (new URL(request.url).searchParams.get('format') === 'export') {
    return exportResponse(conversation.title, id, all);
  }

  const byId = new Map(all.map((m) => [m.id, m]));
  const children = new Map<string, StoredMessage[]>();
  for (const m of all) {
    if (!m.parentId) continue;
    const list = children.get(m.parentId) ?? [];
    list.push(m);
    children.set(m.parentId, list);
  }

  // The active path hangs off the newest message that has no successors.
  let leaf: StoredMessage | undefined = all.at(-1);
  for (let guard = 0; leaf && guard < all.length + 1; guard++) {
    const kids = children.get(leaf.id);
    if (!kids?.length) break;
    leaf = kids.at(-1);
  }

  const path: StoredMessage[] = [];
  let cursor: StoredMessage | undefined = leaf;
  for (let guard = 0; cursor && guard < all.length + 1; guard++) {
    path.unshift(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }

  return NextResponse.json({
    conversation,
    messages: path.map((m) => ({
      id: m.id,
      role: m.role,
      parts: m.parts,
      status: m.status,
      error: m.error,
      createdAt: m.createdAt,
      /** More than one successor means this turn was forked. */
      branchCount: children.get(m.id)?.length ?? 0,
    })),
    branchPoints: all.length - path.length,
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireUser();
  if (!session.ok) return session.response;

  const { id } = await params;
  if (!(await owned(id, session.user.id))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const [row] = await db
    .update(conversations)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(conversations.id, id))
    .returning({
      id: conversations.id,
      title: conversations.title,
      folder: conversations.folder,
      pinned: conversations.pinned,
      archived: conversations.archived,
    });

  return NextResponse.json({ conversation: row });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireUser();
  if (!session.ok) return session.response;

  const { id } = await params;
  if (!(await owned(id, session.user.id))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Storage objects do not cascade with the row, so the paths are collected
  // before the delete — afterwards there is nothing left to query.
  const paths = (
    await db
      .select({ storagePath: attachments.storagePath })
      .from(attachments)
      .where(eq(attachments.conversationId, id))
  ).map((a) => a.storagePath);

  // Messages, attachments and tool rows all cascade from here.
  await db.delete(conversations).where(eq(conversations.id, id));

  // Best effort: the conversation is already gone, so a storage hiccup must not
  // turn a successful delete into an error the user sees.
  await Promise.all(paths.map((p) => remove(p, session.user.id)));

  return NextResponse.json({ ok: true });
}

/**
 * Flattens a conversation into Markdown — the format people actually want when
 * they copy a chat somewhere else.
 */
function exportResponse(title: string, id: string, rows: StoredMessage[]) {
  const lines = [`# ${title}`, ''];

  for (const row of rows) {
    const text = (Array.isArray(row.parts) ? row.parts : [])
      .filter((p): p is { type: 'text'; text: string } =>
        Boolean(p && typeof p === 'object' && (p as { type?: string }).type === 'text'),
      )
      .map((p) => p.text)
      .join('')
      .trim();
    if (!text) continue;

    lines.push(`**${row.role === 'user' ? 'คุณ' : row.role}**`, '', text, '');
  }

  return new Response(lines.join('\n'), {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      // HTTP headers must be ByteString, so a Thai title cannot go in the plain
      // `filename` — the ASCII fallback carries the id and `filename*` the real
      // name per RFC 5987.
      'content-disposition': `attachment; filename="conversation-${slug(id)}.md"; filename*=UTF-8''${encodeURIComponent(`${slug(title)}.md`)}`,
    },
  });
}

/** ASCII-only: this is what lands in the `filename` fallback. */
function slug(text: string): string {
  const cleaned = text
    .replace(/[^\p{ASCII}\w\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return cleaned || 'conversation';
}
