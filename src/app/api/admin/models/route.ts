import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdmin } from '@/lib/api/auth';
import { setModelEnabled, setModelFallback } from '@/lib/ai/model-visibility';
import { db } from '@/lib/db';
import { providerModels, providers } from '@/lib/db/schema';

/**
 * Every model in the catalogue, live or not.
 *
 * The public `/api/models` only ever returns enabled rows, so the admin view
 * needs its own listing to see — and re-enable — what sync switched off.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { searchParams } = new URL(request.url);
  const onlyLive = searchParams.get('live') === '1';

  const rows = await db
    .select({
      id: providerModels.id,
      displayName: providerModels.displayName,
      remoteModelId: providerModels.remoteModelId,
      contextWindow: providerModels.contextWindow,
      capabilities: providerModels.capabilities,
      pricing: providerModels.pricing,
      enabled: providerModels.enabled,
      isFallback: providerModels.isFallback,
      sortOrder: providerModels.sortOrder,
      lastSyncedAt: providerModels.lastSyncedAt,
      providerId: providerModels.providerId,
      providerName: providers.name,
      providerEnabled: providers.enabled,
    })
    .from(providerModels)
    .innerJoin(providers, eq(providerModels.providerId, providers.id))
    .orderBy(asc(providers.sortOrder), asc(providerModels.sortOrder))
    .limit(1000);

  const models = onlyLive ? rows.filter((r) => r.enabled) : rows;

  return NextResponse.json({
    models: models.map((r) => ({
      ...r,
      lastSyncedAt: r.lastSyncedAt ? r.lastSyncedAt.toISOString() : null,
    })),
  });
}

const patchSchema = z.object({
  id: z.string().uuid(),
  enabled: z.boolean().optional(),
  isFallback: z.boolean().optional(),
});

/** Flip a model's visibility or fallback role without re-syncing. */
export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { id, enabled, isFallback } = parsed.data;

  const [existing] = await db
    .select({ id: providerModels.id })
    .from(providerModels)
    .where(eq(providerModels.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: 'model_not_found' }, { status: 404 });
  }

  if (enabled !== undefined) await setModelEnabled(id, enabled);
  if (isFallback !== undefined) await setModelFallback(id, isFallback);

  const [row] = await db
    .select({
      id: providerModels.id,
      enabled: providerModels.enabled,
      isFallback: providerModels.isFallback,
    })
    .from(providerModels)
    .where(eq(providerModels.id, id));

  return NextResponse.json({ model: row });
}