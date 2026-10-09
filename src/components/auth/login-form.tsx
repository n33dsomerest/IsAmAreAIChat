'use client';

import { Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { AuthAlert } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toSyntheticEmail } from '@/lib/auth/username';
import { createClient } from '@/lib/supabase/client';

/** Maps Supabase Auth error codes onto Thai copy. */
function describe(error: string): string {
  if (error.includes('Invalid login credentials'))
    return 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
  if (error.includes('Email not confirmed'))
    return 'บัญชียังไม่ได้ยืนยันอีเมล — ดูวิธีตั้งค่าใน README';
  if (error.includes('rate limit') || error.includes('too many'))
    return 'พยายามหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่';
  return error;
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: toSyntheticEmail(username),
      password,
    });

    if (error) {
      setError(describe(error.message));
      setBusy(false);
      return;
    }

    router.replace(next);
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
          placeholder="เช่น somchai"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">รหัสผ่าน</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" />}
        เข้าสู่ระบบ
      </Button>
    </form>
  );
}