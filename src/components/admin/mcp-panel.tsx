'use client';

import { useState } from 'react';
import { Loader2, Plug, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

type Server = {
  id: string;
  name: string;
  url: string;
  transport: 'http' | 'sse';
  enabled: boolean;
  toolCount: number;
  lastCheckedAt: string | null;
  lastError: string | null;
};

export function McpPanel({ initial }: { initial: Server[] }) {
  const [servers, setServers] = useState(initial);
  const [probing, setProbing] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch('/api/admin/mcp');
    const data = await res.json().catch(() => ({ servers: [] }));
    setServers(data.servers ?? []);
  }

  async function probe(id: string) {
    setProbing(id);
    try {
      const res = await fetch('/api/admin/mcp', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, action: 'probe' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? 'เชื่อมต่อไม่สำเร็จ');
      } else {
        toast.success(`พบ ${data.tools?.length ?? 0} เครื่องมือ`);
      }
      await refresh();
    } finally {
      setProbing(null);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch('/api/admin/mcp', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, ...body }),
    });
    await refresh();
  }

  async function remove(server: Server) {
    if (!confirm(`ลบ ${server.name} ?`)) return;
    await fetch(`/api/admin/mcp?id=${server.id}`, { method: 'DELETE' });
    await refresh();
  }

  return (
    <div className="space-y-4">
      <AddServer
        onDone={async () => {
          await refresh();
        }}
      />

      {servers.length === 0 && (
        <p className="text-muted-foreground rounded-lg border border-dashed py-10 text-center text-sm">
          ยังไม่ได้เชื่อม MCP server ใด
        </p>
      )}

      {servers.map((server) => (
        <section key={server.id} className="rounded-lg border p-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="font-medium">{server.name}</h2>
                <Badge variant="secondary">{server.transport}</Badge>
                {server.toolCount > 0 && (
                  <Badge variant="outline">{server.toolCount} เครื่องมือ</Badge>
                )}
              </div>
              <p className="text-muted-foreground mt-1 truncate font-mono text-xs">
                {server.url}
              </p>
              {server.lastError && (
                <p className="text-destructive mt-1 text-xs">{server.lastError}</p>
              )}
              {server.lastCheckedAt && !server.lastError && (
                <p className="text-muted-foreground mt-1 text-xs">
                  ตรวจล่าสุด{' '}
                  {new Date(server.lastCheckedAt).toLocaleString('th-TH', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-xs">
                <Switch
                  checked={server.enabled}
                  onCheckedChange={(v) => void patch(server.id, { enabled: v })}
                />
                {server.enabled ? 'เปิด' : 'ปิด'}
              </label>
              <Button
                size="sm"
                variant="outline"
                disabled={probing === server.id}
                onClick={() => void probe(server.id)}
              >
                {probing === server.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plug className="size-4" />
                )}
                ทดสอบ
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label={`ลบ ${server.name}`}
                onClick={() => void remove(server)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

function AddServer({ onDone }: { onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    setBusy(true);
    try {
      const res = await fetch('/api/admin/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.get('name'),
          url: form.get('url'),
          transport: form.get('transport'),
          headers: {},
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.issues?.[0]?.message ?? data.error ?? 'บันทึกไม่สำเร็จ');
        return;
      }
      toast.success('เพิ่ม MCP server แล้ว — กด "ทดสอบ" เพื่อดึงรายการเครื่องมือ');
      setOpen(false);
      await onDone();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        เพิ่ม MCP server
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="mcp-name">ชื่อ</Label>
          <Input id="mcp-name" name="name" placeholder="filesystem" required />
          <p className="text-muted-foreground text-xs">
            ใช้เป็น prefix ของชื่อเครื่องมือ จึงใช้ได้เฉพาะ ตัวอักษร ตัวเลข และ -
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="mcp-transport">การเชื่อมต่อ</Label>
          <select
            id="mcp-transport"
            name="transport"
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
            defaultValue="http"
          >
            <option value="http">Streamable HTTP</option>
            <option value="sse">SSE</option>
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="mcp-url">URL</Label>
        <Input
          id="mcp-url"
          name="url"
          type="url"
          placeholder="https://example.com/mcp"
          className="font-mono"
          required
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          บันทึก
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          ยกเลิก
        </Button>
      </div>
    </form>
  );
}