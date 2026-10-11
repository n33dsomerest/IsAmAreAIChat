import { NextResponse } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { UIMessage } from 'ai';

import { requireUser } from '@/lib/api/auth';
import { buildFallbackChain } from '@/lib/ai/resolve';
import { generateWithFallback } from '@/lib/ai/generate';
import { buildToolSet } from '@/lib/ai/tool-registry';
import { artifactTools, extractArtifacts, type Artifact } from '@/lib/chat/artifacts';
import {
  DEFAULT_SYSTEM_PROMPT,
  MAX_INLINE_BYTES,
  PLACEHOLDER_TITLES,
  deriveTitle,
  textOf,
  type AttachmentRef,
  type InlineAttachment,
} from '@/lib/chat/history';
import { db } from '@/lib/db';
import { artifacts, attachments, conversations, messages, usageEvents } from '@/lib/db/schema';
import { download, toBase64 } from '@/lib/storage';

export const maxDuration = 60;

/**
 * The quota day. Must stay `to_char(created_at AT TIME ZONE 'utc')` to match the
 * SQL functions that increment and restore the daily counter.
 */
const day = () => new Date().toISOString().slice(0, 10);

const requestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  modelId: z.string().uuid(),
  messages: z
    .array(
      z.object({
        id: z.string().optional(),
        role: z.enum(['user', 'assistant', 'system']),
        parts: z.array(z.unknown()).default([]),
      }),
    )
    .min(1)
    .max(200),
  systemPrompt: z.string().max(8000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().positive().max(32000).optional(),
  /** Off by default: search is the one tool that costs a third-party call. */
  webSearch: z.boolean().default(false),
  /** Lets the model produce artifacts for this turn. */
  artifacts: z.boolean().default(true),
  /**
   * Attachments uploaded for this turn. They were stored before the message
   * existed, so this is where they get attached to one.
   */
  attachmentIds: z.array(z.string().uuid()).max(10).default([]),
});

type CreditRow = {
  ok: boolean;
  reason: string | null;
  balance: number;
  usage_event_id: string | null;
};

const DENIAL: Record<string, { status: number; message: string }> = {
  no_credits: { status: 402, message: 'เครดิตไม่พอ — เติมเครดิตเพื่อใช้งานต่อ' },
  daily_quota: { status: 429, message: 'ครบโควตาของวันนี้แล้ว — ลองใหม่พรุ่งนี้' },
  banned: { status: 403, message: 'บัญชีถูกระงับการใช้งาน' },
  user_not_found: { status: 401, message: 'ไม่พบผู้ใช้' },
};

