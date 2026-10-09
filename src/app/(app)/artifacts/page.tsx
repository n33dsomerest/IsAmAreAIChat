import { redirect } from 'next/navigation';

import { ArtifactGallery } from '@/components/chat/artifact-gallery';
import { getCurrentUser } from '@/lib/auth/current-user';

export const metadata = { title: 'ชิ้นงาน' };
export const instant = false;

export default async function ArtifactsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 md:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">ชิ้นงาน</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          หน้าเว็บ กราฟ และโค้ดที่ผู้ช่วยสร้างให้ — ทุกชิ้นรันใน sandbox แยกจากเว็บไซต์
        </p>

        <div className="mt-6">
          <ArtifactGallery />
        </div>
      </div>
    </div>
  );
}