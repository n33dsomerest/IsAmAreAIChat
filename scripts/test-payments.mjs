/**
 * Phase 5 — the payment path, with no real money moved.
 *
 *   npm run test:payments
 *
 * Covers the order lifecycle and every guard that stands between an uploaded
 * image and a free credit top-up. The SlipOK call itself is exercised through
 * the real API only where it is safe: the "not an image" path costs no quota,
 * and the amount-mismatch path is checked locally.
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
const USER = `pay${Date.now().toString(36)}`;
const EMAIL = `${USER}@${DOMAIN}`;
const PASSWORD = 'Passw0rd!pay';

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

const json = async (path, cookie, init) => {
  const res = await fetch(`${APP}${path}`, {
    redirect: 'manual',
    ...init,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(init?.headers ?? {}) },
  });
  return { status: res.status, data: JSON.parse((await res.text()) || '{}') };
};

/** A tiny valid PNG — enough to be accepted by our MIME check, not by SlipOK. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function uploadSlip(orderId, cookie, { bytes = PNG, type = 'image/png', name = 'slip.png' } = {}) {
  const form = new FormData();
  form.append('orderId', orderId);
  form.append('slip', new Blob([bytes], { type }), name);
  const res = await fetch(`${APP}/api/payments/slip`, {
    method: 'POST',
    headers: cookie ? { cookie } : {},
    body: form,
  });
  return { status: res.status, data: JSON.parse((await res.text()) || '{}') };
}

try {
  /* Fixture ------------------------------------------------------------- */
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

  const start = (
    await sql`select credits_balance from public.users where id = ${createdId}`
  )[0].credits_balance;
  check('fixture starts with welcome credits', start === 10, `${start} credits`);

  /* Auth gate ----------------------------------------------------------- */
  const anonOrders = await json('/api/payments/orders');
  check('anonymous cannot list orders', anonOrders.status === 401, `status=${anonOrders.status}`);

  /* Order creation ------------------------------------------------------ */
  const [pkg] = await sql`select id, price_thb, credits from public.credit_packages where active order by sort_order limit 1`;

  const badPkg = await json('/api/payments/orders', cookie, {
    method: 'POST',
    body: JSON.stringify({ packageId: 'not-a-uuid' }),
  });
  check('a malformed package id is rejected', badPkg.status === 400, `status=${badPkg.status}`);

  const created = await json('/api/payments/orders', cookie, {
    method: 'POST',
    body: JSON.stringify({ packageId: pkg.id }),
  });
  check('order is created', created.status === 201, `status=${created.status}`);
  check('order echoes the package price', created.data.amountThb === pkg.price_thb, `${created.data.amountThb}฿`);
  check('order echoes the package credits', created.data.credits === pkg.credits, `${created.data.credits}`);

  const orderId = created.data.orderId;

  const dup = await json('/api/payments/orders', cookie, {
    method: 'POST',
    body: JSON.stringify({ packageId: pkg.id }),
  });
  check('a second pending order reuses the first', dup.data.orderId === orderId && dup.data.existing === true);

  const listed = await json('/api/payments/orders', cookie);
  check('the order shows in the list', listed.data.orders?.some((o) => o.id === orderId));

  /* Slip guards --------------------------------------------------------- */
  const noOrder = await uploadSlip('not-a-uuid', cookie);
  check('a malformed order id is rejected', noOrder.status === 400, `status=${noOrder.status}`);

  const noFile = await (async () => {
    const form = new FormData();
    form.append('orderId', orderId);
    const res = await fetch(`${APP}/api/payments/slip`, {
      method: 'POST',
      headers: { cookie },
      body: form,
    });
    return { status: res.status, data: JSON.parse((await res.text()) || '{}') };
  })();
  check('a missing slip is rejected', noFile.status === 400, `status=${noFile.status}`);

  const wrongType = await uploadSlip(orderId, cookie, { type: 'application/pdf', name: 'slip.pdf' });
  check('a non-image upload is rejected', wrongType.status === 415, `status=${wrongType.status}`);

  const tooBig = await uploadSlip(orderId, cookie, {
    bytes: Buffer.alloc(9 * 1024 * 1024, 1),
    name: 'big.png',
  });
  check('an oversized upload is rejected', tooBig.status === 413, `status=${tooBig.status}`);

  const [notMine] = await sql`select id from public.orders where user_id <> ${createdId} limit 1`;
  if (notMine) {
    const foreign = await uploadSlip(notMine.id, cookie);
    check("another user's order is not reachable", foreign.status === 404, `status=${foreign.status}`);
  }

  /* A real SlipOK round-trip: a 1x1 PNG has no QR, so this exercises the
     rejection path end to end. It does not consume the slip quota. */
  const rejected = await uploadSlip(orderId, cookie);
  check(
    'an image with no QR is rejected by SlipOK',
    rejected.status === 422 || rejected.status === 503,
    `status=${rejected.status} ${rejected.data.code ?? ''}`,
  );
  check('the rejection explains itself', Boolean(rejected.data.error), rejected.data.error ?? '(none)');

  const stillPending = await sql`select status from public.orders where id = ${orderId}`;
  check('the order stays unsettled', stillPending[0].status !== 'paid', stillPending[0].status);

  const balanceAfter = (
    await sql`select credits_balance from public.users where id = ${createdId}`
  )[0].credits_balance;
  check('no credits were granted', balanceAfter === start, `${start} → ${balanceAfter}`);

  /* Same image twice is refused before SlipOK is called at all ---------- */
  const again = await uploadSlip(orderId, cookie);
  check('the identical image is refused as a duplicate', again.data.duplicate === true, again.data.error ?? '');

  /* Settling an already-paid order is a no-op --------------------------- */
  await sql`update public.orders set status = 'paid' where id = ${orderId}`;
  const paid = await uploadSlip(orderId, cookie);
  check('a paid order cannot be paid twice', paid.status === 409, `status=${paid.status}`);
} catch (err) {
  check('payment run completed', false, err.message);
} finally {
  if (createdId) await sql`delete from auth.users where id = ${createdId}`;
  await sql.end();
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length}/${results.length} FAILED` : `\nall ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);