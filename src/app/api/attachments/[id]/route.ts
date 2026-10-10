import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/api/auth';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { attachments, conversations, messages } from '@/lib/db/schema';
import { download } from '@/lib/storage';

/**
 * Serves one attachment back to its owner.
 *
 * The bucket is private, so this is the only way the browser can see a file it
 * uploaded. It is addressed by the attachment id rather than the storage path:
 * the path is an internal detail, and checking it here means a caller cannot
 * guess their way to someone else's file by constructing a path.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireUser();
  if (!session.ok) return session.response;

  const { id } = await params;

  const [row] = await db
    .select({
      storagePath: attachments.storagePath,
      fileName: attachments.fileName,
      mime: attachments.mime,
      sizeBytes: attachments.sizeBytes,
    })
    .from(attachments)
    // Two joins rather than trusting the storage path prefix: ownership has to
    // hold even if a row were ever stored with a foreign path.
    .innerJoin(
      conversations,
      eq(attachments.conversationId, conversations.id),
    )
    .innerJoin(messages, eq(attachments.messageId, messages.id))
    .where(
      and(
        eq(attachments.id, id),
        eq(conversations.userId, session.user.id),
      ),
    )
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await download(row.storagePath, session.user.id);
  } catch {
    return NextResponse.json({ error: 'unreadable' }, { status: 502 });
  }

  // RFC 5987 encoding: a Thai or emoji filename is not representable in the
  // plain `filename=` parameter, and a raw byte in a header is rejected outright.
  const name = row.fileName ?? 'file';
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return new NextResponse(buffer, {
    headers: {
      'content-type': row.mime || 'application/octet-stream',
      'content-length': String(buffer.byteLength),
      'content-disposition': `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'cache-control': 'private, max-age=3600',
    },
  });
}