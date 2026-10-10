import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { providers, providerModels } from '@/lib/db/schema';
import type { ModelCapabilities } from '@/lib/db/schema';

export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigError';
  }
}

export type ResolvedModel = {
  /** `provider_models.id` - what usage rows record, not the remote id. */
  id: string;
  providerId: string;
  model: LanguageModel;
  providerName: string;
  displayName: string;
  remoteModelId: string;
  /**
   * Needed at generation time, not just for display: a fallback chain can run
   * the same prompt through a dozen models with different abilities, so the
   * caller has to know whether the current candidate can read images before it
   * decides whether to send them.
   */
  capabilities: ModelCapabilities;
};

type ProviderRow = typeof providers.$inferSelect;

/**
 * API keys live in server env vars, referenced by name from
 * `providers.env_key_name`, so no key is ever stored in the database or sent
 * to the browser.
 */
function readKey(envKeyName: string): string {
  const key = process.env[envKeyName];
  if (!key) {
    throw new ProviderConfigError(
      `Missing API key: set ${envKeyName} in the server environment.`,
    );
  }
  return key;
}

function chatFactory(provider: ProviderRow) {
  const apiKey = readKey(provider.envKeyName);
  const baseURL = provider.baseUrl.replace(/\/+$/, '');
  const headers = provider.headers;

  switch (provider.kind) {
    case 'anthropic':
      return createAnthropic({ apiKey, baseURL, headers });
    case 'google':
      return createGoogleGenerativeAI({ apiKey, baseURL, headers });
    case 'openai-compatible':
    default:
      return createOpenAICompatible({
        name: provider.name,
        apiKey,
        baseURL,
        headers,
      });
  }
}

const SELECTABLE = {
  id: providerModels.id,
  displayName: providerModels.displayName,
  remoteModelId: providerModels.remoteModelId,
  capabilities: providerModels.capabilities,
  contextWindow: providerModels.contextWindow,
  maxOutput: providerModels.maxOutput,
  isFallback: providerModels.isFallback,
  providerId: providers.id,
  providerName: providers.name,
} as const;

export type SelectableModel = {
  id: string;
  displayName: string;
  remoteModelId: string;
  capabilities: ModelCapabilities;
  contextWindow: number | null;
  maxOutput: number | null;
  isFallback: boolean;
  providerId: string;
  providerName: string;
};

/**
 * Every model a user may pick. Ordered so that the fallback chain the admin
 * configured reads top to bottom: `providers.sortOrder` first (free provider
 * before paid backup), then `providerModels.sortOrder`.
 */
export async function listSelectableModels(): Promise<SelectableModel[]> {
  return db
    .select(SELECTABLE)
    .from(providerModels)
    .innerJoin(providers, eq(providerModels.providerId, providers.id))
    .where(and(eq(providers.enabled, true), eq(providerModels.enabled, true)))
    .orderBy(asc(providers.sortOrder), asc(providerModels.sortOrder));
}

type Candidate = SelectableModel & { enabled: true; provider: ProviderRow };

/**
 * Every live model together with its provider, in one query.
 *
 * This is the single source the fallback chain is built from — resolving the
 * provider per model would turn a 16-model chain into 17 round trips.
 */
async function listCandidates(): Promise<Candidate[]> {
  const rows = await db
    .select({
      ...SELECTABLE,
      modelEnabled: providerModels.enabled,
      providerEnabled: providers.enabled,
      provider: providers,
    })
    .from(providerModels)
    .innerJoin(providers, eq(providerModels.providerId, providers.id))
    .where(and(eq(providers.enabled, true), eq(providerModels.enabled, true)))
    .orderBy(asc(providers.sortOrder), asc(providerModels.sortOrder));

  return rows.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    remoteModelId: r.remoteModelId,
    capabilities: r.capabilities,
    contextWindow: r.contextWindow,
    maxOutput: r.maxOutput,
    isFallback: r.isFallback,
    providerId: r.providerId,
    providerName: r.providerName,
    enabled: true,
    provider: r.provider,
  }));
}

function toModel(row: Candidate): ResolvedModel {
  // All three provider packages expose `languageModel()`; `chatModel()` exists
  // only on the OpenAI-compatible one, so it is not interchangeable.
  return {
    id: row.id,
    providerId: row.providerId,
    model: chatFactory(row.provider).languageModel(row.remoteModelId),
    providerName: row.provider.name,
    displayName: row.displayName,
    remoteModelId: row.remoteModelId,
    capabilities: row.capabilities ?? {},
  };
}

export async function resolveModelById(modelUuid: string): Promise<ResolvedModel> {
  const row = (await listCandidates()).find((m) => m.id === modelUuid);

  if (!row) {
    // Distinguish "you typed nonsense" from "the admin switched it off".
    const [any] = await db
      .select({ id: providerModels.id })
      .from(providerModels)
      .where(eq(providerModels.id, modelUuid))
      .limit(1);
    throw new ProviderConfigError(
      any ? 'Model or provider is disabled' : 'Model not found',
    );
  }

  return toModel(row);
}

/**
 * The ordered list to try when generating.
 *
 * The picked model goes first — the user asked for it — then every other live
 * model in configured order. `isFallback` models are pushed to the end, so a
 * paid backup is never chosen while a free one is still available.
 */
export async function buildFallbackChain(modelUuid: string): Promise<ResolvedModel[]> {
  const candidates = await listCandidates();
  if (!candidates.length) {
    throw new ProviderConfigError('No models are enabled');
  }

  const ordered = candidates.some((m) => m.id === modelUuid)
    ? [candidates.find((m) => m.id === modelUuid)!, ...candidates.filter((m) => m.id !== modelUuid)]
    : candidates;

  // Array#sort is stable, so provider/model order survives inside each group.
  const partitioned = [...ordered].sort(
    (a, b) => Number(a.isFallback) - Number(b.isFallback),
  );

  return partitioned.map(toModel);
}

/** Only the model ids, cheap enough to call for capability filtering. */
export async function listEnabledModelIds(): Promise<string[]> {
  const models = await listSelectableModels();
  return models.filter((m) => !m.isFallback).map((m) => m.id);
}