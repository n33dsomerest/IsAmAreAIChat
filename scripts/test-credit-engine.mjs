/**
 * End-to-end test of the signup trigger + credit engine.
 *
 * Runs inside ONE transaction that is always rolled back, so your project is
 * left exactly as it was — no test users, no ledger rows.
 *
 *   npm run db:test-credit
 *
 * Note on rollback: `sql.begin()` COMMITs when its callback returns normally.
 * To force a rollback you have to throw out of the callback, which is what the
 * ROLLBACK sentinel below does.
 *
 * Verifies:
 *   1. inserting into auth.users fires the trigger and grants welcome credits
 *   2. consume_credit debits, writes a usage event + ledger row, and counts
 *      against the daily quota
 *   3. refund_credit gives the credit and the quota slot back
 *   4. the trial quota is enforced (10/day during the trial window)
 *   5. granting an order is idempotent and lifts the quota for good
 */
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set — copy .env.example to .env.local');
  process.exit(1);
}

const sql = postgres(url, { max: 1, connect_timeout: 15, prepare: false });

const ROLLBACK = new Error('__force_rollback__');
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const TEST_UUID = '00000000-0000-4000-8000-0000000c0de1';
const today = new Date().toISOString().slice(0, 10);

// A previous run may have been killed mid-transaction (unhandled error kills
// the process before ROLLBACK reaches the server), leaving the fixture behind.
// Clear it first so re-runs are reliable. Deleting auth.users cascades to
// public.users → orders / ledger / usage_events / rate_limits.
async function purgeFixture() {
  const { count } = await sql`
    select count(*)::int as count from auth.users where id = ${TEST_UUID}
  `;
  if (count) {
    await sql`delete from auth.users where id = ${TEST_UUID}`;
    console.log('· removed leftover test user from a previous run');
  }
}
await purgeFixture();

process.on('uncaughtException', async (err) => {
  console.error(err);
  // Closing the socket is what actually makes Postgres roll the open
  // transaction back, so do it on the way out.
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});

