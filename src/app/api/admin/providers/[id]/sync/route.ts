import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdmin } from '@/lib/api/auth';
import { syncProviderModels } from '@/lib/ai/sync-models';
import { db } from '@/lib/db';
import { providers } from '@/lib/db/schema';
import { invalidateCandidateCache } from '@/lib/ai/resolve';

/**
 * Pull the provider's live catalogue into `provider_models`.
 *
 *   POST /api/admin/providers/:id/sync
 *   { "mode": "free" | "all" | "none" }
 */
const bodySchema = z.object({
  mode: z.enum(['free', 'all', 'none']).default('free'),
});

export async function POST(request: NextRequest, context: RouteContext<'/api/admin/providers/[id]/sync'>) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await context.params;
  const uuid = z.string().uuid().safeParse(id);
  if (!uuid.success) {
    return NextResponse.json({ error: 'invalid_provider_id' }, { status: 400 });
  }

  const [provider] = await db
    .select({ id: providers.id, name: providers.name })
    .from(providers)
    .where(eq(providers.id, id))
    .limit(1);

  if (!provider) {
    return NextResponse.json({ error: 'provider_not_found' }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    const result = await syncProviderModels(id, {
      autoClassifyFallback: false,
      // "mode" decides what is enabled; sync itself only prunes vanished models.
      pruneMissing: true,
    });

    const { applySyncMode } = await import('@/lib/ai/model-visibility');
    const applied = await applySyncMode(id, parsed.data.mode);

    invalidateCandidateCache();
    return NextResponse.json({
      provider: provider.name,
      ...result,
      enabled: applied.enabled,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'sync_failed';
    return NextResponse.json({ error: 'sync_failed', message }, { status: 502 });
  }
}