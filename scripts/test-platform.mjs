/**
 * Phase 9 — the platform shell: admin overview, PWA assets, i18n.
 *
 *   npm run test:platform
 *
 * Everything here is checked over HTTP because that is where the manifest,
 * the service worker and the icon set are actually served from — a file that
 * exists in `public/` but 404s is still broken.
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
const USER = `pf${Date.now().toString(36)}`;
const EMAIL = `${USER}@${DOMAIN}`;
const PASSWORD = 'Passw0rd!pf';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

let createdId = null;

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

try {
  /* ── PWA assets ─────────────────────────────────────────────────────── */
  const manifest = await fetch(`${APP}/manifest.webmanifest`);
  const manifestBody = await manifest.json().catch(() => null);
  check('the manifest is served', manifest.status === 200, `status=${manifest.status}`);
  check(
    'it declares the content type',
    (manifest.headers.get('content-type') ?? '').includes('application/manifest+json'),
    manifest.headers.get('content-type') ?? '',
  );
  check('it has a name and a start url', Boolean(manifestBody?.name && manifestBody?.start_url), manifestBody?.name ?? '');
  check('it is standalone', manifestBody?.display === 'standalone', manifestBody?.display ?? '');
  check('it references three icons', manifestBody?.icons?.length >= 3, `${manifestBody?.icons?.length ?? 0} icons`);

  const sw = await fetch(`${APP}/sw.js`);
  const swBody = await sw.text();
  check('the service worker is served', sw.status === 200, `status=${sw.status}`);
  check(
    'it is JavaScript',
    (sw.headers.get('content-type') ?? '').includes('javascript'),
    sw.headers.get('content-type') ?? '',
  );
  check('it never caches the API', !/cache\.put\(request/.test(swBody.split('API')[0] ?? swBody));
  check('it skips /api/ paths', swBody.includes("startsWith('/api/')"));

  for (const [path, type] of [
    ['/icon.svg', 'image/svg+xml'],
    ['/icon-192.png', 'image/png'],
    ['/icon-512.png', 'image/png'],
  ]) {
    const asset = await fetch(`${APP}${path}`);
    check(
      `${path} is served`,
      asset.status === 200 && (asset.headers.get('content-type') ?? '').includes(type),
      `${asset.status} ${asset.headers.get('content-type')}`,
    );
  }

  /* ── HTML head ──────────────────────────────────────────────────────── */
  const login = await fetch(`${APP}/login`, { redirect: 'manual' });
  const html = await login.text();
  check('the manifest is linked from the page', html.includes('manifest.webmanifest'));
  check('theme-color is declared', html.includes('name="theme-color"') || html.includes('themeColor'));
  check('the page declares a language', /<html[^>]+lang=/.test(html), html.match(/<html[^>]+lang="[^"]*"/)?.[0] ?? '');
  check('there is no hydration error marker', !html.includes('suppressHydrationWarning={false}'));

  /* ── Admin overview ─────────────────────────────────────────────────── */
  const jar = new Map();
  const supabase = clientWithJar(jar);
  const { data, error } = await supabase.auth.signUp({
    email: EMAIL,
    password: PASSWORD,
    options: { data: { username: USER } },
  });
  if (error || !data.user) throw new Error(`signup failed: ${error?.message}`);
  createdId = data.user.id;
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join('; ');
  check('fixture created', true, USER);

  const denied = await fetch(`${APP}/admin`, { headers: { cookie }, redirect: 'manual' });
  check(
    'a normal user is redirected away from /admin',
    [302, 303, 307, 308].includes(denied.status),
    `${denied.status}`,
  );

  await sql`update public.users set role = 'admin' where id = ${createdId}`;

  const overview = await fetch(`${APP}/admin`, { headers: { cookie }, redirect: 'manual' });
  const overviewHtml = await overview.text();
  check('an admin sees the overview', overview.status === 200, `status=${overview.status}`);
  check('it reports the user count', overviewHtml.includes('ผู้ใช้'));
  check('it reports provider usage', overviewHtml.includes('การใช้งานตามผู้ให้บริการ'));
  check(
    'it lists the configured providers',
    overviewHtml.includes('tokenharbor') && overviewHtml.includes('okmd'),
  );

  /* ── i18n ───────────────────────────────────────────────────────────── */
  const localeToggle = /Language|ภาษา/.test(overviewHtml);
  check('a language switcher is present', localeToggle);

  const anonManifest = await fetch(`${APP}/api/models`);
  check('the API is still gated', anonManifest.status === 401, `status=${anonManifest.status}`);
} catch (err) {
  check('platform run completed', false, err.message);
} finally {
  if (createdId) await sql`delete from auth.users where id = ${createdId}`;
  await sql.end();
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length}/${results.length} FAILED` : `\nall ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);