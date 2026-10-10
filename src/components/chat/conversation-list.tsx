'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
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

/**
 * One key for the whole sidebar, so a mutation can update the cache from
 * anywhere in the tree — the chat view needs it after a new conversation is
 * created or after a title is derived from the first prompt.
 */
export const CONVERSATIONS_KEY = '/api/conversations';

async function fetcher(url: string): Promise<ConversationRow[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('โหลดรายการสนทนาไม่สำเร็จ');
  const data = await res.json();
  return data.conversations ?? [];
}

export function ConversationList({ activeId }: { activeId?: string }) {
  const router = useRouter();
  const { data: rows, error, mutate } = useSWR<ConversationRow[]>(CONVERSATIONS_KEY, fetcher);

  // The list used to load once per mount and rely on router.refresh(), which
  // re-renders the server components without touching this state — so pinning,
  // deleting or renaming showed nothing until the page was reloaded. SWR makes
  // the cache and the server the same thing, so mutate() below updates the list
  // directly and revalidates behind it.

  const folders = [...new Set(rows?.map((r) => r.folder).filter(Boolean) ?? [])] as string[];
  const groups = [
    { key: null as string | null, items: rows?.filter((r) => !r.folder) ?? [] },
    ...folders.map((f) => ({ key: f, items: rows?.filter((r) => r.folder === f) ?? [] })),
  ].filter((g) => g.items.length > 0);

  /** Applies a change to the cache at once, then reconciles with the server. */
  async function patch(id: string, body: Record<string, unknown>) {
    // `pinned` is the only field this list renders, so an optimistic update
    // only has to cover it; everything else waits for the revalidation.
    const optimistic = typeof body.pinned === 'boolean' ? { pinned: body.pinned as boolean } : null;
    if (optimistic) {
      mutate((prev) => prev?.map((r) => (r.id === id ? { ...r, ...optimistic } : r)), {
        revalidate: false,
      });
    }

    const res = await fetch(`/api/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      toast.error('แก้ไขไม่สำเร็จ');
      if (optimistic) mutate(); // put the row back the way the server has it
      return;
    }
    await mutate();
  }

  async function remove(id: string, title: string) {
    if (!confirm(`ลบ "${title}" ?`)) return;
    const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    if (res.ok) {
      // Drop it from the cache immediately — waiting for the revalidation would
      // leave a row on screen that no longer exists.
      mutate((prev) => prev?.filter((r) => r.id !== id), { revalidate: false });
      await mutate();
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

  if (error) {
    return (
      <div className="space-y-2 px-1 text-xs">
        <p className="text-destructive">โหลดรายการสนทนาไม่สำเร็จ</p>
        <Button size="sm" variant="outline" className="w-full" onClick={() => void mutate()}>
          ลองอีกครั้ง
        </Button>
      </div>
    );
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