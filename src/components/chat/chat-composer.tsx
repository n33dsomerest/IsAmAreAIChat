'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Paperclip, Square, TriangleAlert, WifiOff } from 'lucide-react';

import { ModelPicker, type PickerModel } from '@/components/chat/model-picker';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

type Part =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string };

type Turn = {
  id: string;
  role: 'user' | 'assistant';
  parts: Part[];
};

type Status =
  | { kind: 'idle' }
  | { kind: 'streaming'; model: string }
  | { kind: 'error'; message: string }
  | { kind: 'offline'; message: string };

let seq = 0;
const nextId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

export function ChatComposer({
  models,
  credits,
}: {
  models: PickerModel[];
  credits: number;
}) {
  const [modelId, setModelId] = useState<string | null>(models[0]?.id ?? null);
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns]);

  const appendTo = useCallback((id: string, part: Part) => {
    setTurns((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              parts: part.type === 'text'
                ? mergeText(t.parts, 'text', part.text)
                : mergeText(t.parts, 'reasoning', part.text),
            }
          : t,
      ),
    );
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || status.kind === 'streaming' || !modelId) return;

    const userTurn: Turn = { id: nextId(), role: 'user', parts: [{ type: 'text', text }] };
    const botId = nextId();
    const history: Turn[] = [...turns, userTurn];
    const assistant: Turn = { id: botId, role: 'assistant', parts: [] };

    setTurns([...history, assistant]);
    setInput('');
    setStatus({ kind: 'streaming', model: '' });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          modelId,
          messages: history.map((t) => ({ role: t.role, parts: t.parts })),
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
          if (event.type === 'error') throw new Error('stream error');
        }
      }

      setStatus({ kind: 'idle' });
    } catch (error) {
      setTurns((prev) => prev.filter((t) => t.id !== botId));
      setStatus({
        kind: (error as Error)?.name === 'AbortError' ? 'idle' : 'error',
        message: (error as Error)?.message ?? 'เชื่อมต่อไม่สำเร็จ',
      });
    } finally {
      abortRef.current = null;
    }
  }, [appendTo, input, modelId, status.kind, turns]);

  const busy = status.kind === 'streaming';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-6">
          {turns.length === 0 ? (
            <EmptyState models={models} credits={credits} />
          ) : (
            <ol className="space-y-6">
              {turns.map((turn) => (
                <li key={turn.id}>
                  <TurnView turn={turn} streaming={turn.role === 'assistant' && busy} />
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

            <div className="flex items-center gap-2 p-2">
              <Button variant="ghost" size="icon" disabled aria-label="แนบไฟล์">
                <Paperclip className="size-4" />
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
                  disabled={!input.trim() || !modelId}
                  onClick={() => void send()}
                >
                  <ArrowUp className="size-4" />
                </Button>
              )}
            </div>
          </div>

          <p className="text-muted-foreground mt-2 text-center text-xs">
            1 ข้อความ = 1 เครดิต · ผู้ช่วยอาจสลับโมเดลอัตโนมัติเมื่อโมเดลที่เลือกใช้ไม่ได้
          </p>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ models, credits }: { models: PickerModel[]; credits: number }) {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">เริ่มแชท</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        คุณมี <span className="font-medium tabular-nums">{credits}</span> เครดิต · เลือกได้{' '}
        <span className="font-medium tabular-nums">{models.length}</span> โมเดลจาก{' '}
        {[...new Set(models.map((m) => m.provider))].join(' และ ')}
      </p>
    </div>
  );
}

function TurnView({ turn, streaming }: { turn: Turn; streaming: boolean }) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm whitespace-pre-wrap">
          {turn.parts.map((p, i) => (p.type === 'text' ? <span key={i}>{p.text}</span> : null))}
        </div>
      </div>
    );
  }

  const text = turn.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('');
  const thinking = turn.parts
    .filter((p) => p.type === 'reasoning')
    .map((p) => (p as { text: string }).text)
    .join('');

  return (
    <div className="space-y-2">
      {thinking && (
        <details className="text-muted-foreground group text-xs">
          <summary className="cursor-pointer select-none">
            กระบวนการคิด ({thinking.length} ตัวอักษร)
          </summary>
          <p className="mt-1 max-h-48 overflow-y-auto rounded-md bg-muted/40 p-2 text-xs whitespace-pre-wrap">
            {thinking}
          </p>
        </details>
      )}
      <div className="text-sm leading-relaxed whitespace-pre-wrap">
        {text}
        {streaming && !text && <span className="animate-pulse">…</span>}
      </div>
    </div>
  );
}

/** Coalesces consecutive deltas of the same kind instead of growing the array. */
function mergeText(parts: Part[], kind: Part['type'], text: string): Part[] {
  const last = parts.at(-1);
  if (last && last.type === kind) {
    return [...parts.slice(0, -1), { ...last, text: last.text + text } as Part];
  }
  return [...parts, { type: kind, text } as Part];
}