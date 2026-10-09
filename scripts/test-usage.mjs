/**
 * Phase 4 — credit lifecycle around a real generation attempt.
 *
 *   npm run db:test-usage
 *
 * The point is the unhappy path: a request that fails has to give the credit
 * back, must not eat the free-tier daily quota, and must not be refundable a
 * second time. Everything runs inside a transaction that is always rolled back.
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Must match `to_char(created_at AT TIME ZONE 'utc')` in the SQL functions. */
const today = () => new Date().toISOString().slice(0, 10);

const balance = async (id) =>
  (await sql`select credits_balance from public.users where id = ${id}`)[0].credits_balance;

let user = null;

try {
  const rows = await sql`
    select id, credits_balance, first_paid_at from public.users order by created_at limit 1`;
  user = rows[0];
  if (!user) throw new Error('no user to run against');
  const day = today();

  await sql`begin`;
  const start = user.credits_balance;

  /* ── happy path: charged, settled as success ───────────────────────────── */
  const ok = await sql`select * from public.consume_credit(${user.id}, null, null, ${day})`;
  check('consume_credit succeeds', ok[0].ok === true, `balance=${ok[0].balance}`);
  check('consume_credit deducts one', ok[0].balance === start - 1, `${start} → ${ok[0].balance}`);

  await sql`insert into public.rate_limits (user_id, day, requests_used)
             values (${user.id}, ${day}, 1)
             on conflict (user_id, day) do update set requests_used = 1`;

  await sql`select public.complete_usage(${ok[0].usage_event_id}, 120, 45, 0, 812, 0.0004, null)`;
  const settled = (
    await sql`select status, input_tokens, output_tokens, latency_ms, error
                from public.usage_events where id = ${ok[0].usage_event_id}`
  )[0];

  check('success event is marked success', settled.status === 'success', settled.status);
  check('tokens recorded', settled.input_tokens === 120 && settled.output_tokens === 45);
  check('latency recorded', settled.latency_ms === 812, `${settled.latency_ms}ms`);
  check('no error on success', settled.error === null);
  check('credit stays spent', (await balance(user.id)) === start - 1);

  /* ── failure path: refunded, quota restored ────────────────────────────── */
  const beforeFail = await balance(user.id);
  const bad = await sql`select * from public.consume_credit(${user.id}, null, null, ${day})`;
  check('second request is charged first', bad[0].balance === beforeFail - 1);

  const usedBefore = (
    await sql`select requests_used from public.rate_limits where user_id=${user.id} and day=${day}`
  )[0].requests_used;

  await sql`select public.complete_usage(${bad[0].usage_event_id}, 90, 0, 0, 30, 0.0001, 'provider 500'::text)`;
  const failed = (
    await sql`select status, error from public.usage_events where id = ${bad[0].usage_event_id}`
  )[0];
  const usedAfter = (
    await sql`select requests_used from public.rate_limits where user_id=${user.id} and day=${day}`
  )[0].requests_used;

  check('failure event is marked refunded', failed.status === 'refunded', failed.status);
  check('failure reason stored', failed.error === 'provider 500', failed.error);
  check('credit handed back', (await balance(user.id)) === beforeFail);
  check(
    'daily quota counter restored',
    usedAfter === usedBefore - 1,
    `${usedBefore} → ${usedAfter}`,
  );

  /* ── a settled event cannot be refunded twice ──────────────────────────── */
  await sql`select public.refund_credit(${bad[0].usage_event_id})`;
  check('double refund is refused', (await balance(user.id)) === beforeFail);

  await sql`select public.refund_credit(${ok[0].usage_event_id})`;
  check('a completed event cannot be refunded', (await balance(user.id)) === beforeFail);

  /* ── the ledger agrees with the balance ────────────────────────────────── */
  const ledger = (
    await sql`select coalesce(sum(amount), 0)::int as total from public.credit_transactions
               where user_id = ${user.id}`
  )[0].total;
  check('ledger net matches the balance', ledger === beforeFail, `ledger=${ledger} balance=${beforeFail}`);

  await sql`rollback`;
} catch (err) {
  check('usage run completed', false, err.message);
  try {
    await sql`rollback`;
  } catch {
    /* already rolled back */
  }
} finally {
  await sql.end();
}

const failedChecks = results.filter((r) => !r.pass);
console.log(
  failedChecks.length
    ? `\n${failedChecks.length}/${results.length} FAILED`
    : `\nall ${results.length} checks passed (rolled back, nothing was written)`,
);
process.exit(failedChecks.length ? 1 : 0);