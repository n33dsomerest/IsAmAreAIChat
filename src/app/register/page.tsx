import Link from 'next/link';

import { AuthShell } from '@/components/auth/auth-shell';
import { RegisterForm } from '@/components/auth/register-form';

export const metadata = {
  title: 'สมัครสมาชิก',
};

export default function RegisterPage() {
  return (
    <AuthShell
      title="สมัครสมาชิก"
      subtitle="เริ่มต้นฟรี ไม่ต้องชำระเงิน"
      footer={
        <>
          มีบัญชีอยู่แล้ว?{' '}
          <Link href="/login" className="font-medium underline underline-offset-4">
            เข้าสู่ระบบ
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthShell>
  );
}