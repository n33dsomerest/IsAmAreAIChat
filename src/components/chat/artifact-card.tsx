'use client';

import { useMemo, useState } from 'react';
import { Code2, Copy, Download, Eye, Maximize2, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { isRenderable, type Artifact } from '@/lib/chat/artifacts';

/**
 * Renders an artifact in a sandboxed iframe.
 *
 * `sandbox` has no `allow-same-origin`, so the preview runs in an opaque
 * origin: it cannot reach this page, its cookies, or localStorage, and it
 * cannot navigate the parent. Model-authored HTML is untrusted input and is
 * treated as such.
 */
export function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  const [open, setOpen] = useState(false);

  const renderable = isRenderable(artifact.language);

  const doc = useMemo(() => {
    if (artifact.language.toLowerCase() === 'svg') {
      return `<!doctype html><meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:transparent">${artifact.source}</body>`;
    }
    if (artifact.language.toLowerCase() === 'html') return artifact.source;
    return `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:16px;font:13px ui-monospace,monospace;white-space:pre-wrap">${escapeHtml(artifact.source)}</body>`;
  }, [artifact]);

  async function copy() {
    await navigator.clipboard.writeText(artifact.source);
    toast.success('คัดลอกโค้ดแล้ว');
  }

  function download() {
    const ext = artifact.language === 'html' ? 'html' : artifact.language;
    const url = URL.createObjectURL(
      new Blob([artifact.source], { type: 'text/plain;charset=utf-8' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(artifact.title ?? 'artifact').replace(/\W+/g, '-')}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5">
        <Code2 className="size-3.5 shrink-0 opacity-60" />
        <span className="truncate text-xs font-medium">
          {artifact.title ?? 'ชิ้นงาน'}
        </span>
        <Badgeish label={artifact.language} />

        <div className="ml-auto flex items-center gap-0.5">
          {renderable && (
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label={mode === 'preview' ? 'ดูโค้ด' : 'ดูตัวอย่าง'}
              onClick={() => setMode((m) => (m === 'preview' ? 'source' : 'preview'))}
            >
              {mode === 'preview' ? <Code2 className="size-3.5" /> : <Eye className="size-3.5" />}
            </Button>
          )}
          <Button size="icon" variant="ghost" className="size-7" aria-label="คัดลอก" onClick={() => void copy()}>
            <Copy className="size-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="size-7" aria-label="ดาวน์โหลด" onClick={() => download()}>
            <Download className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label={open ? 'ปิด' : 'ขยาย'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </Button>
        </div>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <span className="truncate text-sm font-medium">
              {artifact.title ?? 'ชิ้นงาน'}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="ml-auto size-8"
              aria-label="ปิด"
              onClick={() => setOpen(false)}
            >
              <X className="size-4" />
            </Button>
          </div>
          <Body doc={doc} renderable={renderable} source={artifact.source} />
        </div>
      ) : (
        <Body doc={doc} renderable={renderable} source={artifact.source} />
      )}
    </div>
  );
}

function Body({
  doc,
  renderable,
  source,
}: {
  doc: string;
  renderable: boolean;
  source: string;
}) {
  if (!renderable) {
    return (
      <pre className="max-h-64 overflow-auto p-3 text-xs whitespace-pre-wrap">
        {source}
      </pre>
    );
  }

  return (
    <iframe
      // srcDoc plus a sandbox with no allow-same-origin: the document runs in
      // an opaque origin and cannot touch the app.
      srcDoc={doc}
      sandbox="allow-scripts"
      title="artifact preview"
      className="h-72 w-full bg-white"
    />
  );
}

function Badgeish({ label }: { label: string }) {
  return (
    <span className="text-muted-foreground bg-muted rounded px-1.5 py-0.5 font-mono text-[10px]">
      {label}
    </span>
  );
}

export function SandboxNotice() {
  return (
    <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
      <TriangleAlert className="mt-0.5 size-3 shrink-0" />
      ชิ้นงานรันใน sandbox แยกจากเว็บไซต์ ไม่มีสิทธิ์เข้าถึงคุกกี้หรือข้อมูลของคุณ
    </p>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}