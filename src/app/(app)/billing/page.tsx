import { desc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getCurrentUser } from '@/lib/auth/current-user';
import { db } from '@/lib/db';
import { creditPackages, orders } from '@/lib/db/schema';
import { formatBaht } from '@/lib/site-config';

export const metadata = { title: 'ประวัติการซื้อ' };
export const instant = false;

const STATUS: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  pending: { label: 'รอชำระ', variant: 'outline' },
  pending_delay: { label: 'ธนาคารค้างอยู่', variant: 'secondary' },
  paid: { label: 'ชำระแล้ว', variant: 'default' },
  failed: { label: 'ล้มเหลว', variant: 'destructive' },
  rejected: { label: 'สลิปไม่ผ่าน', variant: 'destructive' },
  expired: { label: 'หมดอายุ', variant: 'outline' },
  refunded: { label: 'คืนแล้ว', variant: 'outline' },
};

export default async function BillingPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const rows = await db
    .select({
      id: orders.id,
      amountThb: orders.amountThb,
      credits: orders.credits,
      status: orders.status,
      attempts: orders.attempts,
      slipOkCode: orders.slipOkCode,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      packageName: creditPackages.name,
    })
    .from(orders)
    .innerJoin(creditPackages, eq(orders.packageId, creditPackages.id))
    .where(eq(orders.userId, user.id))
    .orderBy(desc(orders.createdAt))
    .limit(100);

  return (
    <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 md:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">ประวัติการซื้อ</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          เครดิตคงเหลือ {user.credits} · เครดิตไม่มีวันหมดอายุ
        </p>

        {rows.length === 0 ? (
          <p className="text-muted-foreground mt-10 text-center text-sm">
            ยังไม่มีคำสั่งซื้อ — <a href="/pricing" className="underline">ดูแพ็กเกจ</a>
          </p>
        ) : (
          <div className="mt-6 overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>แพ็กเกจ</TableHead>
                  <TableHead className="text-right">เครดิต</TableHead>
                  <TableHead className="text-right">ยอดเงิน</TableHead>
                  <TableHead>สถานะ</TableHead>
                  <TableHead className="text-right">วันที่</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const meta = STATUS[row.status] ?? { label: row.status, variant: 'outline' as const };
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.packageName}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.credits}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatBaht(row.amountThb)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                        {row.status === 'pending_delay' && (
                          <p className="text-muted-foreground mt-1 text-xs">
                            ธนาคารกำลังประมวลผล — อัปโหลดสลิปใหม่ได้จากหน้าราคา
                          </p>
                        )}
                        {row.status === 'rejected' && row.slipOkCode ? (
                          <p className="text-muted-foreground mt-1 text-xs">
                            รหัสจาก SlipOK: {row.slipOkCode}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right text-xs tabular-nums">
                        {row.paidAt
                          ? row.paidAt.toLocaleDateString('th-TH', {
                              day: 'numeric',
                              month: 'short',
                              year: '2-digit',
                            })
                          : row.createdAt.toLocaleDateString('th-TH', {
                              day: 'numeric',
                              month: 'short',
                              year: '2-digit',
                            })}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
