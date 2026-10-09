import { Suspense } from 'react';
import Link from 'next/link';

import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/login-form';

export const metadata = {
  title: 'เข้าสู่ระบบ',
};

export default function LoginPage() {
  return (
    <AuthShell
      title="เข้าสู่ระบบ"
      subtitle="ยินดีต้อนรับกลับ"
      footer={
        <>
          ยังไม่มีบัญชี?{' '}
          <Link href="/register" className="font-medium underline underline-offset-4">
            สมัครสมาชิก
          </Link>
        </>
      }
    >
      {/* LoginForm reads searchParams, which requires a Suspense boundary. */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}