export async function POST(request: Request) {
  const session = await requireUser();
  if (!session.ok) return session.response;

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const {
    conversationId,
    modelId,
    messages: incoming,
    systemPrompt,
    temperature,
    maxOutputTokens,
    webSearch,
    artifacts: wantArtifacts,
    attachmentIds,
  } = parsed.data;
  const user = session.user;
  const uiMessages = incoming as UIMessage[];

  /* ── 1. the conversation must belong to this user ───────────────────────── */
  let conversationIdResolved = conversationId;
  if (conversationId) {
    const [owned] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.userId, user.id),
        ),
      )
      .limit(1);
    if (!owned) {
      return NextResponse.json({ error: 'conversation_not_found' }, { status: 404 });
    }
  }

  /* ── 2. charge first: no token is produced without a debit ─────────────── */
  const charged = await db.execute(sql`
    select * from public.consume_credit(
      ${user.id}::uuid,
      ${conversationIdResolved ?? null}::uuid,
      ${modelId}::uuid,
      ${day()}
    )
  `);

  const result = (Array.isArray(charged) ? charged[0] : charged) as unknown as CreditRow;
  if (!result?.ok) {
    const denial = DENIAL[result?.reason ?? ''] ?? {
      status: 400,
      message: 'ไม่สามารถใช้เครดิตได้',
    };
    return NextResponse.json({ error: result?.reason ?? 'unknown' }, { status: denial.status });
  }

  const usageEventId = result.usage_event_id!;
  let settled = false;

  /** Idempotent: an abort can fire after the happy path already settled. */
  async function settle(error: string | null, usage?: {
    inputTokens?: number;
    outputTokens?: number;
    latencyMs?: number;
  }) {
    if (settled) return;
    settled = true;
    try {
      await db.execute(sql`
        select public.complete_usage(
          ${usageEventId}::uuid,
          ${usage?.inputTokens ?? 0}::integer,
          ${usage?.outputTokens ?? 0}::integer,
          0::integer,
          ${usage?.latencyMs ?? 0}::integer,
          0::numeric,
          ${error}::text
        )
      `);
    } catch {
      // Never let settlement bookkeeping turn a delivered answer into an error.
    }
  }

  const startedAt = Date.now();
  const abortController = new AbortController();

  /**
   * Writes the assistant turn once the stream is done.
   *
   * Best effort on purpose: a write failure here must not turn an answer the
   * user is already reading into an error.
   */
  async function persistAssistant(
    parts: unknown[],
    winner: {
      id: string;
      providerId: string;
      remoteModelId: string;
      providerName: string;
      displayName: string;
    },
    inputTokens?: number,
    outputTokens?: number,
    targetConversationId?: string,
    parentMessageId?: string,
  ) {
    try {
      const [row] = await db
        .insert(messages)
        .values({
          conversationId: targetConversationId!,
          parentId: parentMessageId ?? null,
          role: 'assistant',
          parts,
          modelSnapshot: {
            modelId: winner.id,
            providerId: winner.providerId,
            remoteModelId: winner.remoteModelId,
            providerName: winner.providerName,
            displayName: winner.displayName,
          },
          usage: { inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 },
          creditsCost: 1,
          status: 'complete',
        })
        .returning({ id: messages.id });

      // Artifacts get their own rows so they can be listed and shared without
      // re-reading the message that produced them.
      const artifactParts = parts.filter(
        (p): p is { type: 'artifact'; artifact: Artifact } =>
          Boolean(p && typeof p === 'object' && (p as { type?: string }).type === 'artifact'),
      );

      if (artifactParts.length) {
        await db.insert(artifacts).values(
          artifactParts.map((p) => ({
            messageId: row.id,
            title: p.artifact.title,
            language: p.artifact.language,
            source: p.artifact.source,
          })),
        );
      }
    } catch {
      /* keep the delivered answer */
    }
  }


  try {
    /* ── 3. persist the user's turn before we spend anything on it ────────── */
    const userMessage = uiMessages.at(-1);
    const userText = textOf(userMessage?.parts as UIMessage['parts'] | undefined);
    if (!conversationIdResolved) {
      const [created] = await db
        .insert(conversations)
        .values({
          userId: user.id,
          title: deriveTitle(userText),
          modelId,
          systemPrompt: systemPrompt ?? null,
        })
        .returning({ id: conversations.id });
      conversationIdResolved = created.id;
      await db.execute(sql`
        update public.usage_events
           set conversation_id = ${conversationIdResolved}::uuid
         where id = ${usageEventId}::uuid
      `);
    }

    await db
      .update(conversations)
      .set({ updatedAt: new Date(), modelId })
      .where(eq(conversations.id, conversationIdResolved));

    /* ── 3a. resolve the uploads this turn is sending ──────────────────────── */
    // Scoped to this conversation, which is already proven to be the caller's,
    // so an id from another user simply does not match and is dropped rather
    // than being an error the user cannot act on.
    const usedAttachments = attachmentIds.length
      ? await db
          .select({
            id: attachments.id,
            fileName: attachments.fileName,
            mime: attachments.mime,
            sizeBytes: attachments.sizeBytes,
            kind: attachments.kind,
            storagePath: attachments.storagePath,
            extractedText: attachments.extractedText,
          })
          .from(attachments)
          .where(
            and(
              inArray(attachments.id, attachmentIds),
              eq(attachments.conversationId, conversationIdResolved),
            ),
          )
      : [];

    // Metadata goes on the message so history can re-render the attachment; the
    // bytes stay in Storage and are only fetched if a model can use them.
    const storedParts = [
      ...(userMessage?.parts ?? []),
      ...usedAttachments.map(
        (a): AttachmentRef => ({
          type: 'file',
          attachmentId: a.id,
          name: a.fileName ?? 'ไฟล์',
          kind: a.kind,
          mime: a.mime,
          sizeBytes: a.sizeBytes,
        }),
      ),
    ];

    const storedUser = await db
      .insert(messages)
      .values({
        conversationId: conversationIdResolved,
        role: 'user',
        parts: storedParts,
        status: 'complete',
      })
      .returning({ id: messages.id });

    /* ── 3b. attach this turn's uploads to the message they belong to ──────── */
    // Uploads land before the message does, so `attachments.message_id` was
    // always NULL and nothing could ever find them again. Linking here is what
    // makes the file renderable in history after a reload.
    if (usedAttachments.length) {
      await db
        .update(attachments)
        .set({ messageId: storedUser[0].id })
        .where(
          and(
            inArray(attachments.id, usedAttachments.map((a) => a.id)),
            eq(attachments.conversationId, conversationIdResolved),
          ),
        );
    }

    /* ── 3c. name the conversation after its first prompt ─────────────────── */
    // The client creates the conversation up front so uploads have something to
    // hang off, which leaves every chat titled "แชทใหม่" forever. Naming it here
    // costs nothing extra — the first user turn is already in hand.
    //
    // The title predicate is the whole safety of this: it only fires while the
    // row still holds a placeholder, so a name the user typed through PATCH is
    // never overwritten.
    if (userText.trim()) {
      await db
        .update(conversations)
        .set({ title: deriveTitle(userText) })
        .where(
          and(
            eq(conversations.id, conversationIdResolved),
            inArray(conversations.title, [...PLACEHOLDER_TITLES]),
          ),
        );
    }

    /* ── 4. walk the fallback chain ───────────────────────────────────────── */
    const chain = await buildFallbackChain(modelId);

    // Built once per request: MCP handshakes are cached inside the client.
    const tools = await buildToolSet({ webSearch });

    /* ── 4a. fetch the bytes for files a model could actually read ─────────── */
    // Only binary files need downloading; text was extracted at upload time.
    // The size cap is what stops a 20 MB upload from becoming a 27 MB prompt.
    const inlineFiles = new Map<string, InlineAttachment>();
    for (const a of usedAttachments) {
      if (a.extractedText) {
        inlineFiles.set(a.id, {
          attachmentId: a.id,
          name: a.fileName ?? 'ไฟล์',
          kind: a.kind,
          mime: a.mime,
          text: a.extractedText,
        });
        continue;
      }
      if (a.sizeBytes > MAX_INLINE_BYTES) continue;

      try {
        const buffer = await download(a.storagePath, user.id);
        inlineFiles.set(a.id, {
          attachmentId: a.id,
          name: a.fileName ?? 'ไฟล์',
          kind: a.kind,
          mime: a.mime,
          data: toBase64(buffer),
        });
      } catch {
        // A file that cannot be read must not fail the whole message — the
        // text still goes through and toModelMessages notes the omission.
        console.error('[chat] attachment unreadable:', a.storagePath);
      }
    }

    // Artifacts created by the tool land here and are streamed as their own
    // parts so the renderer can put them beside the prose.
    const produced: Artifact[] = [];
    let emitted = 0;
    if (wantArtifacts) Object.assign(tools, artifactTools((a) => produced.push(a)));

    const failures: string[] = [];
    const result_ = await generateWithFallback({
      chain,
      // The refs have to reach the model as well as the database. `toModelMessages`
      // is what turns a ref plus its bytes into a real file part, and it reads
      // them off the history it is handed — sending the raw request messages
      // meant the attachment was stored, linked, and then silently never sent.
      messages: uiMessages.length
        ? (uiMessages.map((m, i) =>
            i === uiMessages.length - 1 ? { ...m, parts: storedParts } : m,
          ) as UIMessage[])
        : uiMessages,
      systemPrompt: systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      temperature,
      maxOutputTokens,
      tools,
      files: inlineFiles,
      abortSignal: abortController.signal,
      onAttemptFailed: (_model, error) => {
        failures.push(error instanceof Error ? error.message : String(error));
      },
    });

    await db
      .update(usageEvents)
      .set({
        messageId: storedUser[0].id,
        providerId: result_.winner.providerId,
        remoteModelId: result_.winner.remoteModelId,
        providerName: result_.winner.providerName,
        attempts: result_.attempts,
      })
      .where(eq(usageEvents.id, usageEventId));

    /* ── 5. stream, then settle ──────────────────────────────────────────── */
    const encoder = new TextEncoder();

    /** Wraps one AI SDK part as a server-sent event. */
    const sse = (payload: unknown) =>
      encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

    // Accumulated so the assistant turn can be persisted once, at the end.
    let answer = '';
    const parts: unknown[] = [];

    const stream = result_.stream.pipeThrough(
      new TransformStream({
        // Async on purpose: the `finish` event must not reach the client before
        // the turn is durable, or a refresh straight afterwards loses it.
        async transform(chunk, controller) {
          const type = chunk.type;

          if (type === 'text-start' || type === 'text-delta' || type === 'text-end') {
            if (type === 'text-delta') answer += chunk.text;
            if (type === 'text-start') parts.push({ type: 'text', text: '' });
            controller.enqueue(sse({ ...chunk }));
            return;
          }

          if (type === 'reasoning-delta') {
            controller.enqueue(sse({ ...chunk }));
            return;
          }
          if (type === 'reasoning-start' || type === 'reasoning-end') {
            controller.enqueue(sse({ ...chunk }));
            return;
          }

          // Tool lifecycle: the UI shows what the assistant is doing.
          if (type === 'tool-result') {
            controller.enqueue(sse({ ...(chunk as object) }));
            // Emit only what has not been sent yet — the array is still needed
            // at `finish`, where every artifact gets persisted.
            for (const artifact of produced.slice(emitted)) {
              controller.enqueue(sse({ type: 'artifact', artifact }));
            }
            emitted = produced.length;
            return;
          }
          if (type.startsWith('tool-')) {
            controller.enqueue(sse({ ...(chunk as object) }));
            return;
          }

          if (type === 'finish') {
            const u = chunk.totalUsage;
            void settle(null, {
              inputTokens: u?.inputTokens,
              outputTokens: u?.outputTokens,
              latencyMs: Date.now() - startedAt,
            });

            // Inline ```artifact fences are pulled out here rather than in the
            // browser, so what gets stored is already split.
            const segments = extractArtifacts(answer).segments;
            const partsWithText = [
              ...segments.map((s) =>
                s.type === 'text'
                  ? { type: 'text', text: s.text }
                  : { type: 'artifact', artifact: s.artifact },
              ),
            ];

            for (const artifact of produced) {
              partsWithText.push({ type: 'artifact', artifact });
            }

            await persistAssistant(
              partsWithText,
              result_.winner,
              u?.inputTokens,
              u?.outputTokens,
              conversationIdResolved,
              storedUser[0].id,
            );

            controller.enqueue(
              sse({ type: 'finish', model: result_.winner.displayName, provider: result_.winner.providerName }),
            );
            return;
          }

          if (type === 'abort') {
            // The client hung up or the platform cut the connection: the user
            // never got a complete answer, so give the credit back.
            void settle('aborted');
            return;
          }

          if (type === 'error') {
            void settle(String((chunk as { error?: unknown }).error ?? 'stream error'));
            controller.enqueue(sse({ type: 'error' }));
          }
        },
      }),
    );

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-conversation-id': conversationIdResolved,
        'x-model-name': result_.winner.displayName,
        'x-credits-remaining': String(result.balance),
        'x-provider': result_.winner.providerName,
        ...(failures.length ? { 'x-fallbacks': String(failures.length) } : {}),
      },
    });
  } catch (error) {
    await settle(error instanceof Error ? error.message : 'generation failed');
    return NextResponse.json(
      { error: 'generation_failed', message: error instanceof Error ? error.message : 'unknown' },
      { status: 502 },
    );
  }
}
