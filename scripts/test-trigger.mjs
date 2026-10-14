/**
 * Trigger behaviour checks. Each case inserts into auth.users (which is what
 * Supabase Auth does on signup) and inspects the profile the trigger created.
 *
 *   npm run db:test-trigger
 *
 * Fixtures use fixed UUIDs so re-runs are idempotent, and every row is removed
 * on the way out. Unlike the credit test this one COMMITS — the point is to
 * exercise the trigger, which only fires on real inserts.
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const ID = {
  explicit: '00000000-0000-4000-8000-0000000c0de1',
  google: '00000000-0000-4000-8000-0000000c0de2',
  hostile: '00000000-0000-4000-8000-0000000c0de3',
  admin: '00000000-0000-4000-8000-0000000c0de4',
};
const all = Object.values(ID);

const insertAuthUser = (id, email, meta) => sql`
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) values (
    '00000000-0000-0000-0000-000000000000', ${id}::uuid,
    'authenticated', 'authenticated', ${email}, '',
    now(), now(), now(), '{}'::jsonb, ${sql.json(meta)}
  )
`;

const profile = (id) => sql`select username, role, credits_balance, email from public.users where id = ${id}`;

try {
  await sql`delete from auth.users where id in ${sql(all)}`;

  // 1. Username/password signup carries the username in metadata.
  await insertAuthUser(ID.explicit, 'bob@users.aichat.app', { username: 'bob' });
  let p = (await profile(ID.explicit))[0];
  check('uses the chosen username', p?.username === 'bob', `got ${p?.username}`);
  check('grants welcome credits', p?.credits_balance === 20, `balance=${p?.credits_balance}`);
  check('defaults to role=user', p?.role === 'user', `role=${p?.role}`);

  // 2. Google sign-in with the same local part must not collide.
  await insertAuthUser(ID.google, 'bob@gmail.com', { full_name: 'Bob G' });
  p = (await profile(ID.google))[0];
  check(
    'google collision gets a suffix',
    p?.username?.startsWith('bob') && p?.username !== 'bob',
    `got ${p?.username}`,
  );
  check('google keeps its real email', p?.email === 'bob@gmail.com', `email=${p?.email}`);

  // 3. Hostile metadata is sanitised, not rejected.
  await insertAuthUser(ID.hostile, 'weird@users.aichat.app', { username: ' 9Bad Name!! ' });
  p = (await profile(ID.hostile))[0];
  check('sanitises an invalid username', /^[a-z][a-z0-9_]{2,31}$/.test(p?.username ?? ''), `got ${p?.username}`);

  // 4. First admin comes from app_settings.
  await sql`update public.app_settings set value = '["admin"]'::jsonb where key = 'admin_usernames'`;
  await insertAuthUser(ID.admin, 'admin@users.aichat.app', '{"username":"admin"}');
  p = (await profile(ID.admin))[0];
  check('promotes the configured admin', p?.role === 'admin', `role=${p?.role}`);
} catch (err) {
  check('trigger executed without error', false, err.message);
} finally {
  await sql`delete from auth.users where id in ${sql(all)}`;
  await sql`update public.app_settings set value = '[]'::jsonb where key = 'admin_usernames'`;
  await sql.end();
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length}/${results.length} FAILED` : `\nall ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);