'use client';

import { useRef, useState } from 'react';
import { Loader2, TriangleAlert, Upload, X } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { formatBaht } from '@/lib/site-config';

export type CheckoutPackage = {
  /** `credit_packages.id` — the API keys orders off the uuid, not the code. */
  id: string;
  code: string;
  name: string;
  priceThb: number;
  credits: number;
  qrPath: string;
  featured: boolean;
};

type Phase =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'awaiting-slip'; orderId: string; amountThb: number; credits: number }
  | { kind: 'checking'; orderId: string; amountThb: number; credits: number }
  | { kind: 'failed'; message: string; retryable: boolean; orderId: string; amountThb: number; credits: number };

export function CheckoutCard({
  pkg,
  signedIn,
}: {
  pkg: CheckoutPackage;
  signedIn: boolean;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function start() {
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent('/pricing')}`);
      return;
    }
    setPhase({ kind: 'creating' });
    try {
      const res = await fetch('/api/payments/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ packageId: pkg.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'สร้างออเดอร์ไม่สำเร็จ');
      setPhase({
        kind: 'awaiting-slip',
        orderId: data.orderId,
        amountThb: data.amountThb ?? pkg.priceThb,
        credits: data.credits ?? pkg.credits,
      });
    } catch (err) {
      toast.error((err as Error).message);
      setPhase({ kind: 'idle' });
    }
  }

  async function submit(file: File) {
    if (phase.kind !== 'awaiting-slip') return;
    setPhase({ ...phase, kind: 'checking' });

    const form = new FormData();
    form.append('orderId', phase.orderId);
    form.append('slip', file);

    try {
      const res = await fetch('/api/payments/slip', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPhase({
          kind: 'failed',
          message: data.message ?? data.error ?? 'ตรวจสลิปไม่ผ่าน',
          retryable: Boolean(data.retryable),
          orderId: phase.orderId,
          amountThb: phase.amountThb,
          credits: phase.credits,
        });
        return;
      }
      toast.success(`เติมเครดิต ${data.credits} สำเร็จ`);
      // The balance lives in the layout, so a refresh is the honest update.
      router.refresh();
    } catch {
      setPhase({
        kind: 'failed',
        message: 'เชื่อมต่อไม่สำเร็จ — ลองใหม่อีกครั้ง',
        retryable: true,
        orderId: phase.orderId,
        amountThb: phase.amountThb,
        credits: phase.credits,
      });
    }
  }

  const busy = phase.kind === 'creating' || phase.kind === 'checking';
  const open =
    phase.kind === 'awaiting-slip' ||
    phase.kind === 'checking' ||
    phase.kind === 'failed';

  return (
    <div className="mt-auto space-y-3">
      {open ? (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              โอน {formatBaht(phase.amountThb)} แล้วอัปโหลดสลิป
            </p>
            <Button
              size="icon"
              variant="ghost"
              aria-label="ยกเลิก"
              onClick={() => setPhase({ kind: 'idle' })}
            >
              <X className="size-4" />
            </Button>
          </div>

          {/* Static per-amount PromptPay QR. `unoptimized` keeps the PNG
              lossless — re-encoding a QR blurs its modules enough to break
              phone scanning. */}
          <Image
            src={pkg.qrPath}
            alt={`QR ชำระเงิน ${pkg.name} ${pkg.priceThb} บาท`}
            width={530}
            height={530}
            unoptimized
            className="mx-auto aspect-square w-full max-w-56 rounded-lg border"
          />

          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void submit(file);
              e.target.value = '';
            }}
          />

          <Button
            className="w-full"
            variant="outline"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            {phase.kind === 'checking' ? 'กำลังตรวจสอบ…' : 'อัปโหลดสลิป'}
          </Button>

          {phase.kind === 'failed' && (
            <p className="flex items-start gap-2 text-xs text-destructive">
              <TriangleAlert className="mt-px size-3.5 shrink-0" />
              {phase.message}
              {phase.retryable && ' (สลิปยังใช้ได้ ลองอัปโหลดใหม่ได้)'}
            </p>
          )}
        </>
      ) : (
        <>
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
          <Button
            className="w-full"
            variant={pkg.featured ? 'default' : 'outline'}
            disabled={busy}
            onClick={() => void start()}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            ซื้อและอัปโหลดสลิป
          </Button>
        </>
      )}
    </div>
  );
}