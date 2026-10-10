'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Code2,
  Copy,
  Download,
  Eye,
  FileCode2,
  PanelRightOpen,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { isRenderable, type Artifact } from '@/lib/chat/artifacts';

/**
 * An artifact is a compact row in the transcript that opens into a side panel.
 *
 * The preview never renders inline: an iframe has to be given an explicit height,
 * and whatever that number is it is wrong in one of the two states — too short
 * inside the panel, or a scroll trap inside the message list. The panel sizes
 * the iframe with `h-full` inside a `flex-1 min-h-0` column instead, so the
 * document always fills the space it is given.
 *
 * `sandbox` deliberately omits `allow-same-origin`, so the preview runs in an
 * opaque origin: it cannot reach this page, its cookies, or localStorage, and
 * it cannot navigate the parent. Model-authored HTML is untrusted input.
 */
export function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  // `shown` keeps the panel mounted so the exit transition has something to run
  // on; `open` is what the animation keys off. Unmounting on the same tick as
  // the close would skip the exit entirely.
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  function show() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setShown(true);
    // Wait a frame so the element is in the DOM with its closed state before
    // it flips to open, otherwise there is no transition to run.
    requestAnimationFrame(() => setOpen(true));
  }

  function hide() {
    setOpen(false);
    closeTimer.current = setTimeout(() => setShown(false), 200);
  }

  const renderable = isRenderable(artifact.language);
  const title = artifact.title ?? 'ชิ้นงาน';

  const doc = useMemo(() => buildDoc(artifact), [artifact]);

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
    a.download = `${title.replace(/\W+/g, '-')}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="hover:bg-muted/40 flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-150">
        <div className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-md">
          <FileCode2 className="size-4" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="text-muted-foreground truncate text-xs">
            ชิ้นงาน · เฉพาะคุณเห็น
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <Button size="icon" variant="ghost" className="size-8" aria-label="คัดลอก" onClick={() => void copy()}>
            <Copy className="size-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="size-8" aria-label="ดาวน์โหลด" onClick={() => download()}>
            <Download className="size-3.5" />
          </Button>
          <Button size="sm" variant="secondary" onClick={show}>
            <PanelRightOpen className="size-3.5" />
            เปิด
          </Button>
        </div>
      </div>

      {shown && (
        <ArtifactPanel
          artifact={artifact}
          title={title}
          doc={doc}
          renderable={renderable}
          mode={mode}
          open={open}
          onModeChange={setMode}
          onCopy={() => void copy()}
          onDownload={download}
          onClose={hide}
        />
      )}
    </>
  );
}

function ArtifactPanel({
  artifact,
  title,
  doc,
  renderable,
  mode,
  open,
  onModeChange,
  onCopy,
  onDownload,
  onClose,
}: {
  artifact: Artifact;
  title: string;
  doc: string;
  renderable: boolean;
  mode: 'preview' | 'source';
  open: boolean;
  onModeChange: (m: 'preview' | 'source') => void;
  onCopy: () => void;
  onDownload: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const showSource = !renderable || mode === 'source';

  return (
    <div
      // The same utilities shadcn's Sheet uses, so the artifact panel opens and
      // closes with the same motion as every other overlay in the app.
      className={`fixed inset-0 z-50 flex justify-end duration-200 ease-out ${
        open ? 'animate-in fade-in-0' : 'animate-out fade-out-0'
      } bg-background/60 backdrop-blur-[2px]`}
      // A click on the backdrop closes, a drag that starts inside the panel does
      // not — without checking the target, releasing a text selection would
      // close the panel.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`bg-background flex h-full w-full flex-col border-l shadow-2xl duration-200 ease-out sm:max-w-[min(1100px,85vw)] ${
          open ? 'animate-in slide-in-from-right-10' : 'animate-out slide-out-to-right-10'
        }`}
      >
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <h2 className="truncate text-sm font-medium">{title}</h2>

          <div className="ml-auto flex items-center gap-1">
            {renderable && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={showSource ? 'ดูตัวอย่าง' : 'ดูโค้ด'}
                onClick={() => onModeChange(showSource ? 'preview' : 'source')}
              >
                {showSource ? <Eye className="size-3.5" /> : <Code2 className="size-3.5" />}
                <span className="hidden sm:inline">{showSource ? 'ตัวอย่าง' : 'โค้ด'}</span>
              </Button>
            )}

            <Button size="icon" variant="ghost" className="size-8" aria-label="คัดลอก" onClick={onCopy}>
              <Copy className="size-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={onDownload}>
              <Download className="size-3.5" />
              ดาวน์โหลด
            </Button>
            <Button size="icon" variant="ghost" className="size-8" aria-label="ปิด" onClick={onClose}>
              <X className="size-4" />
            </Button>
          </div>
        </header>

        {/* flex-1 + min-h-0 gives this a definite height; without min-h-0 a
            flex child refuses to shrink below its content and the panel grows
            past the viewport instead of scrolling inside it. */}
        <div className="min-h-0 flex-1">
          {showSource ? (
            <pre className="h-full overflow-auto p-4 font-mono text-xs whitespace-pre-wrap">
              {artifact.source}
            </pre>
          ) : (
            <iframe
              srcDoc={doc}
              sandbox="allow-scripts"
              title={`${title} — ตัวอย่าง`}
              className="block h-full w-full bg-white"
            />
          )}
        </div>
      </div>
    </div>
  );
}

function buildDoc(artifact: Artifact): string {
  const language = artifact.language.toLowerCase();
  if (language === 'svg') {
    return `<!doctype html><meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:transparent">${artifact.source}</body>`;
  }
  if (language === 'html') return artifact.source;
  return `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:16px;font:13px ui-monospace,monospace;white-space:pre-wrap">${escapeHtml(artifact.source)}</body>`;
}

export function SandboxNotice() {
  return (
    <p className="text-muted-foreground text-xs">
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