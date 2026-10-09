'use client';

import { useEffect, useState, useTransition } from 'react';
import { Check, KeyRound, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { SyncControls } from '@/components/admin/sync-controls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Provider = {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  envKeyName: string;
  enabled: boolean;
  sortOrder: number;
  keyConfigured: boolean;
};

const KIND_LABEL: Record<string, string> = {
  'openai-compatible': 'OpenAI-compatible',
  anthropic: 'Anthropic',
  google: 'Google',
};

export function ProvidersPanel() {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [busy, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/admin/providers')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setProviders(data.providers ?? []);
      })
      .catch(() => {
        if (!cancelled) setProviders([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function syncAll(providerId: string, mode: 'free' | 'all' | 'none') {
    startTransition(async () => {
      const res = await fetch(`/api/admin/providers/${providerId}/sync`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`ซิงก์ไม่สำเร็จ: ${data.message ?? data.error ?? res.status}`);
        return;
      }
      toast.success(
        `ซิงก์ ${data.provider} แล้ว — พบ ${data.total ?? 0} โมเดล เปิดใช้ ${data.enabled ?? 0}`,
      );
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {providers ? `${providers.length} ผู้ให้บริการ` : 'กำลังโหลด…'}
        </p>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Plus className="size-4" />
              เพิ่มผู้ให้บริการ
            </Button>
          </DialogTrigger>
          <DialogContent>
            <AddProviderForm
              onDone={(p) => {
                setProviders((prev) => [...(prev ?? []), p]);
                setOpen(false);
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {!providers && (
        <p className="text-muted-foreground text-sm">กำลังโหลดรายชื่อผู้ให้บริการ…</p>
      )}

      {providers?.map((p) => (
        <ProviderCard key={p.id} provider={p} busy={busy} onSync={syncAll} />
      ))}
    </div>
  );
}

function ProviderCard({
  provider,
  busy,
  onSync,
}: {
  provider: Provider;
  busy: boolean;
  onSync: (id: string, mode: 'free' | 'all' | 'none') => void;
}) {
  return (
    <section className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-medium">{provider.name}</h2>
            <Badge variant="secondary">{KIND_LABEL[provider.kind] ?? provider.kind}</Badge>
            {provider.enabled ? (
              <Badge variant="outline">ลำดับ {provider.sortOrder}</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                ปิดอยู่
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground mt-1 truncate font-mono text-xs">
            {provider.baseUrl}
          </p>
          <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
            <KeyRound className="size-3" />
            <span className="font-mono">{provider.envKeyName}</span>
            {provider.keyConfigured ? (
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <Check className="size-3" /> ตั้งค่าแล้ว
              </span>
            ) : (
              <span className="text-destructive">ยังไม่ได้ตั้งค่า</span>
            )}
          </p>
        </div>

        <SyncControls busy={busy} onSync={(mode) => onSync(provider.id, mode)} />
      </div>
    </section>
  );
}

function AddProviderForm({ onDone }: { onDone: (p: Provider) => void }) {
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    setBusy(true);
    try {
      const res = await fetch('/api/admin/providers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.get('name'),
          kind: form.get('kind'),
          baseUrl: form.get('baseUrl'),
          envKeyName: form.get('envKeyName'),
          sortOrder: Number(form.get('sortOrder') ?? 0),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.issues?.[0]?.message ?? data.error ?? 'บันทึกไม่สำเร็จ');
        return;
      }
      toast.success('เพิ่มผู้ให้บริการแล้ว');
      onDone({ ...data.provider, keyConfigured: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>เพิ่มผู้ให้บริการ</DialogTitle>
        <DialogDescription>
          ใส่ชื่อตัวแปร env ที่เก็บคีย์ — ใส่คีย์จริงในไฟล์ env ของเซิร์ฟเวอร์เท่านั้น
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ชื่อ" name="name" placeholder="openrouter" required />
        <div className="space-y-2">
          <Label htmlFor="kind">ประเภท</Label>
          <select
            id="kind"
            name="kind"
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
            defaultValue="openai-compatible"
          >
            <option value="openai-compatible">OpenAI-compatible</option>
            <option value="anthropic">Anthropic</option>
            <option value="google">Google</option>
          </select>
        </div>
      </div>

      <Field
        label="Base URL"
        name="baseUrl"
        placeholder="https://gen.ai.kku.ac.th/okmd/api/v1"
        required
        className="font-mono"
      />
      <Field
        label="ตัวแปร env ของคีย์"
        name="envKeyName"
        placeholder="OKMD_API_KEY"
        required
        className="font-mono"
      />
      <Field label="ลำดับความสำคัญ" name="sortOrder" type="number" defaultValue="10" />

      <DialogFooter>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          บันทึก
        </Button>
      </DialogFooter>
    </form>
  );
}

function Field({
  label,
  name,
  ...rest
}: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} required {...rest} />
    </div>
  );
}