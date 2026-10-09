/**
 * Connection smoke test. Run it before `npm run db:migrate` so a failure points
 * at the URL / network rather than at your SQL.
 *
 *   npm run db:check
 *
 * Checks, in order: can we connect, is it actually Postgres, does the Supabase
 * `auth` schema exist (our migrations depend on auth.users), and are the
 * expected tables already there.
 */
import postgres from 'postgres';

const url = process.env.DATABASE_URL;

if (!url) {
  console.error('DATABASE_URL is not set — copy .env.example to .env.local');
  process.exit(1);
}

const redacted = url.replace(/:\/\/([^:]+):[^@]+@/, (_m, user) => `://${user}:***@`);
console.log(`→ ${redacted}`);

const sql = postgres(url, { max: 1, connect_timeout: 15, prepare: false });

try {
  const [row] = await sql`
    select version() as ver, current_database() as db, current_user as usr
  `;
  console.log(`✓ connected to "${row.db}" as ${row.usr}`);
  console.log(`  ${row.ver.split(',')[0]}`);

  const [{ exists: hasAuth }] = await sql`
    select exists (
      select 1 from information_schema.schemata
      where schema_name = 'auth'
    ) as exists
  `;
  console.log(
    hasAuth
      ? '✓ auth schema found (trigger + FK will work)'
      : '✗ no auth schema — is this a Supabase project URL?',
  );

  const tables = await sql`
    select table_name from information_schema.tables
    where table_schema = 'public'
      and table_name in ('users','orders','credit_packages','app_settings')
    order by table_name
  `;
  console.log(
    tables.length === 0
      ? '· no app tables yet — run `npm run db:migrate`'
      : `✓ tables present: ${tables.map((t) => t.table_name).join(', ')}`,
  );

  // Only meaningful once the migration has run.
  const packs = await sql`select code, price_thb, credits from public.credit_packages order by sort_order`;
  if (packs.length) {
    console.log(`✓ packages: ${packs.map((p) => `${p.code} ${p.price_thb}฿/${p.credits}`).join(' · ')}`);
  }

  const settings = await sql`select key from public.app_settings order by key`;
  if (settings.length) {
    console.log(`✓ settings: ${settings.map((s) => s.key).join(', ')}`);
  }

  const fns = await sql`
    select p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('consume_credit','refund_credit','complete_usage','grant_order_credits','daily_quota_for')
    order by p.proname
  `;
  console.log(`✓ credit functions: ${fns.map((f) => f.proname).join(', ') || '(none)'}`);

  const [{ rls: rlsCount }] = await sql`
    select count(*)::int as rls
    from pg_tables
    where schemaname = 'public' and rowsecurity
  `;
  console.log(`· ${rlsCount} tables with RLS enabled`);

  if (!hasAuth) process.exitCode = 1;
} catch (err) {
  console.error(`✗ connection failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}