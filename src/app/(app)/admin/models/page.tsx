import { asc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { ModelsPanel } from '@/components/admin/models-panel';
import { getCurrentUser } from '@/lib/auth/current-user';
import { db } from '@/lib/db';
import { providerModels, providers } from '@/lib/db/schema';

export const metadata = { title: 'โมเดล · ผู้ดูแลระบบ' };
export const instant = false;

/** How many rows to render before the page stops being quick. */
const PAGE_SIZE = 200;

export default async function AdminModelsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/');

  const rows = await db
    .select({
      id: providerModels.id,
      displayName: providerModels.displayName,
      remoteModelId: providerModels.remoteModelId,
      contextWindow: providerModels.contextWindow,
      capabilities: providerModels.capabilities,
      enabled: providerModels.enabled,
      isFallback: providerModels.isFallback,
      sortOrder: providerModels.sortOrder,
      providerName: providers.name,
      providerEnabled: providers.enabled,
      lastSyncedAt: providerModels.lastSyncedAt,
    })
    .from(providerModels)
    .innerJoin(providers, eq(providerModels.providerId, providers.id))
    .orderBy(asc(providers.sortOrder), asc(providerModels.sortOrder))
    .limit(PAGE_SIZE);

  return (
    <main className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">โมเดล</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            เปิดหรือปิดโมเดลที่ผู้ใช้เลือกได้ และกำหนดโมเดลสำรองที่จะถูกลองใช้อัตโนมัติเมื่อโมเดลหลักล้มเหลว
          </p>
        </header>

        <ModelsPanel
          models={rows.map((r) => ({
            ...r,
            lastSyncedAt: r.lastSyncedAt ? r.lastSyncedAt.toISOString() : null,
          }))}
        />
      </div>
    </main>
  );
}