try {
  await sql.begin(async (tx) => {
  /* 1 ─ signup trigger ------------------------------------------------- */
  await tx`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      '00000000-0000-0000-0000-000000000000', ${TEST_UUID}::uuid,
      'authenticated', 'authenticated', 'credit-test@example.com', '',
      now(), now(), now(), '{"provider":"email"}'::jsonb,
      '{"username":"credit-test"}'::jsonb
    )
  `;

  const [u] = await tx`select username, credits_balance from public.users where id = ${TEST_UUID}`;
  check('trigger creates profile on signup', Boolean(u), u ? `username=${u.username}` : 'row missing');
  check(
    'welcome credits granted',
    u?.credits_balance === 20,
    `balance=${u?.credits_balance} (expected 20)`,
  );

  /* 2 ─ consume_credit ------------------------------------------------- */
  const r1 = await tx`select * from public.consume_credit(${TEST_UUID}, null, null, ${today})`;
  const [after1] = await tx`select credits_balance from public.users where id = ${TEST_UUID}`;
  check('consume_credit succeeds', r1[0].ok === true, `reason=${r1[0].reason}`);
  check('balance debited by 1', after1.credits_balance === 19, `balance=${after1.credits_balance}`);

  const [ev] = await tx`select status, credits_cost from public.usage_events where id = ${r1[0].usage_event_id}`;
  check('usage event created as pending', ev?.status === 'pending' && ev?.credits_cost === 1);

  const [led] = await tx`
    select type, amount, balance_after from public.credit_transactions
    where usage_event_id = ${r1[0].usage_event_id}
  `;
  check('ledger row written', led?.type === 'deduct' && led?.amount === -1, `after=${led?.balance_after}`);

  const [{ used }] = await tx`select requests_used as used from public.rate_limits where user_id = ${TEST_UUID} and day = ${today}`;
  check('daily counter incremented', used === 1, `used=${used}`);

  /* 3 ─ refund --------------------------------------------------------- */
  const refunded = await tx`select public.refund_credit(${r1[0].usage_event_id}) as ok`;
  const [afterRefund] = await tx`select credits_balance from public.users where id = ${TEST_UUID}`;
  const [evAfter] = await tx`select status from public.usage_events where id = ${r1[0].usage_event_id}`;
  const [{ used: usedAfter }] = await tx`select requests_used as used from public.rate_limits where user_id = ${TEST_UUID} and day = ${today}`;
  check('refund_credit returns the credit', refunded[0].ok === true && afterRefund.credits_balance === 20);
  check('usage event flipped to refunded', evAfter.status === 'refunded');
  check('daily slot returned', usedAfter === 0, `used=${usedAfter}`);

  /* 4 ─ drain the balance, then assert the quota gate ------------------- */
  for (let i = 0; i < 20; i++) {
    await tx`select * from public.consume_credit(${TEST_UUID}, null, null, ${today})`;
  }
  const [drained] = await tx`select credits_balance from public.users where id = ${TEST_UUID}`;
  const [{ used: finalUsed }] = await tx`select requests_used as used from public.rate_limits where user_id = ${TEST_UUID} and day = ${today}`;

  check(
    'exactly 10 requests allowed (trial quota)',
    drained.credits_balance === 10 && finalUsed === 10,
    `balance=${drained.credits_balance}, used=${finalUsed}`,
  );

  const blocked = await tx`select * from public.consume_credit(${TEST_UUID}, null, null, ${today})`;
  check(
    '11th request blocked by daily_quota',
    blocked[0].ok === false && blocked[0].reason === 'daily_quota',
    `reason=${blocked[0].reason}`,
  );

  /* 5 ─ grant_order_credits is idempotent -------------------------------- */
  const [pkg] = await tx`select id, price_thb, credits from public.credit_packages where code = 'starter'`;
  const [order] = await tx`
    insert into public.orders (user_id, package_id, amount_thb, credits)
    values (${TEST_UUID}, ${pkg.id}, ${pkg.price_thb}, ${pkg.credits})
    returning id
  `;
  const g1 = await tx`select public.grant_order_credits(${order.id}) as ok`;
  const g2 = await tx`select public.grant_order_credits(${order.id}) as ok`;
  const [paidUser] = await tx`
    select credits_balance, total_paid_thb, total_granted, first_paid_at is not null as paid
    from public.users where id = ${TEST_UUID}
  `;

  check('first grant succeeds', g1[0].ok === true);
  check('second grant is a no-op', g2[0].ok === false);
  check(
    // 10 left from the drained trial balance + the 35-credit Starter pack. The
    // residue matters: a pack adds to the balance, it does not replace it.
    'credits added exactly once',
    paidUser.credits_balance === 45 && paidUser.total_granted === 35,
    `balance=${paidUser.credits_balance}, granted=${paidUser.total_granted}`,
  );
  check('total_paid_thb recorded', Number(paidUser.total_paid_thb) === 29, `paid=${paidUser.total_paid_thb}`);
  check('first_paid_at set (lifts the quota)', paidUser.paid === true);

  // Buying a pack must remove the daily cap entirely.
  const [afterBuy] = await tx`select public.daily_quota_for(${TEST_UUID}) as q`;
  check('quota unlimited after purchase', afterBuy.q === null, `quota=${afterBuy.q}`);

  // Throwing is the only way to make sql.begin() ROLLBACK instead of COMMIT.
  throw ROLLBACK;
  });
} catch (err) {
  if (err !== ROLLBACK) throw err;
}

await sql.end({ timeout: 5 });

const failed = results.filter((r) => !r.pass);
console.log(
  failed.length
    ? `\n${failed.length}/${results.length} checks FAILED (rolled back, nothing was written)`
    : `\nall ${results.length} checks passed (rolled back, nothing was written)`,
);
process.exit(failed.length ? 1 : 0);