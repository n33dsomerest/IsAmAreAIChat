import { Suspense } from 'react';

import { redirect } from 'next/navigation';

import { ProvidersPanel } from '@/components/admin/providers-panel';
import { getCurrentUser } from '@/lib/auth/current-user';

export const metadata = { title: 'ผู้ให้บริการ · ผู้ดูแลระบบ' };
export const instant = false;

export default async function AdminProvidersPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/');

  return (
    <main className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">ผู้ให้บริการ AI</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            กำหนดปลายทาง API และลำดับการสลับตัวอัตโนมัติ เมื่อโมเดลหลักล้มเหลว
          </p>
        </header>

        <Suspense fallback={null}>
          <ProvidersPanel />
        </Suspense>
      </div>
    </main>
  );
}