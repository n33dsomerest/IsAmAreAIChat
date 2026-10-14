import { NextResponse } from 'next/server';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { UIMessage } from 'ai';

import { requireUser } from '@/lib/api/auth';
import { buildFallbackChain } from '@/lib/ai/resolve';
import { generateWithFallback } from '@/lib/ai/generate';
import { buildToolSet } from '@/lib/ai/tool-registry';
import { sweepIfDue } from '@/lib/credits/sweep-usage';
import { ARTIFACT_INSTRUCTIONS, extractArtifacts, type Artifact } from '@/lib/chat/artifacts';
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
import logger from '@/lib/logger';

/**
 * Vercel Hobby allows 300s; the previous 60 was our own declaration rather than
 * a platform limit, and it was cutting off turns that used tools — those run
 * 2+ minutes because every tool call is a round trip back through the model.
 */
export const maxDuration = 300;

/** How often to poke an idle stream. Matches the usual SSE keep-alive interval. */
const HEARTBEAT_MS = 10_000;

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
    logger.warn({ issues: parsed.error.issues }, 'invalid chat request');
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

  logger.info(
    { userId: user.id, modelId, conversationId: conversationIdResolved ?? 'new', messageCount: uiMessages.length },
    'chat request started',
  );
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
  // Turns killed at the platform's duration limit never reach their own
  // settle(), so their credits would be held forever. Reclaim any that have
  // aged out before adding to the pile.
  void sweepIfDue();

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
    logger.warn({ userId: user.id, reason: result?.reason }, 'credit charge denied');
    const denial = DENIAL[result?.reason ?? ''] ?? {
      status: 400,
      message: 'ไม่สามารถใช้เครดิตได้',
    };
    return NextResponse.json({ error: result?.reason ?? 'unknown' }, { status: denial.status });
  }

  logger.info({ userId: user.id, balance: result.balance, usageEventId: result.usage_event_id }, 'credit charged');

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
    //
    // The client already sends a `file` ref for its own optimistic render, so
    // appending the row-derived ref wrote the same attachment to the message
    // twice. Nothing looked wrong until a reload, when history drew both — and
    // `toModelMessages` reads this array, so the model was handed the image
    // twice too. The row is authoritative, so it replaces whatever the client
    // sent rather than sitting alongside it.
    const clientParts = (userMessage?.parts ?? []).filter(
      (p) => (p as { type?: string } | null)?.type !== 'file',
    );
    const storedParts = [
      ...clientParts,
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

    // Every turn hangs off the one before it, because that chain is the only
    // thing the history reader walks. Writing the user turn without a parent
    // left it as its own root, and a reader starting from the newest leaf could
    // never reach past the previous exchange — older turns were still in the
    // table, just invisible.
    const [tip] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.conversationId, conversationIdResolved))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(1);

    const storedUser = await db
      .insert(messages)
      .values({
        conversationId: conversationIdResolved,
        parentId: tip?.id ?? null,
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
    // Every chat arrives here already existing and holding "แชทใหม่": `/` resolves
    // a draft up front so attachments have something to hang off, and this route
    // is what turns that draft into a named conversation. Naming it here costs
    // nothing extra — the first user turn is already in hand.
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
    // Download in parallel to avoid sequential latency for multi-file uploads.
    const inlineFiles = new Map<string, InlineAttachment>();

    // First pass: add text-extracted files immediately (no download needed)
    for (const a of usedAttachments) {
      if (a.extractedText) {
        inlineFiles.set(a.id, {
          attachmentId: a.id,
          name: a.fileName ?? 'ไฟล์',
          kind: a.kind,
          mime: a.mime,
          text: a.extractedText,
        });
      }
    }

    // Second pass: download binary files in parallel
    const binaryAttachments = usedAttachments.filter(
      (a) => !a.extractedText && a.sizeBytes <= MAX_INLINE_BYTES,
    );

    if (binaryAttachments.length > 0) {
      const downloadResults = await Promise.allSettled(
        binaryAttachments.map(async (a) => {
          const buffer = await download(a.storagePath, user.id);
          return {
            attachmentId: a.id,
            name: a.fileName ?? 'ไฟล์',
            kind: a.kind,
            mime: a.mime,
            data: toBase64(buffer),
          } as InlineAttachment;
        }),
      );

      for (const [index, result] of downloadResults.entries()) {
        if (result.status === 'fulfilled') {
          inlineFiles.set(binaryAttachments[index].id, result.value);
        } else {
          // A file that cannot be read must not fail the whole message — the
          // text still goes through and toModelMessages notes the omission.
          logger.warn(
            { storagePath: binaryAttachments[index].storagePath, error: String(result.reason) },
            'attachment unreadable',
          );
        }
      }
    }

    // Artifacts arrive as fenced blocks inside the text rather than as tool
    // calls, so there is nothing to buffer while streaming; they are split out
    // at `finish`.
    const failures: string[] = [];
    let attemptCount = 0;
    const result_ = await generateWithFallback({
      chain,
      // The refs have to reach the model as well as the database.
      // `toModelMessages` is what turns a ref plus its bytes into a real file
      // part, and it reads them off the history it is handed — sending the raw
      // request messages meant the attachment was stored, linked, and then
      // silently never sent.
      messages: uiMessages.length
        ? (uiMessages.map((m, i) =>
            i === uiMessages.length - 1 ? { ...m, parts: storedParts } : m,
          ) as UIMessage[])
        : uiMessages,
      systemPrompt: wantArtifacts
        ? `${systemPrompt ?? DEFAULT_SYSTEM_PROMPT}\n\n${ARTIFACT_INSTRUCTIONS}`
        : (systemPrompt ?? DEFAULT_SYSTEM_PROMPT),
      temperature,
      maxOutputTokens,
      tools,
      files: inlineFiles,
      abortSignal: abortController.signal,
      onAttemptFailed: (model, error) => {
        attemptCount++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        failures.push(`${model.displayName} (${model.providerName}): ${errorMsg}`);
        logger.warn(
          { attempt: attemptCount, model: model.displayName, provider: model.providerName, error: errorMsg },
          'model attempt failed, falling back',
        );
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

    /**
     * A comment line, which SSE defines as keep-alive and every client ignores.
     *
     * Turns that use tools can go quiet for a minute or more between chunks —
     * a tool runs, then the model reads the result and starts thinking again.
     * Vercel sends HTTP/2 PING frames to keep such connections open, but
     * HTTP/1.1 has no equivalent, and proxies along the way can close a silent
     * connection. That shows up as an answer that stops mid-sentence with no
     * error anywhere.
     */
    const heartbeat = () => encoder.encode(': ping\n\n');

    let lastWrite = Date.now();
    let streamController: TransformStreamDefaultController | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    const stopHeartbeat = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    };

    heartbeatTimer = setInterval(() => {
      // Only while genuinely idle: a stream that is producing output has no
      // need for one, and writes are what we are protecting.
      if (!streamController || Date.now() - lastWrite < HEARTBEAT_MS) return;
      try {
        streamController.enqueue(heartbeat());
        lastWrite = Date.now();
      } catch {
        // The client is gone; the abort path will settle the turn.
        stopHeartbeat();
      }
    }, HEARTBEAT_MS);
    heartbeatTimer.unref?.();

    // Accumulated so the assistant turn can be persisted once, at the end.
    let answer = '';
    const parts: unknown[] = [];

    const stream = result_.stream.pipeThrough(
      new TransformStream({
        start(controller) {
          streamController = controller;
        },
        // Async on purpose: the `finish` event must not reach the client before
        // the turn is durable, or a refresh straight afterwards loses it.
        async transform(chunk, controller) {
          lastWrite = Date.now();
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

            // ```artifact fences are pulled out here and sent to the browser so the
            // transcript renders artifacts immediately instead of waiting for a reload.
            const segments = extractArtifacts(answer).segments;
            const partsWithText = segments.map((s) =>
              s.type === 'text'
                ? { type: 'text', text: s.text }
                : { type: 'artifact', artifact: s.artifact },
            );

            await persistAssistant(
              partsWithText,
              result_.winner,
              u?.inputTokens,
              u?.outputTokens,
              conversationIdResolved,
              storedUser[0].id,
            );

            controller.enqueue(sse({ type: 'parts', parts: partsWithText }));

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
        flush() {
          stopHeartbeat();
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
