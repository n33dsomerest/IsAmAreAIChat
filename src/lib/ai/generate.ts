import 'server-only';

import { streamText, type LanguageModel, type TextStreamPart, type ToolSet, type UIMessage } from 'ai';

import { toModelMessages, type InlineAttachment } from '@/lib/chat/history';
import { DEFAULT_SYSTEM_PROMPT } from '@/lib/chat/history';
import type { ResolvedModel } from '@/lib/ai/resolve';

/** Give up rather than burn the user's time on a chain that keeps failing. */
const MAX_ATTEMPTS = 4;

/** An error that must not be retried — retrying only wastes another provider. */
class NonRetryableError extends Error {}

function isRetryable(error: unknown): boolean {
  if (error instanceof NonRetryableError) return false;

  const message = error instanceof Error ? error.message : String(error);
  // Bad request from the user, or a model id this gateway does not know.
  if (/\b(400|404|422)\b/.test(message)) return false;
  if (/context_length|maximum context|too long/i.test(message)) return false;
  if (/content_policy|safety|blocked/i.test(message)) return false;

  return true;
}

export function textOf(messages: UIMessage[]): string {
  return messages
    .flatMap((m) => m.parts)
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

export type GenerateResult = {
  stream: ReadableStream<TextStreamPart<ToolSet>>;
  /** The attempt that produced the stream — the usage row records this one. */
  winner: ResolvedModel;
  attempts: number;
  /** Errors from the attempts that failed before this one. */
  failures: string[];
};

/**
 * Runs the fallback chain until one model produces a stream.
 *
 * A model only counts as failed if it fails *before* the first chunk: once
 * tokens are on the wire the response is committed and there is nothing left to
 * transparently retry, so the error is surfaced and the caller refunds.
 */
export async function generateWithFallback({
  chain,
  messages,
  systemPrompt = DEFAULT_SYSTEM_PROMPT,
  temperature,
  maxOutputTokens,
  abortSignal,
  tools,
  files,
  onAttemptFailed,
}: {
  chain: ResolvedModel[];
  messages: UIMessage[];
  systemPrompt?: string;
  temperature?: number;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
  tools?: ToolSet;
  /** Attachment payloads, keyed by id, for messages that carry files. */
  files?: Map<string, InlineAttachment>;
  onAttemptFailed?: (model: ResolvedModel, error: unknown) => void;
}): Promise<GenerateResult> {
  if (!chain.length) {
    throw new NonRetryableError('No models are currently available.');
  }

  const failures: string[] = [];
  const budget = Math.min(chain.length, MAX_ATTEMPTS);

  for (let i = 0; i < budget; i++) {
    const candidate = chain[i];

    // Rebuilt per candidate, not once up front: the chain mixes models with and
    // without vision, and sending an image to one that cannot read it would
    // fail the request instead of falling through to the next model.
    const modelMessages = toModelMessages(messages, {
      files,
      capabilities: candidate.capabilities,
    });

    try {
      const result = streamText({
        model: candidate.model as LanguageModel,
        system: systemPrompt,
        messages: modelMessages,
        temperature,
        maxOutputTokens,
        tools,
        abortSignal,
        onError: ({ error }) => {
          onAttemptFailed?.(candidate, error);
        },
      });

      // Consume the head of the stream so a connection failure surfaces here,
      // before we commit to this model, and not three chunks into the response.
      const reader = result.fullStream.getReader();
      const first = await reader.read();
      if (first.done) {
        throw new NonRetryableError('The model returned an empty response.');
      }

      // The first chunk has been taken off the SDK's stream, so the caller gets
      // a new stream seeded with it rather than the original — handing back
      // `result` here would lose everything we just read.
      const stream = new ReadableStream<TextStreamPart<ToolSet>>({
        start(controller) {
          controller.enqueue(first.value);
        },
        async pull(controller) {
          const next = await reader.read();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        },
        cancel(reason) {
          void reader.cancel(reason);
        },
      });

      return { stream, winner: candidate, attempts: i + 1, failures };
    } catch (error) {
      const label = `${candidate.displayName} (${candidate.providerName})`;
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(`${label}: ${reason}`);
      onAttemptFailed?.(candidate, error);

      if (!isRetryable(error)) {
        throw new Error(
          `${failures.length} model(s) tried — ${failures.join('; ')}`,
          { cause: error },
        );
      }
    }
  }

  throw new Error(`ทุกโมเดลล้มเหลว — ${failures.join('; ')}`);
}