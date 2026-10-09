import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { UIMessage } from 'ai';

import { requireUser } from '@/lib/api/auth';
import { buildFallbackChain } from '@/lib/ai/resolve';
import { generateWithFallback } from '@/lib/ai/generate';
import { DEFAULT_SYSTEM_PROMPT, deriveTitle } from '@/lib/chat/history';
import { db } from '@/lib/db';
import { conversations, messages, usageEvents } from '@/lib/db/schema';

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

  const { conversationId, modelId, messages: incoming, systemPrompt, temperature, maxOutputTokens } =
    parsed.data;
  const user = session.user;
  const uiMessages = incoming as UIMessage[];

  /* ── 1. the conversation must belong to this user ───────────────────────── */
  let conversationIdResolved = conversationId;
  if (conversationId) {
    const [owned] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
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
    winner: { id: string; providerId: string; remoteModelId: string; providerName: string; displayName: string },
    inputTokens?: number,
    outputTokens?: number,
  ) {
    try {
      await db.insert(messages).values({
        conversationId: conversationIdResolved!,
        parentId: lastUserMessageId,
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
      });
    } catch {
      /* keep the delivered answer */
    }
  }

  let lastUserMessageId: string | null = null;

  try {
    /* ── 3. persist the user's turn before we spend anything on it ────────── */
    const userMessage = uiMessages.at(-1);
    if (!conversationIdResolved) {
      const [created] = await db
        .insert(conversations)
        .values({
          userId: user.id,
          title: deriveTitle(
            userMessage?.parts
              .filter((p): p is { type: 'text'; text: string } => (p as { type?: string }).type === 'text')
              .map((p) => (p as { text: string }).text)
              .join(' ') ?? '',
          ),
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

    const storedUser = await db
      .insert(messages)
      .values({
        conversationId: conversationIdResolved,
        role: 'user',
        parts: userMessage?.parts ?? [],
        status: 'complete',
      })
      .returning({ id: messages.id });

    lastUserMessageId = storedUser[0].id;

    /* ── 4. walk the fallback chain ───────────────────────────────────────── */
    const chain = await buildFallbackChain(modelId);

    const failures: string[] = [];
    const result_ = await generateWithFallback({
      chain,
      messages: uiMessages,
      systemPrompt: systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      temperature,
      maxOutputTokens,
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
        transform(chunk, controller) {
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

          if (type === 'finish') {
            const u = chunk.totalUsage;
            void settle(null, {
              inputTokens: u?.inputTokens,
              outputTokens: u?.outputTokens,
              latencyMs: Date.now() - startedAt,
            });
            const partsWithText = parts.map((p) =>
              p && typeof p === 'object' && 'text' in p
                ? { ...p, text: answer }
                : p,
            );
            void persistAssistant(partsWithText, result_.winner, u?.inputTokens, u?.outputTokens);
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