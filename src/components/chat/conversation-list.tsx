'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MessageSquare, Pin, PinOff, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ConversationRow = {
  id: string;
  title: string;
  folder: string | null;
  pinned: boolean;
  archived: boolean;
  updatedAt: string;
  messageCount: number;
};

export function ConversationList({ activeId }: { activeId?: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<ConversationRow[] | null>(null);

  // Fetching inside the effect rather than a `useEffect` setState pair: the
  // render already owns the "not loaded yet" state.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/conversations')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setRows(data.conversations ?? []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const folders = [...new Set(rows?.map((r) => r.folder).filter(Boolean) ?? [])] as string[];
  const groups = [
    { key: null as string | null, items: rows?.filter((r) => !r.folder) ?? [] },
    ...folders.map((f) => ({ key: f, items: rows?.filter((r) => r.folder === f) ?? [] })),
  ].filter((g) => g.items.length > 0);

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) router.refresh();
  }

  async function remove(id: string, title: string) {
    if (!confirm(`ลบ "${title}" ?`)) return;
    const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    if (res.ok) {
      router.refresh();
      if (id === activeId) router.push('/');
    } else {
      toast.error('ลบไม่สำเร็จ');
    }
  }

  if (!rows) {
    return <p className="text-muted-foreground px-1 text-xs">กำลังโหลด…</p>;
  }

  if (!rows.length) {
    return <p className="text-muted-foreground px-1 text-xs">ยังไม่มีสนทนา</p>;
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.key ?? '__unfiled'}>
          <p className="text-muted-foreground px-1 pb-1.5 text-xs font-medium tracking-wide uppercase">
            {group.key ?? 'สนทนาล่าสุด'}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((row) => (
              <li key={row.id} className="group/item relative">
                <Link
                  href={`/chat/${row.id}`}
                  className={cn(
                    'hover:bg-accent flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                    row.id === activeId && 'bg-accent font-medium',
                  )}
                >
                  <MessageSquare className="size-3.5 shrink-0 opacity-60" />
                  <span className="truncate">{row.title}</span>
                  {row.pinned && <Pin className="ml-auto size-3 shrink-0 opacity-60" />}
                </Link>

                <div className="absolute top-1/2 right-1 hidden -translate-y-1/2 gap-0.5 group-hover/item:flex">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-6"
                    aria-label={row.pinned ? 'เลิกปักหมุด' : 'ปักหมุด'}
                    onClick={() => void patch(row.id, { pinned: !row.pinned })}
                  >
                    {row.pinned ? (
                      <PinOff className="size-3" />
                    ) : (
                      <Pin className="size-3" />
                    )}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-6"
                    aria-label="ลบสนทนา"
                    onClick={() => void remove(row.id, row.title)}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}