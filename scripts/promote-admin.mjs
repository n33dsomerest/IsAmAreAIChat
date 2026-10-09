/**
 * Promote usernames to admin.
 *
 *   npm run admin:promote -- alice bob     add to admin list (and flip existing rows)
 *   npm run admin:promote -- --list        show the setting and current admins
 *
 * Roles live in `app_settings.admin_usernames`, which the signup trigger reads.
 * Adding a name there means the *next* account with that name is created as an
 * admin; this script also updates accounts that already exist. Keep the setting
 * in sync so a later re-registration stays an admin.
 *
 * This one commits — unlike the test scripts.
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const args = process.argv.slice(2);
const targets = args.filter((a) => !a.startsWith('--')).map((s) => s.trim().toLowerCase());

if (args.includes('--list') || !targets.length) {
  const [row] = await sql`select value from public.app_settings where key = 'admin_usernames'`;
  const admins = await sql`select username, email from public.users where role = 'admin' order by username`;
  console.log('admin_usernames setting:', JSON.stringify(row?.value ?? []));
  console.log('current admins        :', admins.map((a) => `${a.username} <${a.email}>`).join(', ') || '(none)');
  if (!targets.length && !args.includes('--list')) {
    console.error('\nusage: npm run admin:promote -- <username> [username…]');
  }
  await sql.end();
  process.exit(args.includes('--list') ? 0 : 1);
}

await sql.begin(async (tx) => {
  const [row] = await tx`
    select coalesce(array_agg(e #>> '{}'), '{}') as names
      from public.app_settings,
           lateral jsonb_array_elements(value) as e
     where key = 'admin_usernames'
  `;
  const merged = [...new Set([...row.names, ...targets])];

  await tx`
    update public.app_settings
       set value = to_jsonb(${merged}::text[]), updated_at = now()
     where key = 'admin_usernames'
  `;

  const updated = await tx`
    update public.users set role = 'admin' where lower(username) = any(${targets})
    returning username, email
  `;

  console.log(`✓ admin_usernames = ${JSON.stringify(merged)}`);
  console.log(
    `  promoted now: ${updated.map((u) => u.username).join(', ') || '(no existing account — takes effect on next signup)'}`,
  );
});

await sql.end();