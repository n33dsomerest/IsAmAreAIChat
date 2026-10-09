import { NextResponse } from 'next/server';
import { asc } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdmin } from '@/lib/api/auth';
import { db } from '@/lib/db';
import { providers } from '@/lib/db/schema';

const KINDS = ['openai-compatible', 'anthropic', 'google'] as const;

const createSchema = z.object({
  name: z.string().trim().min(2).max(48),
  kind: z.enum(KINDS),
  baseUrl: z.string().url(),
  /** Name of a server env var — the key itself is never accepted here. */
  envKeyName: z.string().trim().regex(/^[A-Z][A-Z0-9_]*$/, 'must be an env var name like OPENROUTER_API_KEY'),
  headers: z.record(z.string(), z.string()).default({}),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const rows = await db
    .select({
      id: providers.id,
      name: providers.name,
      kind: providers.kind,
      baseUrl: providers.baseUrl,
      envKeyName: providers.envKeyName,
      headers: providers.headers,
      enabled: providers.enabled,
      sortOrder: providers.sortOrder,
      createdAt: providers.createdAt,
      modelCount: providers.id,
    })
    .from(providers)
    .orderBy(asc(providers.sortOrder), asc(providers.name));

  // Report whether each provider's key is actually present, without ever
  // returning the key itself.
  const withStatus = rows.map((p) => ({
    ...p,
    keyConfigured: Boolean(process.env[p.envKeyName]),
  }));

  return NextResponse.json({ providers: withStatus });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { name, ...rest } = parsed.data;

  const [row] = await db
    .insert(providers)
    .values({ name: name.toLowerCase(), ...rest })
    .onConflictDoNothing()
    .returning();

  if (!row) {
    return NextResponse.json({ error: 'provider_name_taken' }, { status: 409 });
  }

  return NextResponse.json({ provider: row }, { status: 201 });
}