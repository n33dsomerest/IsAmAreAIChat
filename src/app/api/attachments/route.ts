import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { requireUser } from '@/lib/api/auth';
import { db } from '@/lib/db';
import { attachments, conversations } from '@/lib/db/schema';
import { download, upload } from '@/lib/storage';

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
]);

/**
 * Stores an upload against a conversation.
 *
 * Only the path and metadata are kept — never the bytes in the messages table —
 * so the row stays small however large the file is.
 */
export async function POST(request: Request) {
  const session = await requireUser();
  if (!session.ok) return session.response;

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const conversationId = String(form.get('conversationId') ?? '');
  const file = form.get('file');

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'กรุณาเลือกไฟล์' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'ไฟล์ใหญ่เกิน 20 MB' }, { status: 413 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: 'รองรับเฉพาะรูปภาพ, PDF และไฟล์ข้อความ' },
      { status: 415 },
    );
  }

  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, session.user.id)))
    .limit(1);

  if (!conversation) {
    return NextResponse.json({ error: 'conversation_not_found' }, { status: 404 });
  }

  const kind = file.type.startsWith('image/')
    ? ('image' as const)
    : file.type === 'application/pdf'
      ? ('pdf' as const)
      : ('text' as const);

  let stored;
  try {
    stored = await upload(session.user.id, conversationId, file);
  } catch (err) {
    return NextResponse.json(
      { error: 'อัปโหลดไม่สำเร็จ', message: (err as Error).message },
      { status: 502 },
    );
  }

  // Text is extracted up front so a later turn does not re-download the file.
  let extractedText: string | null = null;
  if (kind === 'text') {
    try {
      const buffer = await download(stored.path, session.user.id);
      extractedText = new TextDecoder().decode(buffer).slice(0, 40_000);
    } catch {
      extractedText = null;
    }
  }

  const [row] = await db
    .insert(attachments)
    .values({
      conversationId,
      storagePath: stored.path,
      fileName: file.name || 'file',
      mime: stored.mime,
      sizeBytes: stored.sizeBytes,
      kind,
      extractedText,
    })
    .returning({ id: attachments.id });

  return NextResponse.json(
    {
      id: row.id,
      name: file.name,
      kind,
      mime: stored.mime,
      sizeBytes: stored.sizeBytes,
    },
    { status: 201 },
  );
}