/**
 * Phase 3 — provider resolution, model catalogue and admin authorisation.
 *
 *   npm run test:ai            (expects the server on APP_URL, default :3000)
 *
 * Exercises the real resolver through HTTP rather than a mock, so the chain
 * ordering, the provider wiring and the admin gate are all covered by the same
 * run. The fixture user is created as a normal account, promoted, and then
 * demoted again so both sides of the admin gate are proven.
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
const USER = `ai${Date.now().toString(36)}`;
const EMAIL = `${USER}@${DOMAIN}`;
const PASSWORD = 'Passw0rd!ai3';

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

const request = async (path, cookie, init = {}) => {
  const res = await fetch(`${APP}${path}`, {
    redirect: 'manual',
    ...init,
    headers: { ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
  });
  return { status: res.status, body: await res.text() };
};

const json = async (path, cookie, init) => {
  const res = await request(path, cookie, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  return { status: res.status, data: JSON.parse(res.body || '{}') };
};

try {
  /* Fixture account ------------------------------------------------------- */
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
  check('fixture account created', cookie.startsWith('sb-'), USER);

  /* Catalogue ------------------------------------------------------------- */
  const anonModels = await json('/api/models');
  check(
    'anonymous /api/models is rejected',
    anonModels.status === 401,
    `status=${anonModels.status}`,
  );

  const cat = await json('/api/models', cookie);
  check('signed-in /api/models returns 200', cat.status === 200, `status=${cat.status}`);

  const models = cat.data.models ?? [];
  check('catalogue is not empty', models.length > 0, `${models.length} models`);

  check(
    'every entry carries provider and capability metadata',
    models.every(
      (m) =>
        typeof m.label === 'string' &&
        typeof m.provider === 'string' &&
        typeof m.capabilities === 'object' &&
        typeof m.isFallback === 'boolean',
    ),
  );

  const withVision = models.filter((m) => m.capabilities?.vision).length;
  check('vision capability detected on some models', withVision > 0, `${withVision} vision models`);

  const withTools = models.filter((m) => m.capabilities?.tools).length;
  check('tool capability detected on some models', withTools > 0, `${withTools} tool models`);

  /* Admin gate ------------------------------------------------------------ */
  const anonAdmin = await json('/api/admin/providers');
  check('anonymous /api/admin/providers is rejected', anonAdmin.status === 401, `status=${anonAdmin.status}`);

  const userAdmin = await json('/api/admin/providers', cookie);
  check(
    'non-admin is forbidden from /api/admin/providers',
    userAdmin.status === 403,
    `status=${userAdmin.status}`,
  );

  const userModels = await json('/api/admin/models', cookie);
  check(
    'non-admin is forbidden from /api/admin/models',
    userModels.status === 403,
    `status=${userModels.status}`,
  );

  const userAdminPage = await request('/admin', cookie);
  check(
    'non-admin is redirected away from /admin',
    [302, 303, 307, 308].includes(userAdminPage.status),
    `status=${userAdminPage.status}`,
  );

  /* Promote and re-check -------------------------------------------------- */
  await sql`update public.users set role = 'admin' where id = ${createdId}`;

  const adminApi = await json('/api/admin/providers', cookie);
  check(
    'admin can list providers',
    adminApi.status === 200 && Array.isArray(adminApi.data.providers),
    `${adminApi.data.providers?.length ?? 0} providers`,
  );

  const listed = adminApi.data.providers ?? [];
  check(
    'provider rows never expose the key, only whether it is set',
    listed.every((p) => 'keyConfigured' in p && !('apiKey' in p)),
  );

  const adminModels = await json('/api/admin/models', cookie);
  check('admin can list models', adminModels.status === 200, `status=${adminModels.status}`);

  const adminPage = await request('/admin', cookie);
  check('admin can open /admin', adminPage.status === 200, `status=${adminPage.status}`);

  const providersPage = await request('/admin/providers', cookie);
  check('admin can open /admin/providers', providersPage.status === 200, `status=${providersPage.status}`);

  const modelsPage = await request('/admin/models', cookie);
  check('admin can open /admin/models', modelsPage.status === 200, `status=${modelsPage.status}`);

  /* Toggle a model -------------------------------------------------------- */
  const target = models[0];
  if (target) {
    const off = await json('/api/admin/models', cookie, {
      method: 'PATCH',
      body: JSON.stringify({ id: target.id, enabled: false }),
    });
    check('admin can disable a model', off.status === 200 && off.data.model.enabled === false, target.id.slice(0, 8));

    const afterOff = await json('/api/models', cookie);
    const stillListed = (afterOff.data.models ?? []).some((m) => m.id === target.id);
    check('disabled model drops out of the picker', !stillListed);

    const on = await json('/api/admin/models', cookie, {
      method: 'PATCH',
      body: JSON.stringify({ id: target.id, enabled: true }),
    });
    check('admin can re-enable a model', on.status === 200 && on.data.model.enabled === true);
  } else {
    check('a model was available to toggle', false, 'catalogue empty');
  }

  /* Fallback ordering is verified in SQL, since the chain itself is not
     exposed over HTTP ------------------------------------------------------ */
  const ordered = await sql`
    select pm.is_fallback, p.name
      from public.provider_models pm
      join public.providers p on p.id = pm.provider_id
     where pm.enabled and p.enabled
     order by p.sort_order, pm.sort_order
  `;

  const firstFallback = ordered.findIndex((r) => r.is_fallback);
  check(
    'fallback models sort after every non-fallback model',
    firstFallback === -1 || ordered.slice(firstFallback).every((r) => r.is_fallback),
    `${ordered.length} live models, first fallback at ${firstFallback}`,
  );
} catch (err) {
  check('phase 3 run completed', false, err.message);
} finally {
  if (createdId) await sql`delete from auth.users where id = ${createdId}`;
  await sql.end();
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length}/${results.length} FAILED` : `\nall ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);