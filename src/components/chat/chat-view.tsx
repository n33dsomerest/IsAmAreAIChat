'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Download,
  FileText,
  Globe,
  Loader2,
  Pencil,
  RotateCcw,
  Square,
  TriangleAlert,
  WifiOff,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { toast } from 'sonner';

import type { Artifact } from '@/lib/chat/artifacts';
import type { AttachmentRef } from '@/lib/chat/history';

import { ArtifactCard } from '@/components/chat/artifact-card';
import { CONVERSATIONS_KEY } from '@/components/chat/conversation-list';
import { AttachmentList } from '@/components/chat/attachment-list';
import { ModelPicker, type PickerModel } from '@/components/chat/model-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

type Part =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'artifact'; artifact: Artifact }
  | AttachmentRef;

type Turn = {
  id: string;
  role: 'user' | 'assistant';
  parts: Part[];
  /** More than one sibling — this turn was forked at some point. */
  branchCount?: number;
};

type PendingFile = {
  id: string;
  name: string;
  kind: string;
  mime: string;
  sizeBytes: number;
};

type Status =
  | { kind: 'idle' }
  | { kind: 'streaming'; model: string }
  | { kind: 'error'; message: string }
  | { kind: 'offline'; message: string };

export function ChatView({
  conversationId,
  models,
  credits,
  initialModelId,
  initialTurns,
}: {
  conversationId?: string;
  models: PickerModel[];
  credits: number;
  initialModelId: string | null;
  initialTurns: Turn[];
}) {
const router = useRouter();
  const idPrefix = useId();
  const seqRef = useRef(0);
  // Turn ids only need to be unique within this component instance. A clock
  // would do it, but `Date.now()` is a value Next refuses to prerender, so the
  // id is built from React's SSR-safe `useId` plus a per-instance counter.
  const nextId = useCallback(() => `${idPrefix}-${seqRef.current++}`, [idPrefix]);

  const [modelId, setModelId] = useState<string | null>(initialModelId ?? models[0]?.id ?? null);
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { mutate: mutateConversations } = useSWR(CONVERSATIONS_KEY);

  const [webSearch, setWebSearch] = useState(false);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [uploading, setUploading] = useState(false);
  // Read by the stream callback, which is memoised and must not re-create itself
  // every time a file is added or removed.
  const attachmentIdsRef = useRef<string[]>([]);
  attachmentIdsRef.current = files.map((f) => f.id);
  // Drag-and-drop target state. The counter is what makes the highlight stable:
  // dragenter/dragleave fire for every child element the pointer crosses, so a
  // boolean would flicker the overlay off the moment it moved over the textarea.
  const [dropping, setDropping] = useState(false);
  const dragDepth = useRef(0);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns]);

  // Dragging out of the browser window fires no dragleave on this element, which
  // would strand the drop overlay. dragend always fires, wherever it lands.
  useEffect(() => {
    const clear = () => {
      dragDepth.current = 0;
      setDropping(false);
    };
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, []);

const appendTo = useCallback((id: string, part: Part) => {
    setTurns((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              // Artifacts are whole objects, never merged — only deltas coalesce.
              parts:
                part.type === 'artifact'
                  ? [...t.parts, part]
                  : part.type === 'file'
                    ? [...t.parts, part]
                    : mergeText(t.parts, part.type, part.text),
            }
          : t,
      ),
    );
  }, []);

  const stream = useCallback(
    async (
      history: Turn[],
      botId: string,
      targetConversationId: string | undefined,
      withSearch: boolean,
    ) => {
      setStatus({ kind: 'streaming', model: '' });
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            // Spelled out rather than closing over `conversationId`: this
            // callback is also used for forks, which always target the
            // conversation currently on screen.
            conversationId: targetConversationId,
            modelId,
            webSearch: withSearch,
            messages: history.map((t) => ({ role: t.role, parts: t.parts })),
            attachmentIds: attachmentIdsRef.current,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setTurns((prev) => prev.filter((t) => t.id !== botId));
          setStatus({
            kind: res.status === 402 || res.status === 429 ? 'offline' : 'error',
            message: err.message ?? err.error ?? `เรียก API ไม่สำเร็จ (${res.status})`,
          });
          return;
        }

        // A brand-new conversation was created server side — follow it.
        const created = res.headers.get('x-conversation-id');
        if (!targetConversationId && created) router.replace(`/chat/${created}`);

        const named = res.headers.get('x-model-name');
        if (named) setStatus({ kind: 'streaming', model: named });

        const reader = res.body?.getReader();
        if (!reader) throw new Error('no response body');
        const decoder = new TextDecoder();

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const line of decoder.decode(value, { stream: true }).split('\n\n')) {
            if (!line.startsWith('data: ')) continue;
            const event = JSON.parse(line.slice(6));
            if (event.type === 'text-delta') appendTo(botId, { type: 'text', text: event.text });
if (event.type === 'reasoning-delta')
              appendTo(botId, { type: 'reasoning', text: event.text });
            if (event.type === 'artifact')
              appendTo(botId, { type: 'artifact', artifact: event.artifact });
            if (event.type === 'error') throw new Error('stream error');
          }
        }
        setStatus({ kind: 'idle' });
        // The sidebar reads its own cache, so refresh() would not reach it.
        // Revalidating the conversations key is what makes a new chat — or the
        // title the server just derived from the first prompt — appear there.
        void mutateConversations();
        router.refresh();
      } catch (error) {
        setTurns((prev) => prev.filter((t) => t.id !== botId));
        setStatus({
          kind: (error as Error)?.name === 'AbortError' ? 'idle' : 'error',
          message: (error as Error)?.message ?? 'เชื่อมต่อไม่สำเร็จ',
        });
      } finally {
        abortRef.current = null;
      }
    },
    [appendTo, modelId, mutateConversations, router],
  );

  /**
   * A conversation is what attachments hang off, and a brand-new chat has none.
   * `send` creates one on demand; uploads need the same, otherwise attaching a
   * file is impossible until after the first message.
   */
  const ensureConversation = useCallback(async (): Promise<string | null> => {
    if (conversationId) return conversationId;

    const res = await fetch('/api/conversations', { method: 'POST' });
    if (!res.ok) {
      setStatus({ kind: 'error', message: 'สร้างสนทนาไม่สำเร็จ' });
      return null;
    }
    const id = (await res.json()).id as string;
    router.replace(`/chat/${id}`);
    return id;
  }, [conversationId, router]);

  const send = useCallback(async () => {
    const text = input.trim();
    if ((!text && files.length === 0) || status.kind === 'streaming' || !modelId) return;

    const target = await ensureConversation();
    if (!target) return;

    // The pending files ride this one request and are cleared with it, so a
    // later message in the same chat does not re-send them. The turn keeps them
    // as parts, which is what history renders from after a reload.
    const userTurn: Turn = {
      id: nextId(),
      role: 'user',
      parts: [
        ...(text ? [{ type: 'text' as const, text }] : []),
        ...files.map(
          (f): AttachmentRef => ({
            type: 'file',
            attachmentId: f.id,
            name: f.name,
            kind: f.kind as AttachmentRef['kind'],
            mime: f.mime,
            sizeBytes: f.sizeBytes,
          }),
        ),
      ],
    };
    const botId = nextId();
    const history = [...turns, userTurn];

    setTurns([...history, { id: botId, role: 'assistant', parts: [] }]);
    setInput('');
    setFiles([]);
    await stream(history, botId, target, webSearch);
  }, [ensureConversation, files, input, modelId, nextId, status.kind, stream, turns, webSearch]);

  /** Forks a turn server-side, then regenerates from that point. */
  async function forkFrom(turnId: string, replacement?: string) {
    if (!conversationId || status.kind === 'streaming') return;

    const index = turns.findIndex((t) => t.id === turnId);
    if (index < 0) return;

    const target = turns[index];
    const base = replacement ?? textOf(target.parts);

    const res = await fetch(`/api/conversations/${conversationId}/branch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageId: turnId, text: replacement }),
    });
    if (!res.ok) {
      toast.error('แตกสายไม่สำเร็จ');
      return;
    }

    const fork = (await res.json()) as { messageId: string; role: 'user' | 'assistant' };

    // Everything after the edited turn belongs to the old branch.
    const before = turns.slice(0, index);
    const edited: Turn =
      fork.role === 'user'
        ? { id: nextId(), role: 'user', parts: [{ type: 'text', text: base }] }
        : { id: nextId(), role: 'assistant', parts: [] };

    const history = [...before, edited];
    const botId = nextId();

    if (fork.role === 'assistant') {
      setTurns([...before, { ...edited, parts: [] }]);
      await stream([...before, { ...edited, parts: [] }], botId, conversationId, webSearch);
    } else {
      setTurns([...history, { id: botId, role: 'assistant', parts: [] }]);
      await stream(history, botId, conversationId, webSearch);
    }

    router.refresh();
  }

  async function uploadFiles(list: readonly File[]) {
    if (!list.length) return;

    const target = await ensureConversation();
    if (!target) return;

    setUploading(true);
    try {
      for (const file of list) {
        const form = new FormData();
        form.append('conversationId', target);
        form.append('file', file);

        try {
          const res = await fetch('/api/attachments', { method: 'POST', body: form });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            toast.error(data.error ?? `อัปโหลด ${file.name} ไม่สำเร็จ`);
            continue;
          }
          setFiles((prev) => [...prev, data as PendingFile]);
        } catch {
          // A dead network must not look like a button that does nothing.
          toast.error(`ส่งไฟล์ ${file.name} ไม่สำเร็จ — เชื่อมต่ออินเทอร์เน็ตไม่ได้`);
        }
      }
    } finally {
      setUploading(false);
    }
  }

  const busy = status.kind === 'streaming';
  // The server sends the model that actually answered, which is not always the
  // one picked: the chain falls through when a model is unusable. Until that
  // header lands there is nothing to name, so the generic line shows.
  const statusModel = status.kind === 'streaming' ? status.model : '';

  /**
   * What the currently selected model will not be able to read, if anything.
   *
   * Shown before sending rather than acted on: the user picks the model, so
   * quietly swapping it for one with vision would be worse than telling them.
   */
  const unreadable = useMemo(() => {
    const model = models.find((m) => m.id === modelId);
    if (!model || !files.length) return [];

    const caps = model.capabilities ?? {};
    return files.filter((f) => {
      if (f.kind === 'image') return !caps.vision;
      if (f.kind === 'pdf') return !caps.pdf;
      return false;
    });
  }, [files, modelId, models]);

  /** Only react to drags that actually carry files, not selected text. */
  const carriesFiles = (e: React.DragEvent) =>
    e.dataTransfer.types.includes('Files');

  function onDragEnter(e: React.DragEvent) {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDropping(true);
  }

  function onDragOver(e: React.DragEvent) {
    if (!carriesFiles(e)) return;
    // Without this the browser refuses the drop and navigates to the file.
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  function onDragLeave(e: React.DragEvent) {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropping(false);
  }

  function onDrop(e: React.DragEvent) {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDropping(false);
    void uploadFiles(Array.from(e.dataTransfer.files));
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dropping && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-primary/5">
          <p className="bg-primary text-primary-foreground rounded-full px-4 py-2 text-sm font-medium shadow-lg">
            วางไฟล์เพื่อแนบ
          </p>
        </div>
      )}
      {conversationId && (
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <span className="truncate text-sm font-medium">สนทนา</span>
          <a
            href={`/api/conversations/${conversationId}?format=export`}
            className="text-muted-foreground hover:text-foreground ml-auto flex items-center gap-1 text-xs"
            download
          >
            <Download className="size-3.5" />
            ส่งออก .md
          </a>
        </header>
      )}

      <div ref={scrollRef} className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-6">
          {turns.length === 0 ? (
            <div className="py-16 text-center">
              <h1 className="text-2xl font-semibold tracking-tight">เริ่มแชท</h1>
              <p className="text-muted-foreground mt-2 text-sm">
                คุณมี <span className="font-medium tabular-nums">{credits}</span> เครดิต ·
                เลือกได้ <span className="font-medium tabular-nums">{models.length}</span>{' '}
                โมเดล
              </p>
            </div>
          ) : (
            <ol className="space-y-6">
              {turns.map((turn, i) => (
                <li key={turn.id} className="group/turn relative">
                  <TurnView
                    turn={turn}
                    streaming={turn.role === 'assistant' && busy}
                    model={turn.role === 'assistant' && busy ? statusModel : undefined}
                  />
                  {!busy && conversationId && (
                    <div className="absolute -top-3 right-0 flex gap-0.5 opacity-0 transition-opacity group-hover/turn:opacity-100">
                      {turn.role === 'assistant' ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-label="สร้างคำตอบใหม่"
                          onClick={() => void forkFrom(turn.id)}
                        >
                          <RotateCcw className="size-3.5" />
                        </Button>
                      ) : (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-label="แก้ไขข้อความ"
                          onClick={() => {
                            const next = prompt('แก้ไขข้อความ', textOf(turn.parts));
                            if (next?.trim()) void forkFrom(turn.id, next.trim());
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
                  {turn.branchCount && turn.branchCount > 1 ? (
                    <p className="text-muted-foreground mt-1 text-xs">
                      มี {turn.branchCount} สายแตกลงจากข้อความนี้
                    </p>
                  ) : null}
                  {i === turns.length - 1 && turn.role === 'assistant' && busy ? null : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {status.kind === 'error' && (
        <p className="mx-auto flex w-full max-w-2xl items-start gap-2 px-4 pb-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {status.message}
        </p>
      )}
      {status.kind === 'offline' && (
        <p className="mx-auto flex w-full max-w-2xl items-start gap-2 px-4 pb-2 text-sm text-amber-600 dark:text-amber-400">
          <WifiOff className="mt-0.5 size-4 shrink-0" />
          {status.message}
        </p>
      )}

      <div className="border-t bg-background/80 backdrop-blur">
        <div className="mx-auto w-full max-w-2xl px-4 py-3">
          {files.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {files.map((f) => (
                <Badge key={f.id} variant="secondary" className="gap-1 pr-1">
                  <FileText className="size-3" />
                  <span className="max-w-40 truncate">{f.name}</span>
                  <button
                    type="button"
                    aria-label={`เอา ${f.name} ออก`}
                    className="hover:bg-background/60 rounded p-0.5"
                    onClick={() => setFiles((prev) => prev.filter((x) => x.id !== f.id))}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          {unreadable.length > 0 && (
            <p className="mb-2 flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                <strong>{models.find((m) => m.id === modelId)?.label ?? 'โมเดลนี้'}</strong>{' '}
                อ่านไฟล์ที่แนบไม่ได้
                {unreadable.some((f) => f.kind === 'image') && ' (มองไม่เห็นรูป)'}
                {unreadable.some((f) => f.kind === 'pdf') && ' (อ่าน PDF ไม่ได้)'}
                {' — '}
                {unreadable.map((f) => f.name).join(', ')} จะถูกส่งเป็นข้อความแทน
                ถ้าอยากให้โมเดลเห็นไฟล์ เลือกโมเดลที่รองรับก่อนส่ง
              </span>
            </p>
          )}

          <div className="rounded-xl border bg-background focus-within:ring-2 focus-within:ring-ring/40">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="พิมพ์ข้อความ… (Enter ส่ง · Shift+Enter ขึ้นบรรทัดใหม่)"
              className="max-h-48 min-h-16 resize-none border-0 shadow-none focus-visible:ring-0"
              disabled={busy}
            />

            <div className="flex items-center gap-1 p-2">
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/*,application/pdf,text/plain,text/markdown,text/csv,application/json"
                className="hidden"
                onChange={(e) => {
                  // Snapshot before resetting the input. `FileList` is live, not
                  // a copy: clearing `value` empties the very list the upload is
                  // about to read, so by the time the async work resumed it saw
                  // zero files and did nothing at all — no request, no chip, no
                  // error, and with no toast mounted there was nothing on screen
                  // to say the button had been pressed.
                  const picked = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  void uploadFiles(picked);
                }}
              />
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label="แนบไฟล์"
                disabled={busy || uploading}
                title="แนบไฟล์"
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileText className="size-4" />
                )}
              </Button>

              <Button
                size="icon"
                variant="ghost"
                className={`size-8 ${webSearch ? 'text-primary' : ''}`}
                aria-label="ค้นหาบนเว็บ"
                aria-pressed={webSearch}
                disabled={busy}
                title={webSearch ? 'เปิดการค้นหาเว็บ' : 'ปิดการค้นหาเว็บ'}
                onClick={() => setWebSearch((v) => !v)}
              >
                <Globe className="size-4" />
              </Button>

              <ModelPicker models={models} value={modelId} onChange={setModelId} />

              {busy ? (
                <Button
                  size="icon"
                  variant="outline"
                  className="ml-auto"
                  aria-label="หยุดการตอบ"
                  onClick={() => abortRef.current?.abort()}
                >
                  <Square className="size-4" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  className="ml-auto"
                  aria-label="ส่งข้อความ"
                  disabled={(!input.trim() && files.length === 0) || !modelId}
                  onClick={() => void send()}
                >
                  <ArrowUp className="size-4" />
                </Button>
              )}
            </div>
          </div>

          <p className="text-muted-foreground mt-2 text-center text-xs">
            1 ข้อความ = 1 เครดิต · การเรียกเครื่องมือไม่นับเครดิต · ผู้ช่วยอาจสลับโมเดลอัตโนมัติเมื่อโมเดลที่เลือกใช้ไม่ได้
          </p>
        </div>
      </div>
    </div>
  );
}

function TurnView({
  turn,
  streaming,
  model,
}: {
  turn: Turn;
  streaming: boolean;
  model?: string;
}) {
  if (turn.role === 'user') {
    const files = turn.parts.filter((p): p is AttachmentRef => p.type === 'file');
    return (
      <div className="flex flex-col items-end gap-1">
        {files.length > 0 && (
          <div className="flex max-w-[85%] justify-end">
            <AttachmentList items={files} />
          </div>
        )}
        <div className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm whitespace-pre-wrap">
          {turn.parts.map((p, i) => (p.type === 'text' ? <span key={i}>{p.text}</span> : null))}
        </div>
      </div>
    );
  }

  const prose = turn.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');

  const thinking = turn.parts
    .filter((p) => p.type === 'reasoning')
    .map((p) => (p as { text: string }).text)
    .join('');

  const artifacts = turn.parts.filter(
    (p): p is { type: 'artifact'; artifact: Artifact } => p.type === 'artifact',
  );

  return (
    <div className="space-y-2">
      {thinking && (
        <details className="text-muted-foreground text-xs">
          <summary className="cursor-pointer select-none">กระบวนการคิด</summary>
          <p className="mt-1 max-h-48 overflow-y-auto rounded-md bg-muted/40 p-2 whitespace-pre-wrap">
            {thinking}
          </p>
        </details>
      )}

      {prose.trim() && (
        <div className="text-sm leading-relaxed whitespace-pre-wrap">{prose}</div>
      )}

      {artifacts.map((p) => (
        <ArtifactCard key={p.artifact.id} artifact={p.artifact} />
      ))}

      {streaming && !prose && !artifacts.length && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          {model ? `กำลังคิดด้วย ${model}…` : 'กำลังคิด…'}
        </p>
      )}
    </div>
  );
}

function textOf(parts: Part[]): string {
  return parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

function mergeText(
  parts: Part[],
  kind: 'text' | 'reasoning',
  text: string,
): Part[] {
  const last = parts.at(-1);
  if (last && last.type === kind) {
    return [...parts.slice(0, -1), { type: kind, text: last.text + text } as Part];
  }
  return [...parts, { type: kind, text } as Part];
}