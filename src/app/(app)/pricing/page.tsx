import { Check } from 'lucide-react';
import { asc, eq } from 'drizzle-orm';

import { CheckoutCard } from '@/components/pricing/checkout-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/auth/current-user';
import { db } from '@/lib/db';
import { creditPackages } from '@/lib/db/schema';
import { FREE_TIER, formatBaht, pricePerRequest } from '@/lib/site-config';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'ราคา',
};

/** The catalogue and the signed-in user are both per-request. */
export const instant = false;

/** Reads the catalogue from the database so the page and the orders API cannot drift. */
export default async function PricingPage() {
  const [user, rows] = await Promise.all([
    getCurrentUser(),
    db
      .select()
      .from(creditPackages)
      .where(eq(creditPackages.active, true))
      .orderBy(asc(creditPackages.sortOrder)),
  ]);

  const packages = rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    priceThb: row.priceThb,
    credits: row.credits,
    qrPath: row.qrPath ?? `/qr/${row.priceThb}Baht.png`,
    featured: row.code === 'standard',
  }));

  return (
    <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight">เลือกแพ็กเกจ</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            เครดิตไม่มีวันหมดอายุ · ใช้ได้กับทุกโมเดลในระบบ · สแกน QR
            แล้วอัปโหลดสลิปเพื่อรับเครดิตอัตโนมัติ
          </p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {packages.map((pkg) => (
            <Card
              key={pkg.id}
              className={cn(
                'relative flex flex-col',
                pkg.featured && 'border-primary shadow-md',
              )}
            >
              {pkg.featured && (
                <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                  คุ้มค่าที่สุด
                </Badge>
              )}

              <CardContent className="flex flex-1 flex-col gap-4">
                <div>
                  <p className="font-semibold">{pkg.name}</p>
                  <p className="mt-1 text-3xl font-bold tabular-nums">
                    {formatBaht(pkg.priceThb)}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {pkg.credits} requests · ประมาณ{' '}
                    {pricePerRequest(pkg.priceThb, pkg.credits).toFixed(3)} บาท/ครั้ง
                  </p>
                </div>

                <ul className="text-muted-foreground space-y-1.5 text-sm">
                  <li className="flex items-center gap-2">
                    <Check className="size-4 shrink-0" />
                    {pkg.credits} คำขอ
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="size-4 shrink-0" />
                    ไม่มีวันหมดอายุ
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="size-4 shrink-0" />
                    ปลดล็อกโควต้าต่อวัน
                  </li>
                </ul>

                <CheckoutCard pkg={pkg} signedIn={Boolean(user)} />
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="text-muted-foreground mt-8 text-center text-xs">
          ผู้ใช้ใหม่ใช้ฟรี {FREE_TIER.welcomeCredits} เครดิต · {FREE_TIER.trialDays}{' '}
          วันแรกได้ {FREE_TIER.dailyQuota} คำขอต่อวัน จากนั้นลดเหลือ{' '}
          {FREE_TIER.dailyQuotaAfterTrial} คำขอต่อวันจนกว่าจะซื้อแพ็ก
        </p>
      </div>
    </div>
  );
}