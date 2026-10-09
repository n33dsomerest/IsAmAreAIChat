import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/api/auth';
import { listSelectableModels } from '@/lib/ai/resolve';

/**
 * The model catalogue for the picker. Session required; anything disabled or
 * belonging to a disabled provider is already filtered out by the query.
 */
export async function GET() {
  const session = await requireUser();
  if (!session.ok) return session.response;

  const models = await listSelectableModels();

  return NextResponse.json({
    models: models.map((m) => ({
      id: m.id,
      label: m.displayName,
      provider: m.providerName,
      providerId: m.providerId,
      isFallback: m.isFallback,
      contextWindow: m.contextWindow,
      maxOutput: m.maxOutput,
      capabilities: m.capabilities,
    })),
  });
}