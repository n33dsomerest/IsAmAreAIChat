import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db';
import { providers, providerModels } from '@/lib/db/schema';
import type { ModelCapabilities, ModelPricing } from '@/lib/db/schema';

/** One model as returned by a provider's `/models` endpoint, normalised. */
export type RemoteModel = {
  remoteModelId: string;
  displayName: string;
  contextWindow: number | null;
  maxOutput: number | null;
  capabilities: ModelCapabilities;
  pricing: ModelPricing;
};

type ProviderRow = typeof providers.$inferSelect;

/**
 * OpenRouter is the reference shape. Other OpenAI-compatible gateways vary, so
 * every field is read defensively and anything unrecognised is simply absent
 * rather than fatal.
 */
type RawModel = {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  context_window?: unknown;
  max_tokens?: unknown;
  pricing?: Record<string, unknown>;
  supported_parameters?: unknown;
  architecture?: { input_modalities?: unknown; modality?: unknown };
  capabilities?: Record<string, unknown>;
  top_provider?: { max_completion_tokens?: unknown };
};

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.length ? v : null;

/** `:free` suffixed ids are OpenRouter's no-cost variants. */
export const isFreeModelId = (id: string) => id.endsWith(':free') || id === 'openrouter/free';

function deriveCapabilities(raw: RawModel): ModelCapabilities {
  const params = Array.isArray(raw.supported_parameters)
    ? (raw.supported_parameters as string[])
    : [];
  const declared = raw.capabilities ?? {};

  const modalities = Array.isArray(raw.architecture?.input_modalities)
    ? (raw.architecture.input_modalities as string[])
    : [];

  return {
    vision:
      typeof declared.vision === 'boolean'
        ? declared.vision
        : modalities.includes('image'),
    tools:
      typeof declared.tools === 'boolean'
        ? declared.tools
        : params.includes('tools') || params.includes('tool_choice'),
    reasoning:
      typeof declared.reasoning === 'boolean'
        ? declared.reasoning
        : params.includes('reasoning') || params.includes('include_reasoning'),
    json:
      typeof declared.json === 'boolean'
        ? declared.json
        : params.includes('response_format') || params.includes('structured_outputs'),
    pdf: typeof declared.pdf === 'boolean' ? declared.pdf : modalities.includes('file'),
  };
}

/**
 * OpenRouter reports USD per token; we store USD per 1M tokens because those
 * are the numbers humans compare.
 */
function derivePricing(raw: RawModel): ModelPricing {
  const p = raw.pricing ?? {};
  const perToken = (v: unknown) => {
    const n = num(v);
    return n === null ? undefined : Math.round(n * 1_000_000 * 1e6) / 1e6;
  };

  return {
    input: perToken(p.prompt ?? p.input),
    output: perToken(p.completion ?? p.output),
    cacheRead: perToken(p.input_cache_read),
    cacheWrite: perToken(p.input_cache_write),
    currency: 'USD',
  };
}

export function normalizeModel(raw: RawModel): RemoteModel | null {
  const id = str(raw.id);
  if (!id) return null;

  return {
    remoteModelId: id,
    displayName: str(raw.name) ?? id,
    contextWindow: num(raw.context_length) ?? num(raw.context_window),
    // `max_tokens` is OpenRouter's per-model ceiling; some gateways only report
    // it per upstream provider, hence the second source.
    maxOutput: num(raw.max_tokens) ?? num(raw.top_provider?.max_completion_tokens),
    capabilities: deriveCapabilities(raw),
    pricing: derivePricing(raw),
  };
}

/** Calls the provider's `/models` endpoint. Never throws on auth failure. */
export async function fetchRemoteModels(
  provider: ProviderRow,
  timeoutMs = 20_000,
): Promise<RemoteModel[]> {
  const apiKey = process.env[provider.envKeyName];
  if (!apiKey) {
    throw new Error(`Missing env var ${provider.envKeyName} for provider "${provider.name}"`);
  }

  const base = provider.baseUrl.replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${base}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...provider.headers,
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `${provider.name} returned ${res.status}: ${body.slice(0, 200)}`,
      );
    }

    const json = await res.json();
    const list: RawModel[] = Array.isArray(json)
      ? json
      : Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json?.models)
          ? json.models
          : [];

    return list
      .map((m) => normalizeModel(m as RawModel))
      .filter((m): m is RemoteModel => m !== null);
  } finally {
    clearTimeout(timer);
  }
}

export type SyncOptions = {
  /** Models with a `:free` id default to non-fallback (cheapest first). */
  autoClassifyFallback?: boolean;
  /** Disable rows that disappeared upstream instead of leaving them active. */
  pruneMissing?: boolean;
};

export type SyncResult = {
  fetched: number;
  inserted: number;
  updated: number;
  disabled: number;
  unmatched: number;
};

/**
 * Reconciles the provider's remote catalogue into `provider_models`.
 *
 * Only the network call can fail — once we have the list the write is a single
 * upsert, so re-running is safe and cheap.
 */
export async function syncProviderModels(
  providerId: string,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const { autoClassifyFallback = true, pruneMissing = true } = options;

  const [provider] = await db
    .select()
    .from(providers)
    .where(eq(providers.id, providerId))
    .limit(1);
  if (!provider) throw new Error('Provider not found');

  const remote = await fetchRemoteModels(provider);

  const existing = await db
    .select()
    .from(providerModels)
    .where(eq(providerModels.providerId, providerId));

  const existingById = new Map(existing.map((m) => [m.remoteModelId, m]));

  const result: SyncResult = {
    fetched: remote.length,
    inserted: 0,
    updated: 0,
    disabled: 0,
    unmatched: 0,
  };

  const toInsert: (typeof providerModels.$inferInsert)[] = [];
  const seen = new Set<string>();

  let order = 0;
  for (const model of remote) {
    seen.add(model.remoteModelId);
    const prev = existingById.get(model.remoteModelId);

    const isFallback = autoClassifyFallback
      ? !isFreeModelId(model.remoteModelId)
      : (prev?.isFallback ?? false);

    if (prev) {
      // `.set()` takes one patch, not a batch — updating in a loop keeps the
      // type checker honest and the row count here is small (hundreds).
      await db
        .update(providerModels)
        .set({
          displayName: model.displayName,
          contextWindow: model.contextWindow,
          maxOutput: model.maxOutput,
          capabilities: model.capabilities,
          pricing: model.pricing,
          isFallback,
        })
        .where(eq(providerModels.id, prev.id));
      result.updated++;
    } else {
      toInsert.push({
        providerId,
        remoteModelId: model.remoteModelId,
        displayName: model.displayName,
        contextWindow: model.contextWindow,
        maxOutput: model.maxOutput,
        capabilities: model.capabilities,
        pricing: model.pricing,
        enabled: false,
        isFallback,
        sortOrder: order,
      });
      result.inserted++;
    }
    order++;
  }

  if (toInsert.length) await db.insert(providerModels).values(toInsert);

  if (pruneMissing) {
    const gone = existing.filter((m) => !seen.has(m.remoteModelId) && m.enabled);
    if (gone.length) {
      await db
        .update(providerModels)
        .set({ enabled: false })
        .where(
          and(
            eq(providerModels.providerId, providerId),
            inArray(providerModels.id, gone.map((m) => m.id)),
          ),
        );
      result.disabled = gone.length;
    }
  }

  result.unmatched = existing.length - seen.size;
  return result;
}