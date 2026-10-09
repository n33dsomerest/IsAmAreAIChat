import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireUser } from '@/lib/api/auth';
import { db } from '@/lib/db';
import { creditPackages, orders } from '@/lib/db/schema';

const createSchema = z.object({ packageId: z.string().uuid() });

export async function GET() {
  const session = await requireUser();
  if (!session.ok) return session.response;

  const rows = await db
    .select({
      id: orders.id,
      amountThb: orders.amountThb,
      credits: orders.credits,
      status: orders.status,
      slipOkCode: orders.slipOkCode,
      attempts: orders.attempts,
      retryAfterAt: orders.retryAfterAt,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      packageName: creditPackages.name,
    })
    .from(orders)
    .innerJoin(creditPackages, eq(orders.packageId, creditPackages.id))
    .where(eq(orders.userId, session.user.id))
    .orderBy(desc(orders.createdAt))
    .limit(50);

  return NextResponse.json({ orders: rows });
}

/** Creates a pending order; credits are only granted once a slip verifies. */
export async function POST(request: Request) {
  const session = await requireUser();
  if (!session.ok) return session.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const [pkg] = await db
    .select({
      id: creditPackages.id,
      name: creditPackages.name,
      priceThb: creditPackages.priceThb,
      credits: creditPackages.credits,
      active: creditPackages.active,
      sortOrder: creditPackages.sortOrder,
    })
    .from(creditPackages)
    .where(eq(creditPackages.id, parsed.data.packageId))
    .limit(1);

  if (!pkg || !pkg.active) {
    return NextResponse.json({ error: 'package_unavailable' }, { status: 404 });
  }

  // One open order per user: a second pending order is almost always a double
  // click, and the duplicate-slip guards work better with a single target.
  const [open] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.userId, session.user.id),
        eq(orders.status, 'pending'),
      ),
    )
    .limit(1);

  if (open) {
    return NextResponse.json({ orderId: open.id, existing: true });
  }

  const [order] = await db
    .insert(orders)
    .values({
      userId: session.user.id,
      packageId: pkg.id,
      amountThb: pkg.priceThb,
      credits: pkg.credits,
      status: 'pending',
    })
    .returning({ id: orders.id });

  return NextResponse.json(
    { orderId: order.id, amountThb: pkg.priceThb, credits: pkg.credits },
    { status: 201 },
  );
}