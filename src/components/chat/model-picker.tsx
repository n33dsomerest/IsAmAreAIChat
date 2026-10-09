'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';

export type PickerModel = {
  id: string;
  label: string;
  provider: string;
  providerId: string;
  isFallback: boolean;
  contextWindow: number | null;
  maxOutput: number | null;
  capabilities: Record<string, boolean> | null;
};

const CAP_LABEL: Record<string, string> = {
  vision: 'vision',
  tools: 'tools',
  reasoning: 'reason',
  json: 'json',
  pdf: 'pdf',
};

function compact(n: number | null): string {
  if (!n) return '';
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M ctx`;
  return `${Math.round(n / 1000)}k ctx`;
}

export function ModelPicker({
  models,
  value,
  onChange,
}: {
  models: PickerModel[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? models.filter(
          (m) =>
            m.label.toLowerCase().includes(q) ||
            m.provider.toLowerCase().includes(q),
        )
      : models;

    const byProvider = new Map<string, PickerModel[]>();
    for (const m of filtered) {
      const list = byProvider.get(m.provider) ?? [];
      list.push(m);
      byProvider.set(m.provider, list);
    }
    return [...byProvider.entries()];
  }, [models, query]);

  const selected = models.find((m) => m.id === value);

  if (!models.length) {
    return (
      <p className="text-muted-foreground px-4 py-2 text-sm">
        ยังไม่มีโมเดลที่เปิดใช้งาน — ให้ผู้ดูแลระบบเปิดโมเดลในหน้า /admin/models
      </p>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-64 gap-1.5">
          <span className="truncate">{selected?.label ?? 'เลือกโมเดล'}</span>
          {selected?.isFallback && (
            <ShieldCheck className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          )}
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-80">
        <div className="px-2 pb-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาโมเดล"
            className="h-8"
          />
        </div>

        {groups.length === 0 && (
          <p className="text-muted-foreground px-2 py-3 text-center text-sm">
            ไม่พบโมเดล
          </p>
        )}

        {groups.map(([provider, list]) => (
          <div key={provider}>
            <DropdownMenuLabel className="text-xs">{provider}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {list.map((m) => {
              const caps = Object.keys(CAP_LABEL).filter((k) => m.capabilities?.[k]);
              return (
                <DropdownMenuItem
                  key={m.id}
                  onSelect={() => onChange(m.id)}
                  className="flex-col items-start gap-0.5 py-1.5"
                >
                  <div className="flex w-full items-center gap-1.5">
                    <span className="truncate text-sm">{m.label}</span>
                    {m.isFallback && (
                      <Badge
                        variant="outline"
                        className="h-4 shrink-0 border-amber-500/40 px-1 text-[10px] text-amber-600 dark:text-amber-400"
                      >
                        สำรอง
                      </Badge>
                    )}
                  </div>
                  <div className="text-muted-foreground flex w-full items-center gap-2 text-xs">
                    {compact(m.contextWindow) && <span>{compact(m.contextWindow)}</span>}
                    {caps.map((k) => (
                      <span key={k}>{CAP_LABEL[k]}</span>
                    ))}
                  </div>
                </DropdownMenuItem>
              );
            })}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}