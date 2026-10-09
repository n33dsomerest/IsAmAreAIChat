import { sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { Activity, Coins, Cpu, FolderTree, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getCurrentUser } from '@/lib/auth/current-user';
import { db } from '@/lib/db';
import { orders, providerModels, providers, users } from '@/lib/db/schema';
import { formatBaht } from '@/lib/site-config';

export const metadata = { title: 'ภาพรวม · ผู้ดูแลระบบ' };
export const instant = false;

export default async function AdminHomePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/');

  const [users_, providers_, models_, last30] = await Promise.all([
    db.select().from(users),
    db.select().from(providers),
    db.select().from(providerModels),
    db.execute(sql`
      select
        count(*)::int as requests,
        coalesce(sum(input_tokens + output_tokens), 0)::bigint as tokens,
        coalesce(sum(provider_cost_usd), 0)::numeric as usd
      from public.usage_events
      where status = 'success'
        and created_at >= now() - interval '30 days'
    `),
  ]);

  const paid = await db.select().from(orders).where(sql`status = 'paid'`);

  const spend = paid.reduce((sum, o) => sum + o.amountThb, 0);
  const creditsSold = paid.reduce((sum, o) => sum + o.credits, 0);

  const usage = (Array.isArray(last30) ? last30[0] : last30) as unknown as {
    requests: number;
    tokens: string;
    usd: string;
  };

  /** Requests per provider over 30 days — the fallback chain made visible. */
  const byProvider = await db.execute(sql`
    select coalesce(u.provider_name, '—') as provider,
           count(*)::int as requests,
           count(*) filter (where u.attempts > 1)::int as retried,
           round(avg(u.latency_ms))::int as avg_ms
      from public.usage_events u
     where u.created_at >= now() - interval '30 days'
     group by 1
     order by 2 desc
  `);

  const providerRows = (Array.isArray(byProvider) ? byProvider : []) as unknown as {
    provider: string;
    requests: number;
    retried: number;
    avg_ms: number;
  }[];

  const creditsOut = users_.reduce((sum, u) => sum + u.creditsBalance, 0);

  return (
    <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">ภาพรวมระบบ</h1>
          <Badge variant="secondary">admin</Badge>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="ผู้ใช้" value={users_.length} icon={<Users className="size-4" />} />
          <Stat
            label="โมเดลที่เปิดใช้"
            value={models_.filter((m) => m.enabled).length}
            hint={`จาก ${models_.length} โมเดลในแคตตาล็อก`}
            icon={<Cpu className="size-4" />}
          />
          <Stat
            label="คำขอ 30 วัน"
            value={usage.requests}
            hint={`${Number(usage.tokens).toLocaleString()} tokens`}
            icon={<Activity className="size-4" />}
          />
          <Stat
            label="ยอดขาย"
            value={formatBaht(spend)}
            hint={`${creditsSold.toLocaleString()} เครดิต · ในวงเงิน ${creditsOut.toLocaleString()}`}
            icon={<Coins className="size-4" />}
          />
        </div>

        <h2 className="mt-8 mb-3 text-sm font-medium">การใช้งานตามผู้ให้บริการ (30 วัน)</h2>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ผู้ให้บริการ</TableHead>
                <TableHead className="text-right">คำขอ</TableHead>
                <TableHead className="text-right">สลับตัวสำรอง</TableHead>
                <TableHead className="text-right">เฉลี่ย</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providerRows.map((row) => (
                <TableRow key={row.provider}>
                  <TableCell className="font-medium">{row.provider}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.requests}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.retried}</TableCell>
                  <TableCell className="text-muted-foreground text-right tabular-nums">
                    {row.avg_ms ? `${row.avg_ms} ms` : '—'}
                  </TableCell>
                </TableRow>
              ))}
              {providerRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground py-8 text-center">
                    ยังไม่มีข้อมูลการใช้งาน
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <h2 className="mt-8 mb-3 flex items-center gap-1.5 text-sm font-medium">
          <FolderTree className="size-4" />
          ผู้ให้บริการ
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {providers_.map((p) => (
            <div key={p.id} className="rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <span className="font-medium">{p.name}</span>
                <Badge variant="secondary">{p.kind}</Badge>
                {!p.enabled && (
                  <Badge variant="outline" className="text-muted-foreground">
                    ปิด
                  </Badge>
                )}
                <span className="text-muted-foreground ml-auto text-xs">
                  ลำดับ {p.sortOrder}
                </span>
              </div>
              <p className="text-muted-foreground mt-1 truncate font-mono text-xs">{p.baseUrl}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {models_.filter((m) => m.providerId === p.id && m.enabled).length} โมเดลเปิดใช้ ·{' '}
                <span className="font-mono">{p.envKeyName}</span>{' '}
                {process.env[p.envKeyName] ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้ตั้งค่า'}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>}
    </div>
  );
}