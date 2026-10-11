import { asc, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { messages } from '@/lib/db/schema';
import { SITE } from '@/lib/site-config';
import type { FilePart, ModelMessage, TextPart, UIMessage } from 'ai';
import type { ModelCapabilities } from '@/lib/db/schema';

export const DEFAULT_SYSTEM_PROMPT = `You are ${SITE.name}, a helpful AI assistant.

Answer in the user's language. Be concise and concrete — prefer an example or a
table over a paragraph when it is clearer. If you are unsure about something, say
so rather than guessing.`;

/**
 * An attachment as it is stored on the user message and re-rendered in history.
 * Only the metadata lives in `messages.parts`; the bytes stay in Storage.
 */
export type AttachmentRef = {
  type: 'file';
  attachmentId: string;
  name: string;
  kind: 'image' | 'pdf' | 'text';
  mime: string;
  sizeBytes: number;
};

/**
 * What actually lives in `messages.parts`.
 *
 * Wider than `UIMessage['parts']` on purpose: an attachment reference is not a
 * UI part (it has no url and nothing to render), it is our own record pointing
 * at Storage. Reading code should narrow through `attachmentRefs` rather than
 * assume every part came from the UI.
 */
export type StoredPart = UIMessage['parts'][number] | AttachmentRef;

/** An attachment loaded from Storage and ready to hand to a model. */
export type InlineAttachment = {
  attachmentId: string;
  name: string;
  kind: 'image' | 'pdf' | 'text';
  mime: string;
  /** base64 payload — present for images and PDFs small enough to inline. */
  data?: string;
  /** Text pulled out at upload time, for files no model reads as binary. */
  text?: string;
};

/** Raw bytes above this are not sent to a model; the prompt would be absurd. */
export const MAX_INLINE_BYTES = 4 * 1024 * 1024;

/** Pulls the attachment refs back out of a message's stored parts. */
export function attachmentRefs(parts: unknown): AttachmentRef[] {
  if (!Array.isArray(parts)) return [];
  return parts.filter(
    (p): p is AttachmentRef =>
      typeof p === 'object' &&
      p !== null &&
      (p as { type?: string }).type === 'file' &&
      typeof (p as { attachmentId?: string }).attachmentId === 'string',
  );
}

/**
 * Turns stored UI message parts into what the model API wants.
 *
 * Tool calls and result parts are dropped on purpose: they are UI-only here and
 * replaying them to a fresh request would produce invalid history.
 *
 * Attachments are handled per model. A fallback chain runs one prompt through
 * every enabled model, and most of them cannot read an image, so the same
 * message is rebuilt for each candidate: where a model has no vision the image
 * is replaced by a note naming it rather than being sent and rejected. Text
 * files are inlined as text because every model can read those.
 */
export function toModelMessages(
  history: UIMessage[],
  options: {
    files?: Map<string, InlineAttachment>;
    capabilities?: Partial<ModelCapabilities>;
  } = {},
): ModelMessage[] {
  const { files, capabilities } = options;
  const out: ModelMessage[] = [];

  for (const message of history) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;

    const text = message.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
      .trim();

    const refs = attachmentRefs(message.parts);
    const inline = refs
      .map((r) => files?.get(r.attachmentId))
      .filter((f): f is InlineAttachment => Boolean(f));

    const content: Array<TextPart | FilePart> = [];
    if (text) content.push({ type: 'text', text });

    for (const file of inline) {
      // Plain text and extracted documents work on every model.
      if (file.text) {
        content.push({
          type: 'text',
          text: `<file name="${file.name}">\n${file.text}\n</file>`,
        });
        continue;
      }

      const canRead =
        file.kind === 'image'
          ? capabilities?.vision
          : file.kind === 'pdf'
            ? capabilities?.pdf
            : false;

      if (canRead && file.data) {
        content.push({
          type: 'file',
          data: file.data,
          mediaType: file.mime,
          filename: file.name,
        });
      } else if (capabilities?.vision || capabilities?.pdf) {
        // The model reads files, just not this one — say why rather than
        // dropping it silently.
        const why =
          !file.data && !file.text
            ? 'too large to send'
            : file.kind === 'pdf'
              ? 'this model cannot read PDF files'
              : 'this model cannot see images';
        content.push({ type: 'text', text: `[attached "${file.name}" — omitted: ${why}]` });
      }
    }

    if (!content.length) continue;
    // A single text part stays a plain string: it is what every provider is
    // happiest with, and it keeps the request small.
    if (content.length === 1 && content[0].type === 'text') {
      out.push({ role: message.role, content: content[0].text });
    } else {
      out.push({ role: message.role, content });
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

/**
 * Titles a conversation carries before anyone has named it: the client's own
 * placeholder and the schema default. A conversation still holding one of
 * these has not been named by the user, which is what makes it safe to replace
 * the title automatically.
 *
 * Renaming through `PATCH /api/conversations/[id]` moves the row off this list,
 * so an automatic title can never overwrite a name the user chose.
 */
export const PLACEHOLDER_TITLES: readonly string[] = ['แชทใหม่', 'New chat'];

/** The text of a message, ignoring reasoning and other non-text parts. */
export function textOf(parts: { type?: string; text?: unknown }[] | undefined): string {
  if (!parts) return '';
  return parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join(' ');
}