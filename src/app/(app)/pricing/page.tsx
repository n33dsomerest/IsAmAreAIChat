import { Check } from 'lucide-react';
import Image from 'next/image';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  CREDIT_PACKAGES,
  formatBaht,
  FREE_TIER,
  pricePerRequest,
} from '@/lib/site-config';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'ราคา',
};

export default function PricingPage() {
  return (
    <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight">เลือกแพ็กเกจ</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            เครดิตไม่มีวันหมดอายุ · ใช้ได้กับทุกโมเดลในระบบ
          </p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CREDIT_PACKAGES.map((pkg) => {
            const featured = pkg.code === 'standard';
            return (
              <Card
                key={pkg.code}
                className={cn(
                  'relative flex flex-col',
                  featured && 'border-primary shadow-md',
                )}
              >
                {featured && (
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

                  {/* Static per-amount PromptPay QR, cropped by scripts/crop-qr.mjs.
                      `unoptimized` keeps the PNG lossless — re-encoding a QR can
                      blur its modules enough to break scanning. */}
                  <div className="mt-auto space-y-2">
                    <Image
                      src={pkg.qrPath}
                      alt={`QR ชำระเงิน ${pkg.name} ${pkg.priceThb} บาท`}
                      width={530}
                      height={530}
                      unoptimized
                      className="mx-auto aspect-square w-full max-w-56 rounded-lg border"
                    />
                    <p className="text-muted-foreground text-center text-xs">
                      สแกนเพื่อโอน {pkg.priceThb}.00 บาท
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <p className="text-muted-foreground mt-8 text-center text-xs">
          ผู้ใช้ใหม่ใช้ฟรี {FREE_TIER.welcomeCredits} เครดิต ·{' '}
          {FREE_TIER.trialDays} วันแรกได้ {FREE_TIER.dailyQuota} คำขอต่อวัน จากนั้นลดเหลือ{' '}
          {FREE_TIER.dailyQuotaAfterTrial} คำขอต่อวันจนกว่าจะซื้อแพ็ก
        </p>
      </div>
    </div>
  );
}