/**
 * End-to-end HTTP test through the running app.
 *
 *   npm run test:e2e          (expects the server on APP_URL, default :3000)
 *
 * Signs a real account up through `@supabase/ssr` — the same library the app
 * uses — captures the session cookie it writes, then replays it against the
 * Next.js server:
 *
 *   - anonymous /            → redirected to /login
 *   - anonymous /pricing     → 200 (marketing stays public)
 *   - anonymous /login       → 200
 *   - signed-in /            → 200, shows the username and credit balance
 *   - signed-in /login       → redirected to /
 *   - QR asset               → 200 image/png
 *
 * The fixture user is deleted at the end.
 */
import { createServerClient } from '@supabase/ssr';
import postgres from 'postgres';

const APP = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const DOMAIN = process.env.SYNTHETIC_EMAIL_DOMAIN || 'users.aichat.app';

if (!SUPA || !ANON) {
  console.error('Supabase env vars missing');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const USER = `e2ew${Date.now().toString(36)}`;
const EMAIL = `${USER}@${DOMAIN}`;
const PASSWORD = 'Passw0rd!e2e';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

let createdId = null;

/**
 * A Supabase client whose cookies land in a plain Map, so the test can read
 * back exactly what @supabase/ssr wrote and replay it to the app.
 */
function clientWithJar(jar) {
  return createServerClient(SUPA, ANON, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const { name, value } of list) jar.set(name, value);
      },
    },
  });
}

const get = async (path, cookie) => {
  const res = await fetch(`${APP}${path}`, {
    redirect: 'manual',
    headers: cookie ? { cookie } : {},
  });
  return { status: res.status, location: res.headers.get('location'), body: await res.text() };
};

try {
  /* Sign up through the same SSR client the app uses --------------------- */
  const jar = new Map();
  const supabase = clientWithJar(jar);

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: EMAIL,
    password: PASSWORD,
    options: { data: { username: USER } },
  });

  createdId = signUpData.user?.id ?? null;
  if (signUpError || !createdId) {
    console.error('✗ signUp failed:', signUpError?.message ?? 'no user returned');
  }

  const [row] = await sql`select id, username, credits_balance from public.users where email = ${EMAIL}`;
  createdId = createdId ?? row?.id ?? null;

  const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');

  check('signup created an account', Boolean(createdId), createdId ? `id=${createdId.slice(0, 8)}…` : 'none');
  check(
    'trigger set the profile',
    row?.username === USER && row?.credits_balance === 10,
    `username=${row?.username} credits=${row?.credits_balance}`,
  );
  check('session cookie written by @supabase/ssr', cookie.startsWith('sb-'), cookie.split('=')[0] ?? 'none');

  /* Anonymous behaviour ---------------------------------------------------- */
  const anonHome = await get('/');
  check(
    'anonymous / is redirected to /login',
    [302, 303, 307, 308].includes(anonHome.status) && (anonHome.location ?? '').includes('/login'),
    `${anonHome.status} → ${anonHome.location ?? '(none)'}`,
  );

  const anonPricing = await get('/pricing');
  check('anonymous /pricing is public', anonPricing.status === 200, `status=${anonPricing.status}`);

  const anonLogin = await get('/login');
  check('anonymous /login renders', anonLogin.status === 200, `status=${anonLogin.status}`);

  /* Signed-in behaviour --------------------------------------------------- */
  if (cookie.startsWith('sb-')) {
    const home = await get('/', cookie);
    check('signed-in / renders', home.status === 200, `status=${home.status}`);
    check('page shows the username', home.body.includes(USER), USER);
    check('page shows the credit balance', home.body.includes('เครดิต'));

    const pricing = await get('/pricing', cookie);
    check('signed-in /pricing renders', pricing.status === 200, `status=${pricing.status}`);

    const bounce = await get('/login', cookie);
    check(
      'signed-in /login bounces to /',
      [302, 303, 307, 308].includes(bounce.status) && (bounce.location ?? '').endsWith('/'),
      `${bounce.status} → ${bounce.location ?? '(none)'}`,
    );
  }

  const qr = await fetch(`${APP}/qr/99Baht.png`);
  check(
    'QR asset is served',
    qr.status === 200 && (qr.headers.get('content-type') ?? '').includes('image/png'),
    `${qr.status} ${qr.headers.get('content-type')}`,
  );
} catch (err) {
  check('e2e run completed', false, err.message);
} finally {
  if (createdId) await sql`delete from auth.users where id = ${createdId}`;
  await sql.end();
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length}/${results.length} FAILED` : `\nall ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);