'use client';

import { useState } from 'react';
import { FileText, ImageIcon, Loader2 } from 'lucide-react';

import type { AttachmentRef } from '@/lib/chat/history';

/**
 * The attachments on one message.
 *
 * Images come from `/api/attachments/[id]`, which checks ownership and reads
 * from the private bucket, so nothing here is a public URL. A plain `img` tag
 * is enough — the response is same-origin and the endpoint already gates it.
 */
export function AttachmentList({ items }: { items: AttachmentRef[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {items.map((a) =>
        a.kind === 'image' ? <ImageItem key={a.attachmentId} file={a} /> : <ChipItem key={a.attachmentId} file={a} />,
      )}
    </div>
  );
}

function ImageItem({ file }: { file: AttachmentRef }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (failed) return <ChipItem file={file} />;

  return (
    <a
      href={`/api/attachments/${file.attachmentId}`}
      target="_blank"
      rel="noreferrer"
      className="group relative block size-24 overflow-hidden rounded-lg border"
    >
      {!loaded && (
        <span className="absolute inset-0 grid place-items-center">
          <Loader2 className="text-muted-foreground size-4 animate-spin" />
        </span>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- served by an
          ownership-checked API route, not a static asset */}
      <img
        src={`/api/attachments/${file.attachmentId}`}
        alt={file.name}
        className={`size-full object-cover transition-opacity group-hover:opacity-90 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </a>
  );
}

function ChipItem({ file }: { file: AttachmentRef }) {
  const Icon = file.kind === 'pdf' ? FileText : FileText;
  return (
    <a
      href={`/api/attachments/${file.attachmentId}`}
      target="_blank"
      rel="noreferrer"
      className="bg-muted/60 hover:bg-muted inline-flex max-w-56 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs"
    >
      <Icon className="text-muted-foreground size-3.5 shrink-0" />
      <span className="truncate">{file.name}</span>
      <span className="text-muted-foreground shrink-0 tabular-nums">{sizeLabel(file.sizeBytes)}</span>
    </a>
  );
}

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export { ImageIcon };