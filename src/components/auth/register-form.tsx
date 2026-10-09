'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { AuthAlert } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { normalizeUsername, toSyntheticEmail, validateUsername } from '@/lib/auth/username';
import { createClient } from '@/lib/supabase/client';

const MIN_PASSWORD = 8;

function describe(error: string): string {
  if (error.includes('already registered') || error.includes('already been registered'))
    return 'ชื่อผู้ใช้นี้ถูกใช้แล้ว — ลองชื่ออื่น หรือเข้าสู่ระบบแทน';
  if (error.includes('rate limit') || error.includes('too many'))
    return 'พยายามหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่';
  return error;
}

export function RegisterForm() {
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const check = validateUsername(username);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD} ตัวอักษร`);
      return;
    }
    if (password !== confirm) {
      setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const clean = normalizeUsername(username);

    const { data, error } = await supabase.auth.signUp({
      email: toSyntheticEmail(clean),
      password,
      options: { data: { username: clean } },
    });

    if (error) {
      setError(describe(error.message));
      setBusy(false);
      return;
    }

    // Supabase returns a session immediately only when email confirmation is
    // off. If confirmation is on, the synthetic address can never receive mail
    // and the account would be unusable — say so instead of hanging.
    if (!data.session) {
      setError(
        'สมัครได้ แต่ยังเข้าไม่ได้ — ตั้งค่า Supabase ให้ปิด Email confirmation (สูงรายชื่ออีเมล)',
      );
      setBusy(false);
      return;
    }

    router.replace('/');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <AuthAlert tone="error">{error}</AuthAlert>}

      <div className="space-y-1.5">
        <Label htmlFor="username">ชื่อผู้ใช้</Label>
        <Input
          id="username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="a-z, 0-9 และ _ (เริ่มต้นด้วยตัวอักษร)"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">รหัสผ่าน</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirm">ยืนยันรหัสผ่าน</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>

      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" />}
        สมัครสมาชิก
      </Button>
    </form>
  );
}