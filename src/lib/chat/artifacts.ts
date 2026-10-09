import type { ToolSet } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';

/**
 * Artifacts are code blocks the model writes out deliberately, rather than
 * anything that merely looks like code in a reply. The fence carries a marker
 * so the UI can tell the two apart:
 *
 *     ```artifact lang=html title="หน้าแรก"
 *     <!doctype html>…
 *     ```
 *
 * Anything in a plain fence stays inline in the message.
 */
const FENCE = /^```artifact(?:\s+lang=([\w+-]+))?(?:\s+title="([^"]{0,120})")?\s*\n([\s\S]*?)^```\s*$/gm;

export type Artifact = {
  id: string;
  title: string | null;
  language: string;
  source: string;
};

let seq = 0;
const nextId = () => `a${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * Splits a reply into plain prose and artifacts, in original order.
 *
 * Prose is returned as segments rather than one blob so the renderer can keep
 * the artifacts inline where the model put them.
 */
export function extractArtifacts(text: string): {
  segments: ({ type: 'text'; text: string } | { type: 'artifact'; artifact: Artifact })[];
} {
  const segments: ({ type: 'text'; text: string } | { type: 'artifact'; artifact: Artifact })[] = [];
  let cursor = 0;

  FENCE.lastIndex = 0;
  for (let match = FENCE.exec(text); match; match = FENCE.exec(text)) {
    const before = text.slice(cursor, match.index);
    if (before.trim()) segments.push({ type: 'text', text: before });

    segments.push({
      type: 'artifact',
      artifact: {
        id: nextId(),
        title: match[2] ?? null,
        language: (match[1] ?? 'text').toLowerCase(),
        source: match[3].trimEnd(),
      },
    });

    cursor = match.index + match[0].length;
  }

  const tail = text.slice(cursor);
  if (tail.trim()) segments.push({ type: 'text', text: tail });

  return { segments };
}

/**
 * Gives the model a way to produce an artifact on purpose.
 *
 * `create: false` because the source is in the tool call, not in the text —
 * the model passes the code directly and the renderer receives it as a part.
 */
export function artifactTools(onCreate: (artifact: Artifact) => void): ToolSet {
  return {
    create_artifact: tool({
      description:
        'สร้างชิ้นงานที่แสดงผลแยกจากข้อความ เช่น หน้าเว็บ HTML, กราฟ SVG, โค้ด หรือเอกสาร Markdown ' +
        'ใช้เมื่อผลลัพธ์ยาวหรือควรเรนเดอร์เป็นโค้ด ไม่ใช่เมื่อตอบเป็นข้อความสั้น ๆ',
      inputSchema: z.object({
        title: z.string().max(120).optional(),
        language: z
          .string()
          .regex(/^[\w+-]{1,20}$/)
          .default('html')
          .describe('ชนิดเนื้อหา เช่น html, svg, react, python, markdown'),
        source: z.string().min(1).max(120_000).describe('โค้ดหรือเนื้อหาเต็ม'),
      }),
      execute: async ({ title, language, source }) => {
        const artifact: Artifact = { id: nextId(), title: title ?? null, language, source };
        onCreate(artifact);
        return { ok: true, id: artifact.id, bytes: source.length };
      },
    }),
  };
}

/** Safe to render types. Anything else is shown as source, never executed. */
export const RENDERABLE = new Set(['html', 'svg', 'mermaid', 'markdown', 'md']);

export function isRenderable(language: string): boolean {
  return RENDERABLE.has(language.toLowerCase());
}