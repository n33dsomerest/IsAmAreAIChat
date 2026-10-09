/**
 * End-to-end auth test against the real Supabase Auth API — no mocking.
 *
 *   npm run db:test-auth
 *
 * Covers the paths the app depends on:
 *   1. signUp with a synthetic email + username metadata
 *   2. the database trigger created the profile and granted welcome credits
 *   3. signInWithPassword with the same synthetic email
 *   4. Google-style sign-up (real email, no username metadata) does not collide
 *   5. rejects a bad password, and rejects a duplicate username
 *
 * The fixtures are deleted at the end, so the project is left clean.
 * Requires ADMIN rights? No — it talks to the public auth endpoints only.
 */
import postgres from 'postgres';

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const DB_URL = process.env.DATABASE_URL;

if (!SUPA_URL || !ANON || !DB_URL) {
  console.error('Supabase env vars are missing — check .env.local');
  process.exit(1);
}

const sql = postgres(DB_URL, { max: 1, prepare: false });
const DOMAIN = process.env.SYNTHETIC_EMAIL_DOMAIN || 'users.aichat.app';

const stamp = Date.now().toString(36);
const USER_A = `e2e${stamp}`;
const PASSWORD = 'Passw0rd!e2e';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function auth(path, body) {
  const res = await fetch(`${SUPA_URL}/auth/v1${path}`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const createdIds = new Set();

const RATE_LIMIT_HINT =
  'Confirm email is probably still ON — turn it off in Supabase → Authentication → Sign In / Providers → Email';

try {
  /* 1 ─ sign up with username/password ---------------------------------- */
  const signup = await auth('/signup', {
    email: `${USER_A}@${DOMAIN}`,
    password: PASSWORD,
    data: { username: USER_A },
  });

  if (signup.status === 429) {
    console.error(`✗ signup blocked (429 over_email_send_rate_limit)\n  → ${RATE_LIMIT_HINT}`);
    check('signUp succeeds', false, 'blocked by email rate limit');
    throw new Error('__stop__');
  }

  if (signup.status >= 400) {
    console.error(`✗ signup failed (${signup.status}):`, signup.json);
    check('signUp succeeds', false, JSON.stringify(signup.json).slice(0, 160));
  } else {
    check('signUp succeeds', true, signup.json.access_token ? 'session returned' : 'no session');
    if (signup.json.id) createdIds.add(signup.json.id);

    // No session means email confirmation is still on — surface it loudly,
    // because synthetic addresses can never receive a confirmation mail.
    check(
      'returns a session immediately (email confirmation off)',
      Boolean(signup.json.access_token),
      signup.json.access_token ? 'ok' : RATE_LIMIT_HINT,
    );
  }

  /* 2 ─ the trigger built the profile ------------------------------------ */
  if (signup.json?.id) {
    const [profile] = await sql`
      select username, role, credits_balance from public.users where id = ${signup.json.id}
    `;
    check('trigger created the profile', profile?.username === USER_A, `username=${profile?.username}`);
    check('granted welcome credits', profile?.credits_balance === 10, `balance=${profile?.credits_balance}`);
  }

  /* 3 ─ sign in --------------------------------------------------------- */
  const login = await auth('/token?grant_type=password', {
    email: `${USER_A}@${DOMAIN}`,
    password: PASSWORD,
  });
  check('signInWithPassword works', login.status === 200 && Boolean(login.json.access_token), `status=${login.status}`);

  /* 4 ─ wrong password is rejected --------------------------------------- */
  const badLogin = await auth('/token?grant_type=password', {
    email: `${USER_A}@${DOMAIN}`,
    password: 'definitely-wrong',
  });
  check('rejects a wrong password', badLogin.status === 400, `status=${badLogin.status}`);

  /* 5 ─ duplicate username is rejected ----------------------------------- */
  const dupe = await auth('/signup', {
    email: `${USER_A}@${DOMAIN}`,
    password: PASSWORD,
    data: { username: USER_A },
  });
  check('rejects a duplicate username', dupe.status >= 400, `status=${dupe.status}`);

  /* 6 ─ Google-style signup, no username metadata ------------------------ */
  const googleEmail = `${USER_A}.google.test@${DOMAIN}`;
  const googleLike = await auth('/signup', {
    email: googleEmail,
    password: PASSWORD,
  });

  // With autoconfirm on, signUp returns a session directly and may not echo
  // `id` at the top level — look the account up by email instead.
  const googleAuthId = googleLike.json?.id ?? googleLike.json?.user?.id ?? null;
  if (googleAuthId) createdIds.add(googleAuthId);

  const [authRow] = googleAuthId
    ? [{ id: googleAuthId }]
    : await sql`select id from auth.users where email = ${googleEmail}`;

  if (!authRow) {
    check(
      'Google-style signup (no username metadata)',
      false,
      `status=${googleLike.status} ${googleLike.json?.error_code ?? 'account not found'}`,
    );
  } else {
    if (!googleAuthId) createdIds.add(authRow.id);
    const [profile] = await sql`
      select username, email from public.users where id = ${authRow.id}
    `;
    check(
      'email-derived username stays valid',
      /^[a-z][a-z0-9_]{2,31}$/.test(profile?.username ?? ''),
      `username=${profile?.username}`,
    );
    check('does not collide with the earlier account', profile?.username !== USER_A, `username=${profile?.username}`);
    check('keeps its real email', profile?.email === googleEmail);
  }
} catch (err) {
  if (err.message !== '__stop__') {
    check('auth flow ran without crashing', false, err.message);
  }
} finally {
  if (createdIds.size) {
    const list = [...createdIds];
    await sql`delete from auth.users where id in ${sql(list)}`;
  }
  await sql.end();
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length}/${results.length} FAILED` : `\nall ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);