import { redirect } from 'next/navigation';
import { ArrowRight, CreditCard, Gauge, Users } from 'lucide-react';
import Link from 'next/link';
import { and, eq } from 'drizzle-orm';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/auth/current-user';
import { db } from '@/lib/db';
import { providerModels, providers } from '@/lib/db/schema';

export const metadata = { title: 'ผู้ดูแลระบบ' };
export const instant = false;

export default async function AdminHomePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/');

  const [providerCount, modelCount, liveCount] = await Promise.all([
    db.select({ id: providers.id }).from(providers),
    db.select({ id: providerModels.id }).from(providerModels),
    db
      .select({ id: providerModels.id })
      .from(providerModels)
      .innerJoin(providers, eq(providerModels.providerId, providers.id))
      .where(and(eq(providers.enabled, true), eq(providerModels.enabled, true))),
  ]);

  return (
    <main className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8">
        <header className="mb-6">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">ผู้ดูแลระบบ</h1>
            <Badge variant="secondary">admin</Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            จัดการผู้ให้บริการ โมเดล และการตั้งค่าระบบ
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Gauge className="size-4" />
                ผู้ให้บริการและโมเดล
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground text-sm">
                {providerCount.length} ผู้ให้บริการ · {modelCount.length} โมเดลในแคตตาล็อก · เปิดใช้{' '}
                {liveCount.length}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link href="/admin/providers">
                    จัดการผู้ให้บริการ
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/admin/models">จัดการโมเดล</Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="size-4" />
                ผู้ใช้และเครดิต
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground text-sm">
                เครดิตของคุณ: {user.credits} · {user.hasPaid ? 'เคยซื้อแล้ว (ไม่จำกัดโควตารายวัน)' : 'ยังไม่เคยซื้อ (จำกัดโควตารายวัน)'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link href="/admin/credit-adjust">ปรับเครดิตผู้ใช้</Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="size-4" />
                การชำระเงิน
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm">
                ตรวจสอบคิวออเดอร์และยอดเติมเครดิตผ่าน SlipOK
              </p>
              <Button asChild size="sm" variant="outline" className="mt-3">
                <Link href="/admin/orders">ดูคิวออเดอร์</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}