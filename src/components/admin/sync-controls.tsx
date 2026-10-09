'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Mode = 'free' | 'all' | 'none';

const MODE_LABEL: Record<Mode, string> = {
  free: 'เฉพาะโมเดลฟรี',
  all: 'ทั้งหมด',
  none: 'ปิดทั้งหมด',
};

const MODE_HINT: Record<Mode, string> = {
  free: 'เปิดเฉพาะ id ที่ลงท้าย :free — เหมาะที่สุดเป็นค่าเริ่มต้น',
  all: 'เปิดทุกโมเดลที่ค้นพบ รวมทั้งที่ต้องจ่ายเงิน',
  none: 'ค้นพบแต่ไม่เปิดใช้ เพื่อให้เลือกเปิดเองทีละตัว',
};

/**
 * Sync writes the catalogue first, then decides what to switch on. The mode is
 * a deliberate choice rather than an automatic flag: a paid model is not
 * automatically a fallback, and a 458-row picker is unusable.
 */
export function SyncControls({
  busy,
  onSync,
}: {
  busy: boolean;
  onSync: (mode: Mode) => void;
}) {
  const [mode, setMode] = useState<Mode>('free');

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="text-xs">
            {MODE_LABEL[mode]}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>หลังซิงก์จะเปิดใช้</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
            <DropdownMenuItem key={m} onSelect={() => setMode(m)}>
              <div>
                <div className="font-medium">{MODE_LABEL[m]}</div>
                <div className="text-muted-foreground text-xs">{MODE_HINT[m]}</div>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button size="sm" variant="outline" disabled={busy} onClick={() => onSync(mode)}>
        <RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} />
        ซิงก์
      </Button>
    </div>
  );
}