'use client';

import { useState } from 'react';
import { ArrowUp, Paperclip } from 'lucide-react';

import { ModelPicker, type PickerModel } from '@/components/chat/model-picker';
import { Button } from '@/components/ui/button';

export function ChatComposer({ models }: { models: PickerModel[] }) {
  const [modelId, setModelId] = useState<string | null>(models[0]?.id ?? null);

  return (
    <div className="rounded-xl border">
      <div className="text-muted-foreground min-h-16 p-3 text-sm">พิมพ์ข้อความเพื่อเริ่มแชท…</div>

      <div className="flex items-center gap-2 p-2">
        <Button variant="ghost" size="icon" disabled aria-label="แนบไฟล์">
          <Paperclip className="size-4" />
        </Button>

        <ModelPicker models={models} value={modelId} onChange={setModelId} />

        <Button size="icon" className="ml-auto" disabled aria-label="ส่งข้อความ">
          <ArrowUp className="size-4" />
        </Button>
      </div>
    </div>
  );
}