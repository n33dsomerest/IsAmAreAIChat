import { NextResponse } from 'next/server';
import { and, eq, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdmin } from '@/lib/api/auth';
import { db } from '@/lib/db';
import { orders } from '@/lib/db/schema';

const patchSchema = z.object({
  orderId: z.string().uuid(),
  action: z.enum(['mark_paid', 'reject', 'refund']),
  note: z.string().max(500).optional(),
});

/**
 * Manual override for orders the automatic path could not settle.
 *
 * The admin grant still goes through `grant_order_credits`, so the ledger and
 * the balance stay consistent whether a payment came from SlipOK or a human.
 */
export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const { orderId, action, note } = parsed.data;

  const [order] = await db
    .select({ id: orders.id, userId: orders.userId, status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) return NextResponse.json({ error: 'order_not_found' }, { status: 404 });

  if (action === 'mark_paid') {
    const result = await db.execute(sql`
      select public.grant_order_credits(${orderId}::uuid) as granted
    `);
    const row = (Array.isArray(result) ? result[0] : result) as unknown as {
      granted: boolean;
    };
    if (!row?.granted) {
      return NextResponse.json({ error: 'order_not_payable' }, { status: 409 });
    }
    if (note) {
      await db.update(orders).set({ adminNote: note }).where(eq(orders.id, orderId));
    }
    return NextResponse.json({ ok: true, action });
  }

  if (action === 'reject') {
    await db
      .update(orders)
      .set({
        status: 'rejected',
        adminNote: note ?? 'rejected by admin',
        retryAfterAt: null,
      })
      .where(and(eq(orders.id, orderId), sql`${orders.status} <> 'paid'`));
    return NextResponse.json({ ok: true, action });
  }

  // refund: take the credits back out and mark the order refunded.
  await db.execute(sql`
    begin;
    update public.orders set status = 'refunded' where id = ${orderId}::uuid and status = 'paid';
    update public.users u
       set credits_balance = greatest(u.credits_balance - o.credits, 0),
           total_granted   = greatest(u.total_granted - o.credits, 0),
           total_paid_thb  = greatest(u.total_paid_thb - o.amount_thb, 0)
      from public.orders o
     where o.id = ${orderId}::uuid and u.id = o.user_id;
    commit;
  `);

  return NextResponse.json({ ok: true, action });
}

/** Orders that have been stuck in a non-terminal state for more than a day. */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const stale = await db
    .select({
      id: orders.id,
      status: orders.status,
      attempts: orders.attempts,
      slipOkCode: orders.slipOkCode,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(
      and(
        sql`${orders.status} in ('pending', 'pending_delay')`,
        lt(orders.createdAt, new Date(Date.now() - 24 * 3600_000)),
      ),
    )
    .limit(50);

  return NextResponse.json({ stale });
}