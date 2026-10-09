'use client';

import { useMemo, useState } from 'react';
import { Eye, EyeOff, Search, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

type ModelRow = {
  id: string;
  displayName: string;
  remoteModelId: string;
  contextWindow: number | null;
  capabilities: Record<string, boolean> | null;
  enabled: boolean;
  isFallback: boolean;
  sortOrder: number;
  providerName: string;
  providerEnabled: boolean;
  lastSyncedAt: string | null;
};

const CAP_LABEL: Record<string, string> = {
  vision: 'vision',
  tools: 'tools',
  reasoning: 'reason',
  json: 'json',
  pdf: 'pdf',
};

export function ModelsPanel({ models }: { models: ModelRow[] }) {
  const [rows, setRows] = useState(models);
  const [query, setQuery] = useState('');
  const [onlyLive, setOnlyLive] = useState(false);

  const providerNames = useMemo(
    () => [...new Set(rows.map((r) => r.providerName))],
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyLive && !r.enabled) return false;
      if (!q) return true;
      return (
        r.displayName.toLowerCase().includes(q) ||
        r.remoteModelId.toLowerCase().includes(q) ||
        r.providerName.toLowerCase().includes(q)
      );
    });
  }, [rows, query, onlyLive]);

  async function patch(id: string, body: { enabled?: boolean; isFallback?: boolean }) {
    const res = await fetch('/api/admin/models', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? 'อัปเดตไม่สำเร็จ');
      return;
    }
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...data.model } : r)),
    );
  }

  const liveCount = rows.filter((r) => r.enabled).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาชื่อโมเดลหรือ id"
            className="pl-9"
          />
        </div>
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          <Switch checked={onlyLive} onCheckedChange={setOnlyLive} />
          เฉพาะที่เปิดใช้
        </label>
        <Badge variant="secondary">
          เปิดใช้ {liveCount} / {rows.length}
        </Badge>
      </div>

      <p className="text-muted-foreground text-xs">
        แสดง {filtered.length} รายการ · ผู้ให้บริการ: {providerNames.join(', ')}
      </p>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground text-left">
            <tr>
              <th className="px-3 py-2 font-medium">โมเดล</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">ความสามารถ</th>
              <th className="hidden px-3 py-2 font-medium lg:table-cell">บริบท</th>
              <th className="px-3 py-2 text-right font-medium">เปิดใช้</th>
              <th className="px-3 py-2 text-right font-medium">สำรอง</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <ModelTableRow key={m.id} model={m} onPatch={patch} />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="text-muted-foreground px-3 py-8 text-center">
                  ไม่พบโมเดลที่ตรงเงื่อนไข
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ModelTableRow({
  model,
  onPatch,
}: {
  model: ModelRow;
  onPatch: (id: string, body: { enabled?: boolean; isFallback?: boolean }) => void;
}) {
  const caps = model.capabilities ?? {};
  const capKeys = Object.keys(CAP_LABEL).filter((k) => caps[k]);
  const dead = !model.providerEnabled;

  return (
    <tr className="border-t">
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-medium">{model.displayName}</span>
          {dead && (
            <Badge variant="outline" className="text-muted-foreground">
              ผู้ให้บริการปิด
            </Badge>
          )}
        </div>
        <div className="text-muted-foreground mt-0.5 truncate font-mono text-xs">
          {model.providerName} · {model.remoteModelId}
        </div>
      </td>

      <td className="hidden px-3 py-2 md:table-cell">
        {capKeys.length ? (
          <div className="flex flex-wrap gap-1">
            {capKeys.map((k) => (
              <Badge key={k} variant="secondary" className="text-[10px]">
                {CAP_LABEL[k]}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </td>

      <td className="text-muted-foreground hidden px-3 py-2 text-xs tabular-nums lg:table-cell">
        {model.contextWindow ? `${(model.contextWindow / 1000).toFixed(0)}k` : '—'}
      </td>

      <td className="px-3 py-2 text-right">
        <Button
          size="icon"
          variant="ghost"
          aria-label={model.enabled ? 'ปิดโมเดลนี้' : 'เปิดโมเดลนี้'}
          disabled={dead}
          onClick={() => onPatch(model.id, { enabled: !model.enabled })}
        >
          {model.enabled ? (
            <Eye className="size-4" />
          ) : (
            <EyeOff className="text-muted-foreground size-4" />
          )}
        </Button>
      </td>

      <td className="px-3 py-2 text-right">
        <Button
          size="icon"
          variant="ghost"
          aria-label={model.isFallback ? 'ใช้เป็นโมเดลหลัก' : 'ทำเป็นโมเดลสำรอง'}
          disabled={!model.enabled}
          onClick={() => onPatch(model.id, { isFallback: !model.isFallback })}
          className={model.isFallback ? 'text-amber-600 dark:text-amber-400' : ''}
        >
          <ShieldCheck className="size-4" />
        </Button>
      </td>
    </tr>
  );
}