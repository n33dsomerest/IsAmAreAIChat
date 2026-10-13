import { NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { requireUser } from '@/lib/api/auth';
import { db } from '@/lib/db';
import { usageEvents, providerModels, providers } from '@/lib/db/schema';

const metadataSchema = z.object({
  conversationId: z.string().uuid().optional(),
  modelId: z.string().uuid().optional(),
  providerId: z.string().uuid().optional(),
  status: z.enum(['pending', 'success', 'error', 'refunded']).optional(),
  days: z.coerce.number().default(7).optional(),
});

export async function GET(request: Request) {
  const session = await requireUser();
  if (!session.ok) return session.response;

  // Admin only
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = metadataSchema.safeParse({
    conversationId: searchParams.get('conversationId'),
    modelId: searchParams.get('modelId'),
    providerId: searchParams.get('providerId'),
    status: searchParams.get('status'),
    days: searchParams.get('days'),
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_query', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { conversationId, modelId, providerId, status, days } = parsed.data;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days ?? 7));

  // Base where clause
  const whereConditions: any[] = [
    sql`created_at >= ${cutoff}`,
  ];

  if (conversationId) {
    whereConditions.push(eq(usageEvents.conversationId, conversationId));
  }
  if (modelId) {
    whereConditions.push(eq(usageEvents.modelId, modelId));
  }
  if (providerId) {
    whereConditions.push(eq(usageEvents.providerId, providerId));
  }
  if (status) {
    whereConditions.push(eq(usageEvents.status, status));
  }

  const where = whereConditions.length > 0 ? sql`${whereConditions.join(' AND ')}` : undefined;

  // Overall metrics
  const overall = await db.execute(sql`
    select
      count(*)::int as total_requests,
      coalesce(sum(input_tokens), 0)::bigint as total_input_tokens,
      coalesce(sum(output_tokens), 0)::bigint as total_output_tokens,
      coalesce(sum(latency_ms), 0)::bigint as total_latency_ms,
      coalesce(avg(latency_ms), 0)::int as avg_latency_ms,
      coalesce(sum(case when status = 'success' then 1 else 0 end), 0)::int as successful,
      coalesce(sum(case when status != 'success' then 1 else 0 end), 0)::int as failed,
      coalesce(sum(case when status = 'refunded' then 1 else 0 end), 0)::int as refunded,
      coalesce(sum(credits_cost), 0)::bigint as total_credits_cost,
      coalesce(sum(provider_cost_usd), 0)::numeric(12, 6) as total_usd_cost
    from public.usage_events
    where ${where}
  `);

  // Per-model metrics
  const byModel = await db.execute(sql`
    select
      u.modelId::uuid as model_id,
      pm.displayName,
      pm.providerName,
      count(*)::int as requests,
      coalesce(sum(input_tokens), 0)::bigint as input_tokens,
      coalesce(sum(output_tokens), 0)::bigint as output_tokens,
      coalesce(avg(latency_ms), 0)::int as avg_latency_ms,
      count(*) filter (where status = 'success')::int as successful,
      count(*) filter (where status != 'success')::int as failed,
      coalesce(sum(credits_cost), 0)::bigint as credits_cost,
      coalesce(sum(provider_cost_usd), 0)::numeric(12, 6) as usd_cost
    from public.usage_events u
    left join provider_models pm on u.modelId = pm.id
    where ${where}
    group by u.modelId, pm.displayName, pm.providerName
    order by requests desc
  `);

  // Per-provider metrics
  const byProvider = await db.execute(sql`
    select
      u.providerId::uuid as provider_id,
      p.name,
      count(*)::int as requests,
      coalesce(sum(input_tokens), 0)::bigint as input_tokens,
      coalesce(sum(output_tokens), 0)::bigint as output_tokens,
      coalesce(avg(latency_ms), 0)::int as avg_latency_ms,
      count(*) filter (where status = 'success')::int as successful,
      count(*) filter (where status != 'success')::int as failed,
      coalesce(sum(credits_cost), 0)::bigint as credits_cost,
      coalesce(sum(provider_cost_usd), 0)::numeric(12, 6) as usd_cost
    from public.usage_events u
    left join providers p on u.providerId = p.id
    where ${where}
    group by u.providerId, p.name
    order by requests desc
  `);

  // Status breakdown
  const statusBreakdown = await db.execute(sql`
    select
      status::text as status,
      count(*)::int as count,
      round(count(*)::numeric / (select count(*) from public.usage_events where ${where} or true) * 100, 2) as pct
    from public.usage_events
    where ${where}
    group by status
    order by count desc
  `);

  return NextResponse.json({
    period_days: days ?? 7,
    cutoff: cutoff.toISOString(),
    overall: overall.length > 0 ? overall[0] : {
      total_requests: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_latency_ms: 0,
      avg_latency_ms: 0,
      successful: 0,
      failed: 0,
      refunded: 0,
      total_credits_cost: 0,
      total_usd_cost: '0.000000',
    },
    by_model: byModel.length > 0 ? byModel : [],
    by_provider: byProvider.length > 0 ? byProvider : [],
    status_breakdown: statusBreakdown.length > 0 ? statusBreakdown : [],
  });
}