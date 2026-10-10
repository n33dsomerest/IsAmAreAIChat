/**
 * Backfills `public.users` rows for auth accounts that never got one.
 *
 *   node scripts/repair-missing-profiles.mjs [--dry-run]
 *
 * Accounts created before the `on_auth_user_created` trigger was installed have
 * a valid Supabase session but no profile row. `getCurrentUser()` then reads
 * zero rows, logs PGRST116 and returns null, so the app renders "signed out"
 * for someone who is actually signed in.
 *
 * The username and welcome-bonus rules below are copied from
 * `handle_new_user()`. If that trigger changes, re-copy them here.
 *
 * The script is additive and idempotent: it only inserts rows that do not
 * exist, and re-running it after a repair does nothing.
 */
import postgres from 'postgres';

const dryRun = process.argv.includes('--dry-run');
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });

const ADMIN_LIST = async () => {
  const rows = await sql`
    select array_agg(elem #>> '{}') as names
    from public.app_settings, lateral jsonb_array_elements(value) as elem
    where key = 'admin_usernames'`;
  return rows[0]?.names ?? [];
};

/** Same derivation as the trigger: explicit username, else the email local part. */
function desiredUsername(authUser) {
  const explicit = (authUser.raw_user_meta_data?.username ?? '').trim();
  const emailLocal = (authUser.email ?? '').split('@')[0];
  let desired = explicit || emailLocal || 'user';

  desired = desired.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase().slice(0, 28);
  if (desired && !/^[a-z]/.test(desired)) desired = `u${desired}`;
  return desired || 'user';
}

async function pickUsername(desired, taken) {
  let candidate = desired;
  if (taken.has(candidate)) {
    for (let i = 0; i < 20; i++) {
      const suffix = Math.random().toString(16).slice(2, 6);
      candidate = `${desired.slice(0, 27)}${suffix}`;
      if (!taken.has(candidate)) break;
    }
  }
  return candidate;
}

const orphans = await sql`
  select a.id, a.email, a.raw_user_meta_data
  from auth.users a
  where not exists (select 1 from public.users u where u.id = a.id)
  order by a.created_at`;

if (!orphans.length) {
  console.log('every auth account already has a profile row');
  await sql.end();
  process.exit(0);
}

const freeAmount =
  (await sql`select (value ->> 'amount')::int as n from public.app_settings where key = 'free_tier'`)[0]
    ?.n ?? 10;
const admins = await ADMIN_LIST();

console.log(`${orphans.length} account(s) missing a profile row`);
if (dryRun) console.log('(dry run — nothing written)\n');

const taken = new Set((await sql`select lower(username) as u from public.users`).map((r) => r.u));

for (const acct of orphans) {
  const desired = desiredUsername(acct);
  const username = await pickUsername(desired, taken);
  taken.add(username);

  const displayName = acct.raw_user_meta_data?.full_name || username;
  const role = admins.includes(username) ? 'admin' : 'user';

  if (dryRun) {
    console.log(`  would create ${username} <${acct.email}> role=${role} bonus=${freeAmount}`);
    continue;
  }

  await sql.begin(async (tx) => {
    await tx`insert into public.users (id, username, email, display_name, role)
              values (${acct.id}, ${username}, ${acct.email ?? ''}, ${displayName}, ${role}::public.user_role)`;
    if (freeAmount > 0) {
      await tx`insert into public.credit_transactions (user_id, type, amount, balance_after, note)
               values (${acct.id}, 'bonus', ${freeAmount}, ${freeAmount}, 'welcome bonus')`;
      await tx`update public.users set credits_balance = ${freeAmount} where id = ${acct.id}`;
    }
  });

  console.log(`  created ${username} <${acct.email}> role=${role} bonus=${freeAmount}`);
}

const left = await sql`
  select count(*)::int as n from auth.users a
  where not exists (select 1 from public.users u where u.id = a.id)`;
console.log(`\naccounts still missing a profile: ${left[0].n}`);

await sql.end();