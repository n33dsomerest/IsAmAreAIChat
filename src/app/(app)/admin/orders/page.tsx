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
import { creditPackages, orders, users } from '@/lib/db/schema';
import { formatBaht } from '@/lib/site-config';

export const metadata = { title: 'คิวออเดอร์ · ผู้ดูแลระบบ' };
export const instant = false;

const STATUS: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  pending: { label: 'รอชำระ', variant: 'outline' },
  pending_delay: { label: 'ธนาคารค้าง', variant: 'secondary' },
  paid: { label: 'ชำระแล้ว', variant: 'default' },
  failed: { label: 'ล้มเหลว', variant: 'destructive' },
  rejected: { label: 'สลิปไม่ผ่าน', variant: 'destructive' },
  expired: { label: 'หมดอายุ', variant: 'outline' },
  refunded: { label: 'คืนแล้ว', variant: 'outline' },
};

export default async function AdminOrdersPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/');

  const rows = await db
    .select({
      id: orders.id,
      amountThb: orders.amountThb,
      credits: orders.credits,
      status: orders.status,
      attempts: orders.attempts,
      slipOkCode: orders.slipOkCode,
      transRef: orders.transRef,
      adminNote: orders.adminNote,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      username: users.username,
      packageName: creditPackages.name,
    })
    .from(orders)
    .innerJoin(users, eq(orders.userId, users.id))
    .innerJoin(creditPackages, eq(orders.packageId, creditPackages.id))
    .orderBy(desc(orders.createdAt))
    .limit(200);

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">คิวออเดอร์</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {rows.length} รายการล่าสุด ·{' '}
          {Object.entries(counts)
            .map(([s, n]) => `${STATUS[s]?.label ?? s} ${n}`)
            .join(' · ')}
        </p>

        <div className="mt-6 overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ผู้ซื้อ</TableHead>
                <TableHead>แพ็กเกจ</TableHead>
                <TableHead className="text-right">ยอด</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead>เลขอ้างอิง</TableHead>
                <TableHead className="text-right">วันที่</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const meta = STATUS[row.status] ?? { label: row.status, variant: 'outline' as const };
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.username}</TableCell>
                    <TableCell>
                      {row.packageName}
                      <span className="text-muted-foreground ml-1 text-xs">
                        ({row.credits} cr)
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatBaht(row.amountThb)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      {row.slipOkCode ? (
                        <span className="text-muted-foreground ml-1.5 text-xs">
                          {row.slipOkCode}
                        </span>
                      ) : null}
                      {row.adminNote && (
                        <p className="text-muted-foreground mt-0.5 text-xs">{row.adminNote}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {row.transRef ?? '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right text-xs tabular-nums">
                      {row.createdAt.toLocaleString('th-TH', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground py-8 text-center">
                    ยังไม่มีออเดอร์
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}