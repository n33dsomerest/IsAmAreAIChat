import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { requireUser } from '@/lib/api/auth';
import { BANK_DELAY, verifySlip } from '@/lib/payments/slipok';
import { db } from '@/lib/db';
import { orders } from '@/lib/db/schema';

const MAX_SLIP_BYTES = 8 * 1024 * 1024;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/jfif'];

const bodySchema = z.object({ orderId: z.string().uuid() });

/**
 * Verifies an uploaded slip against a pending order and pays out immediately.
 *
 * Duplicate protection is ours: SlipOK is called with `log:false`, so the same
 * slip image can come back to us more than once and it is `orders.trans_ref`
 * (unique) plus `orders.slip_hash` (unique) that stop the second payout.
 */
export async function POST(request: Request) {
  const session = await requireUser();
  if (!session.ok) return session.response;

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const parsed = bodySchema.safeParse({ orderId: form.get('orderId') });
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const file = form.get('slip');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'กรุณาแนบรูปสลิป' }, { status: 400 });
  }
  if (file.size > MAX_SLIP_BYTES) {
    return NextResponse.json({ error: 'ไฟล์ใหญ่เกิน 8 MB' }, { status: 413 });
  }
  if (!ACCEPTED.includes(file.type)) {
    return NextResponse.json(
      { error: 'รองรับเฉพาะ JPEG, PNG, WEBP หรือ JFIF' },
      { status: 415 },
    );
  }

  const [order] = await db
    .select({
      id: orders.id,
      userId: orders.userId,
      amountThb: orders.amountThb,
      credits: orders.credits,
      status: orders.status,
      transRef: orders.transRef,
      slipHash: orders.slipHash,
    })
    .from(orders)
    .where(eq(orders.id, parsed.data.orderId))
    .limit(1);

  if (!order || order.userId !== session.user.id) {
    return NextResponse.json({ error: 'order_not_found' }, { status: 404 });
  }
  if (order.status === 'paid') {
    return NextResponse.json(
      { error: 'order_already_paid', credits: order.credits },
      { status: 409 },
    );
  }

  const slipHash = await sha256(await file.arrayBuffer());

  // Re-uploading the same image would spend SlipOK quota to learn nothing, and
  // once it has been paid it would be a straight-up replay attempt.
  if (order.slipHash === slipHash) {
    return NextResponse.json(
      { error: 'อัปโหลดรูปนี้ไปแล้ว', duplicate: true },
      { status: 409 },
    );
  }

  // The same file against a *different* order means someone is trying to pay
  // for two purchases with one transfer.
  const [byHash] = await db
    .select({ id: orders.id, userId: orders.userId })
    .from(orders)
    .where(eq(orders.slipHash, slipHash))
    .limit(1);

  if (byHash) {
    return NextResponse.json(
      { error: 'รูปนี้ถูกใช้ไปแล้ว', duplicate: true },
      { status: 409 },
    );
  }

  await db
    .update(orders)
    .set({ slipHash, attempts: sql`${orders.attempts} + 1` })
    .where(eq(orders.id, order.id));

  const result = await verifySlip(file, order.amountThb);

  if (!result.ok) {
    const patch: Partial<typeof orders.$inferInsert> = { slipOkCode: result.code };

    if (result.code === BANK_DELAY) {
      patch.status = 'pending_delay';
      patch.retryAfterAt = new Date(Date.now() + 30 * 60_000);
    } else if (result.code === 1011 || result.code === 1012 || result.code === 1013) {
      patch.status = 'rejected';
    }

    await db.update(orders).set(patch).where(eq(orders.id, order.id));

    return NextResponse.json(
      {
        error: result.message,
        code: result.code,
        retryable: result.retryable,
      },
      { status: result.retryable ? 503 : 422 },
    );
  }

  // SlipOK was asked to check the amount; confirm it independently so a
  // mis-typed figure can never slip through.
  if (Math.round(result.data.amount) !== order.amountThb) {
    await db
      .update(orders)
      .set({
        status: 'rejected',
        slipOkCode: 1013,
        transRef: result.data.transRef,
        slipOkRaw: result.data as unknown as Record<string, unknown>,
      })
      .where(eq(orders.id, order.id));

    return NextResponse.json(
      {
        error: `ยอดในสลิป ${result.data.amount} บาท ไม่ตรงกับที่ต้องชำระ ${order.amountThb} บาท`,
        code: 1013,
      },
      { status: 422 },
    );
  }

  // A transRef already paid out elsewhere means this slip is being replayed.
  const [byRef] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.transRef, result.data.transRef), sql`${orders.id} <> ${order.id}`))
    .limit(1);

  if (byRef) {
    await db
      .update(orders)
      .set({
        status: 'rejected',
        slipOkCode: 1012,
        transRef: result.data.transRef,
        adminNote: 'duplicate trans_ref',
      })
      .where(eq(orders.id, order.id));

    return NextResponse.json(
      { error: 'สลิปนี้ถูกใช้ไปแล้ว', code: 1012, duplicate: true },
      { status: 409 },
    );
  }

  await db
    .update(orders)
    .set({
      transRef: result.data.transRef,
      slipOkCode: 0,
      slipOkRaw: result.data as unknown as Record<string, unknown>,
    })
    .where(eq(orders.id, order.id));

  // One transaction: flips the order to paid and credits the balance.
  const granted = await db.execute(sql`
    select public.grant_order_credits(${order.id}::uuid) as granted
  `);

  const ok = (Array.isArray(granted) ? granted[0] : granted) as unknown as {
    granted: boolean;
  };

  if (!ok?.granted) {
    return NextResponse.json({ error: 'grant_failed' }, { status: 500 });
  }

  const [fresh] = await db
    .select({ credits: orders.credits })
    .from(orders)
    .where(eq(orders.id, order.id));

  return NextResponse.json({
    ok: true,
    credits: fresh.credits,
    transRef: result.data.transRef,
  });
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}