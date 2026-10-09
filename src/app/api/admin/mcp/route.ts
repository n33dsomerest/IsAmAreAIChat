import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdmin } from '@/lib/api/auth';
import { db } from '@/lib/db';
import { mcpServers } from '@/lib/db/schema';
import { McpClient } from '@/lib/mcp/client';

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const rows = await db.select().from(mcpServers).orderBy(asc(mcpServers.name));

  return NextResponse.json({
    servers: rows.map((s) => ({
      id: s.id,
      name: s.name,
      url: s.url,
      transport: s.transport,
      enabled: s.enabled,
      toolCount: Array.isArray(s.toolsCache) ? s.toolsCache.length : 0,
      lastCheckedAt: s.lastCheckedAt,
      lastError: (s.toolsCache as { lastError?: string }[] | null)?.at?.(-1)?.lastError ?? null,
    })),
  });
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(48).regex(/^[\w-]+$/, 'letters, digits, dash only'),
  url: z.string().url(),
  transport: z.enum(['http', 'sse']).default('http'),
  headers: z.record(z.string(), z.string()).default({}),
  enabled: z.boolean().default(true),
});

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', issues: parsed.error.issues }, { status: 400 });
  }

  const [existing] = await db
    .select({ id: mcpServers.id })
    .from(mcpServers)
    .where(eq(mcpServers.name, parsed.data.name))
    .limit(1);

  if (existing) {
    return NextResponse.json({ error: 'server_name_taken' }, { status: 409 });
  }

  const [row] = await db.insert(mcpServers).values(parsed.data).returning();

  return NextResponse.json({ server: row }, { status: 201 });
}

/** Handshakes and caches the tool list so the admin can see what a server offers. */
export async function PUT(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const parsed = z
    .object({ id: z.string().uuid(), action: z.literal('probe') })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const [server] = await db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.id, parsed.data.id))
    .limit(1);

  if (!server) return NextResponse.json({ error: 'server_not_found' }, { status: 404 });

  try {
    const client = new McpClient({
      id: server.id,
      name: server.name,
      url: server.url,
      transport: server.transport,
      enabled: server.enabled,
      headers: server.headers ?? {},
    });

    const tools = await client.tools(true);

    await db
      .update(mcpServers)
      .set({
        toolsCache: tools as unknown as Record<string, unknown>[],
        lastCheckedAt: new Date(),
      })
      .where(eq(mcpServers.id, server.id));

    return NextResponse.json({ tools });
  } catch (err) {
    const message = (err as Error).message;

    await db
      .update(mcpServers)
      .set({
        lastCheckedAt: new Date(),
        toolsCache: [{ lastError: message }],
      })
      .where(eq(mcpServers.id, server.id));

    return NextResponse.json({ error: 'probe_failed', message }, { status: 502 });
  }
}

const patchSchema = z.object({
  id: z.string().uuid(),
  enabled: z.boolean().optional(),
  url: z.string().url().optional(),
});

export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const { id, ...changes } = parsed.data;
  const [row] = await db
    .update(mcpServers)
    .set(changes)
    .where(eq(mcpServers.id, id))
    .returning({ id: mcpServers.id, enabled: mcpServers.enabled });

  return NextResponse.json({ server: row });
}

export async function DELETE(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const id = new URL(request.url).searchParams.get('id');
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }

  await db.delete(mcpServers).where(eq(mcpServers.id, id!));
  return NextResponse.json({ ok: true });
}