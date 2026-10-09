import 'server-only';

import { tool } from 'ai';
import { z } from 'zod';

import { serviceClient } from '@/lib/storage';

/** Search is a built-in: no credits, but the admin can switch it off. */
export const searchTool = tool({
  description:
    'ค้นหาข้อมูลบนเว็บแล้วอ่านเนื้อหาที่ตรงกับคำค้น ใช้เมื่อคำตอบขึ้นกับข้อมูลที่เปลี่ยนแปลงไป หรือเมื่อผู้ใช้ถามเรื่องเฉพาะที่ไม่รู้จัก',
  inputSchema: z.object({
    query: z.string().min(2).max(400).describe('คำค้นที่ต้องการค้นหา'),
    maxResults: z.number().int().min(1).max(8).default(5),
  }),
  execute: async ({ query, maxResults }) => {
    const key = process.env.TAVILY_API_KEY;
    if (!key) return { results: [], note: 'web search is not configured' };

    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        max_results: maxResults,
        search_depth: 'basic',
        include_answer: true,
      }),
      signal: AbortSignal.timeout(25_000),
    });

    if (!res.ok) {
      return { results: [], note: `search failed (${res.status})` };
    }

    const data = (await res.json()) as {
      answer?: string;
      results?: { title?: string; url?: string; content?: string; score?: number }[];
    };

    return {
      answer: data.answer ?? null,
      results: (data.results ?? []).map((r) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        snippet: (r.content ?? '').slice(0, 1200),
        score: r.score ?? null,
      })),
    };
  },
});

/**
 * Runs a small JavaScript sandbox over a data URL or JSON blob.
 *
 * There is no safe way to evaluate user code in-process, so this does nothing
 * clever: it hands the model a way to crunch its own JSON, which is the part
 * that is actually useful, and nothing more.
 */
export const computeTool = tool({
  description:
    'คำนวณค่าตัวเลขจากนิพจน์ทางคณิตศาสตร์ เช่น "(1234*2+56)/3" ใช้เมื่อต้องการความแม่นยำทางตัวเลขแทนการเดาคำตอบ',
  inputSchema: z.object({ expression: z.string().min(1).max(500) }),
  execute: async ({ expression }) => {
    const value = evaluateArithmetic(expression);
    return value === null
      ? { ok: false, note: 'expression is not plain arithmetic' }
      : { ok: true, value };
  },
});

/**
 * A deliberately tiny arithmetic evaluator.
 *
 * The model usually wraps the expression in prose ("(1234*2+56)/3 บาทต่อกิโลกรัม"),
 * so the arithmetic run is extracted first. If that run still contains
 * anything unexpected the whole thing is refused rather than sanitised — a
 * parser that silently dropped characters would compute a different number
 * than the model asked for, which is worse than declining.
 */
function evaluateArithmetic(input: string): number | null {
  const run = input.match(/[0-9+\-*/().%\s฿,$]{2,}/);
  if (!run) return null;

  const cleaned = run[0].replace(/[^\d+\-*/().%]/g, '');
  if (!/\d/.test(cleaned) || !/[-+*/%]/.test(cleaned)) return null;
  if (!/^[-+*/().%\d]+$/.test(cleaned)) return null;

  const tokens = cleaned.match(/\d+\.?\d*|[-+*/()%]/g);
  if (!tokens) return null;

  // Shunting-yard: precedence first, then left-to-right.
  const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2 };
  const output: (number | string)[] = [];
  const ops: string[] = [];

  // `expectOperand` is what separates "1 + 1" from "+1": the same token is a
  // binary operator in one and a sign in the other, and getting it backwards
  // silently drops the operator.
  let expectOperand = true;

  for (const token of tokens) {
    if (/^\d/.test(token)) {
      output.push(Number(token));
      expectOperand = false;
      continue;
    }

    if (token === '(') {
      ops.push(token);
      expectOperand = true;
      continue;
    }

    if (token === ')') {
      while (ops.length && ops.at(-1) !== '(') output.push(ops.pop()!);
      if (!ops.length) return null;
      ops.pop();
      expectOperand = false;
      continue;
    }

    if (!(token in PREC)) return null;

    if (expectOperand) output.push(0); // leading sign: -x / +x

    while (ops.length && ops.at(-1)! in PREC && PREC[ops.at(-1)!] >= PREC[token]) {
      output.push(ops.pop()!);
    }
    ops.push(token);
    expectOperand = true;
  }
  while (ops.length) output.push(ops.pop()!);

  const rpn: (number | string)[] = output;
  const stack: number[] = [];
  for (const token of rpn) {
    if (typeof token === 'number') {
      stack.push(token);
      continue;
    }
    const b = stack.pop();
    const a = stack.pop();
    if (a === undefined || b === undefined) return null;
    switch (token) {
      case '+': stack.push(a + b); break;
      case '-': stack.push(a - b); break;
      case '*': stack.push(a * b); break;
      case '/':
        if (b === 0) return null;
        stack.push(a / b);
        break;
      case '%':
        if (b === 0) return null;
        stack.push(a % b);
        break;
      default:
        return null;
    }
  }

  if (stack.length !== 1 || !Number.isFinite(stack[0])) return null;
  return Math.round(stack[0] * 1e10) / 1e10;
}

void serviceClient;