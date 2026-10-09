import 'server-only';

import { asc, eq } from 'drizzle-orm';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';

import { computeTool, searchTool } from '@/lib/ai/tools';
import { db } from '@/lib/db';
import { mcpServers } from '@/lib/db/schema';
import { McpClient, toZodShape, type McpTool } from '@/lib/mcp/client';

/**
 * The tools one request may use.
 *
 * Builtins are always available. MCP tools come from servers the admin enabled,
 * and a server that fails to answer is skipped rather than failing the turn —
 * a chat should not die because one integration is down.
 */
export async function buildToolSet(options: { webSearch: boolean }): Promise<ToolSet> {
  const tools: ToolSet = {};

  if (options.webSearch) tools.web_search = searchTool;
  tools.compute = computeTool;

  const servers = await db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.enabled, true))
    .orderBy(asc(mcpServers.name));

  for (const server of servers) {
    let client: McpClient;
    let remote: McpTool[];

    try {
      client = new McpClient({
        id: server.id,
        name: server.name,
        url: server.url,
        transport: server.transport,
        enabled: server.enabled,
        headers: server.headers ?? {},
      });
      remote = await client.tools();
    } catch {
      // Unreachable server — skip it rather than surfacing an error mid-chat.
      continue;
    }

    for (const entry of remote) {
      const remoteName = entry.name.slice(entry.name.indexOf('__') + 2);
      tools[entry.name] = tool({
        description: `[${entry.serverName}] ${entry.description}`,
        // The SDK wants a schema object, not a bare shape.
        inputSchema: z.object(toZodShape(entry.inputSchema)),
        execute: async (args: Record<string, unknown>) =>
          flattenResult(await client.call(remoteName, args)),
      });
    }
  }

  return tools;
}

/** MCP results arrive as content blocks; unwrap the text ones for the model. */
function flattenResult(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return result;

  const texts = content
    .filter((c): c is { type: 'text'; text: string } =>
      Boolean(c && typeof c === 'object' && (c as { type?: string }).type === 'text'),
    )
    .map((c) => c.text);

  return texts.length ? texts.join('\n') : result;
}