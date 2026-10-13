import 'server-only';

import { z } from 'zod';
import logger from '@/lib/logger';

export type McpServer = {
  id: string;
  name: string;
  url: string;
  transport: 'http' | 'sse';
  enabled: boolean;
  headers: Record<string, string>;
};

type JsonRpc = {
  jsonrpc?: '2.0';
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

/**
 * A minimal MCP client.
 *
 * MCP is JSON-RPC over HTTP. Only the two calls this app needs are
 * implemented — `tools/list` and `tools/call` — because everything else the
 * protocol offers (resources, prompts, sampling) has no consumer here.
 */
export class McpClient {
  #server: McpServer;
  #id = 0;
  #sessionId: string | null = null;
  #tools: McpTool[] | null = null;
  #fetchedAt = 0;

  constructor(server: McpServer) {
    this.#server = server;
  }

  #headers(): Record<string, string> {
    const base: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    for (const [key, value] of Object.entries(this.#server.headers ?? {})) {
      // An env placeholder keeps MCP secrets out of the database.
      base[key] = value.startsWith('$') ? (process.env[value.slice(1)] ?? '') : value;
    }
    if (this.#sessionId) base['mcp-session-id'] = this.#sessionId;
    return base;
  }

  async #rpc(method: string, params?: unknown): Promise<unknown> {
    this.#id += 1;
    const body: JsonRpc = { jsonrpc: '2.0', id: this.#id, method, params };

    const res = await fetch(this.#server.url, {
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      throw new Error(`${this.#server.name}: HTTP ${res.status}`);
    }

    const session = res.headers.get('mcp-session-id');
    if (session) this.#sessionId = session;

    const text = await res.text();
    const payload = parseJsonRpc(text);

    if (payload?.error) {
      const e = payload.error as { message?: string };
      throw new Error(`${this.#server.name}: ${e?.message ?? 'RPC error'}`);
    }

    return payload?.result;
  }

  /** Tool list, cached for 5 min with stale-while-revalidate. */
  async tools(force = false): Promise<McpTool[]> {
    const now = Date.now();
    const CACHE_TTL_MS = 5 * 60_000; // 5 minutes
    const STALE_TTL_MS = 10 * 60_000; // 10 minutes (stale-while-revalidate window)

    // Fresh cache - return immediately
    if (!force && this.#tools && now - this.#fetchedAt < CACHE_TTL_MS) {
      return this.#tools;
    }

    // Stale cache - return immediately, refresh in background
    if (!force && this.#tools && now - this.#fetchedAt < STALE_TTL_MS) {
      // Fire-and-forget background refresh
      this.#refreshTools().catch(() => { /* ignore */ });
      return this.#tools;
    }

    // No cache or too stale - fetch synchronously
    return this.#refreshTools();
  }

  /** Internal: fetch tools and update cache. */
  async #refreshTools(): Promise<McpTool[]> {
    try {
      const result = (await this.#rpc('tools/list')) as { tools?: unknown[] } | undefined;
      const tools = (result?.tools ?? [])
        .map((t) => normaliseTool(this.#server, t))
        .filter(Boolean) as McpTool[];

      this.#tools = tools;
      this.#fetchedAt = Date.now();
      return tools;
    } catch (error) {
      // If refresh fails but we have stale data, keep serving it
      if (this.#tools) {
        logger.warn(
          { server: this.#server.name, error: error instanceof Error ? error.message : String(error) },
          'MCP tools refresh failed, serving stale tools',
        );
        return this.#tools;
      }
      throw error;
    }
  }

  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.#rpc('tools/call', { name, arguments: args });
  }
}

export type McpTool = {
  /** Namespaced so two servers can expose the same tool name. */
  name: string;
  description: string;
  inputSchema: unknown;
  serverId: string;
  serverName: string;
};

function normaliseTool(server: McpServer, raw: unknown): McpTool | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as { name?: unknown; description?: unknown; inputSchema?: unknown };

  if (typeof t.name !== 'string' || !t.name) return null;

  return {
    // The model sees `server__tool`; the registry maps it back on call.
    name: `${server.name}__${t.name}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
    description: typeof t.description === 'string' ? t.description : '',
    inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
    serverId: server.id,
    serverName: server.name,
  };
}

/** Handles both a bare JSON body and an SSE-framed one. */
function parseJsonRpc(text: string): JsonRpc | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as JsonRpc;
  } catch {
    // `text/event-stream` framing: take the last `data:` line that parses.
    for (const line of trimmed.split('\n').reverse()) {
      if (!line.startsWith('data:')) continue;
      try {
        return JSON.parse(line.slice(5).trim()) as JsonRpc;
      } catch {
        /* keep looking */
      }
    }
    return null;
  }
}

/**
 * Turns an MCP JSON Schema into the zod shape the AI SDK wants.
 *
 * Only the common cases are mapped. Anything else falls back to a permissive
 * record, which keeps the tool callable instead of dropping it silently.
 */
export function toZodShape(schema: unknown): Record<string, z.ZodTypeAny> {
  const root = (schema ?? {}) as {
    type?: string;
    properties?: Record<string, { type?: string; description?: string; enum?: unknown[] }>;
    required?: string[];
  };

  if (root.type !== 'object' || !root.properties) return {};

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, spec] of Object.entries(root.properties)) {
    let field: z.ZodTypeAny;

    if (Array.isArray(spec.enum) && spec.enum.length) {
      field = z.enum(spec.enum as [string, ...string[]]);
    } else {
      switch (spec.type) {
        case 'number':
        case 'integer':
          field = z.number();
          break;
        case 'boolean':
          field = z.boolean();
          break;
        case 'array':
          field = z.array(z.unknown());
          break;
        case 'object':
          field = z.record(z.string(), z.unknown());
          break;
        default:
          field = z.string();
      }
    }

    shape[key] = spec.description ? field.describe(spec.description) : field;
  }

  return shape;
}