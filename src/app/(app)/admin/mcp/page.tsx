import { desc } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { McpPanel } from '@/components/admin/mcp-panel';
import { getCurrentUser } from '@/lib/auth/current-user';
import { db } from '@/lib/db';
import { mcpServers } from '@/lib/db/schema';

export const metadata = { title: 'เครื่องมือ MCP · ผู้ดูแลระบบ' };
export const instant = false;

export default async function AdminMcpPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/');

  const rows = await db.select().from(mcpServers).orderBy(desc(mcpServers.createdAt));

  return (
    <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 md:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">เครื่องมือ MCP</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          เชื่อม Model Context Protocol server เพื่อให้โมเดลเรียกใช้เครื่องมือภายนอก ·
          ค่าใน header ที่ขึ้นต้นด้วย $ จะถูกอ่านจากตัวแปร env ของเซิร์ฟเวอร์ ไม่เก็บค่าจริงลงฐานข้อมูล
        </p>

        <div className="mt-6">
          <McpPanel
            initial={rows.map((s) => ({
              id: s.id,
              name: s.name,
              url: s.url,
              transport: s.transport,
              enabled: s.enabled,
              toolCount: Array.isArray(s.toolsCache) ? s.toolsCache.length : 0,
              lastCheckedAt: s.lastCheckedAt?.toISOString() ?? null,
              lastError:
                (s.toolsCache as { lastError?: string }[] | null)?.at?.(-1)?.lastError ?? null,
            }))}
          />
        </div>
      </div>
    </div>
  );
}