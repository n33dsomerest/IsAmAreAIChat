import { and, eq } from 'drizzle-orm';

import { isCuratedTokenHarbor } from '@/lib/ai/model-curation';
import { db } from '@/lib/db';
import { providerModels } from '@/lib/db/schema';
import { isFreeModelId } from '@/lib/ai/sync-models';

export type SyncMode = 'free' | 'all' | 'none';

/** Stable id of the TokenHarbor provider row, as seeded by the sync script. */
const TOKENHARBOR_PROVIDER_ID = 'tokenharbor';

/**
 * TokenHarbor lists a paid twin for every free model, so "enable everything
 * free" is not just a cluttered picker — it is one admin click away from billing
 * real money. The curated allowlist is the editorial answer, and it is also the
 * safety answer: a model id that is not on the list never reaches `enabled`.
 */
function defaultEnabled(providerId: string, remoteModelId: string): boolean {
  if (providerId === TOKENHARBOR_PROVIDER_ID) return isCuratedTokenHarbor(remoteModelId);
  return isFreeModelId(remoteModelId);
}

/**
 * Decides which synced models are live.
 *
 * `free` is the default because a provider can expose several hundred paid
 * models — putting them all in the picker is unusable, and marking them all as
 * fallbacks buries every other provider at the end of a chain hundreds long.
 * The admin can then enable or disable individual models by hand.
 */
export async function applySyncMode(providerId: string, mode: SyncMode) {
  const rows = await db
    .select({
      id: providerModels.id,
      remoteModelId: providerModels.remoteModelId,
    })
    .from(providerModels)
    .where(eq(providerModels.providerId, providerId));

  let enabled = 0;
  for (const row of rows) {
    const shouldEnable =
      mode === 'all' ? true : mode === 'none' ? false : defaultEnabled(providerId, row.remoteModelId);

    if (shouldEnable) {
      await db
        .update(providerModels)
        .set({ enabled: true })
        .where(eq(providerModels.id, row.id));
      enabled++;
    } else {
      await db
        .update(providerModels)
        .set({ enabled: false })
        .where(eq(providerModels.id, row.id));
    }
  }

  return { total: rows.length, enabled };
}

/** Toggle a single model without re-syncing the whole provider. */
export async function setModelEnabled(modelId: string, enabled: boolean) {
  const [row] = await db
    .update(providerModels)
    .set({ enabled })
    .where(eq(providerModels.id, modelId))
    .returning({ id: providerModels.id, enabled: providerModels.enabled });
  return row;
}

/** Mark a model as backup-only, so it is tried after everything else. */
export async function setModelFallback(modelId: string, isFallback: boolean) {
  const [row] = await db
    .update(providerModels)
    .set({ isFallback })
    .where(and(eq(providerModels.id, modelId), eq(providerModels.enabled, true)))
    .returning({ id: providerModels.id, isFallback: providerModels.isFallback });
  return row;
}