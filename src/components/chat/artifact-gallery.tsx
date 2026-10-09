'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';

import { ArtifactCard } from '@/components/chat/artifact-card';
import type { Artifact } from '@/lib/chat/artifacts';
import { Input } from '@/components/ui/input';

type Row = Artifact & {
  id: string;
  updatedAt: string;
  conversationId: string;
  conversationTitle: string;
};

export function ArtifactGallery() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/artifacts')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setRows(data.artifacts ?? []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!rows) {
    return <p className="text-muted-foreground text-sm">กำลังโหลด…</p>;
  }

  if (!rows.length) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed py-16 text-center text-sm">
        ยังไม่มีชิ้นงาน — ลองขอให้ผู้ช่วยสร้างหน้าเว็บหรือกราฟดู
      </p>
    );
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter(
        (r) =>
          (r.title ?? '').toLowerCase().includes(q) ||
          r.language.toLowerCase().includes(q) ||
          r.conversationTitle.toLowerCase().includes(q),
      )
    : rows;

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหาชิ้นงาน"
          className="pl-9"
        />
      </div>

      <p className="text-muted-foreground text-xs">
        แสดง {filtered.length} จาก {rows.length} ชิ้นงาน
      </p>

      <div className="space-y-4">
        {filtered.map((row) => (
          <div key={row.id} className="space-y-1">
            <Link
              href={`/chat/${row.conversationId}`}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              จาก &ldquo;{row.conversationTitle}&rdquo;
            </Link>
            <ArtifactCard
              artifact={{
                id: row.id,
                title: row.title,
                language: row.language,
                source: row.source,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}