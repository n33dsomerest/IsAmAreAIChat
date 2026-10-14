/**
 * The nightly credit refill.
 *
 *   npm run db:test-refill
 *
 * Runs inside one transaction that is always rolled back, so it creates users,
 * moves them through the trial window and spends their balances without leaving
 * anything behind.
 *
 * What it pins down, and why each one matters:
 *   1. an account inside its first 7 days is topped to 20
 *   2. an older account is topped to 10 — the same job, different window
 *   3. an account at or above its threshold is left completely alone
 *   4. a second run on the same day grants nothing (once per day, not per run)
 *   5. the next day grants again, and only then
 *   6. bought credits survive a nightly run — the refund only ever raises
 *   7. `SET`, not `+=`: a user below the threshold does not stack two grants
 *   8. every grant writes an `adjust` row, so the books still reconcile
 *  10. a day-old account already at its allowance is not topped up
 *  11. the cron endpoint is gated, and a re-run against real accounts grants nothing
 */
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set — copy .env.example to .env.local');
  process.exit(1);
}

const APP = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const sql = postgres(url, { max: 1, connect_timeout: 15, prepare: false });

const ROLLBACK = new Error('__force_rollback__');
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const TODAY = new Date().toISOString().slice(0, 10);
const TOMORROW = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

/**
 * A user whose `created_at` decides which refill window they are in.
 *
 * Inserted through `auth.users` rather than `public.users`: the latter's id has
 * a foreign key to the former, so a direct insert cannot stand on its own. The
 * signup trigger builds the `public.users` row, and the two fields the refill
 * actually reads — the balance and the age — are then set to the scenario.
 *
 * Every helper takes the client it runs on. The `postgres` client is opened
 * with `max: 1`, so a call on the outer client while `begin()` holds the
 * transaction queues behind it and the script hangs instead of failing.
 */
async function user(tx, id, ageDays, starting) {
  await tx`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      '00000000-0000-0000-0000-000000000000', ${id}::uuid,
      'authenticated', 'authenticated', ${`${id}@refill.test`}, '',
      now(), now(), now(), '{"provider":"email"}'::jsonb,
      ${tx.json({ username: 'refill-test' })}::jsonb
    )`;
  await tx`
    update public.users
       set credits_balance = ${starting},
           created_at = now() - make_interval(days => ${ageDays})
     where id = ${id}::uuid`;
  return { id };
}

const balance = (tx, id) => tx`
  select credits_balance, last_refill_day from public.users where id = ${id}::uuid`;

const ledger = (tx, id) => tx`
  select type, amount, balance_after from public.credit_transactions
   where user_id = ${id}::uuid and note = 'daily credit refill' order by id`;

const grant = (tx, day) => tx`select public.grant_daily_credits(${day}::text) as granted`;

/** Same call the cron makes: no argument, so the function stamps its own day. */
const grantToday = (tx) => tx`select public.grant_daily_credits() as granted`;

process.on('uncaughtException', async (err) => {
  console.error(err);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});

try {
  await sql.begin(async (tx) => {
    const newbie = await user(tx, '11111111-1111-4111-8111-111111111111', 2, 3);
    const veteran = await user(tx, '22222222-2222-4222-8222-222222222222', 40, 2);
    const rich = await user(tx, '33333333-3333-4333-8333-333333333333', 40, 500);
    const buyer = await user(tx, '44444444-4444-4444-8444-444444444444', 40, 15);

    /* 1 ─ the trial window ---------------------------------------------- */
    // The count also picks up real accounts sitting below their threshold, so
    // what is asserted is that every one of ours was reached, not the total.
    const first = await grantToday(tx);
    const [n] = await balance(tx, newbie.id);
    const [v] = await balance(tx, veteran.id);
    const [r] = await balance(tx, rich.id);
    check(
      'the job reaches every account below its threshold',
      n.credits_balance === 20 && v.credits_balance === 10 && r.credits_balance === 500,
      `granted=${first[0].granted}`,
    );

    check('an account inside 7 days is topped to 20', n.credits_balance === 20, `balance=${n.credits_balance}`);
    check('and is stamped with the day', n.last_refill_day === TODAY, String(n.last_refill_day));

    /* 2 ─ after the window ----------------------------------------------- */
    check('an account past 7 days is topped to 10', v.credits_balance === 10, `balance=${v.credits_balance}`);

    /* 3 ─ above the threshold is untouched ------------------------------- */
    check('an account above its threshold is left alone', r.credits_balance === 500, `balance=${r.credits_balance}`);
    check('and is not even stamped', r.last_refill_day === null, String(r.last_refill_day));

    /* 4 ─ one grant per day, not one per run ------------------------------ */
    const again = await grantToday(tx);
    check('a second run the same day grants nothing', again[0].granted === 0, `granted=${again[0].granted}`);

    const [stacked] = await balance(tx, newbie.id);
    check('the trial balance did not stack', stacked.credits_balance === 20, `balance=${stacked.credits_balance}`);

/* 5 ─ tomorrow grants again, to whoever has spent since ---------------- */
    // First the property that is easy to get wrong: the refill only ever
    // raises. An account sitting above its allowance keeps every credit it has,
    // which is what protects a purchased balance from being clawed back.
    await tx`update public.users set credits_balance = 16 where id = ${veteran.id}`;
    await grant(tx, TOMORROW);
    const [above] = await balance(tx, veteran.id);
    check('the refill never takes credits away', above.credits_balance === 16, `balance=${above.credits_balance}`);

    await tx`update public.users set credits_balance = 3 where id = ${veteran.id}`;
    await grant(tx, TOMORROW);
    const [v2] = await balance(tx, veteran.id);
    check('the next day brings a spent account back to its allowance', v2.credits_balance === 10, `balance=${v2.credits_balance}`);
    check('and stamps the new day', v2.last_refill_day === TOMORROW, String(v2.last_refill_day));

    // Still 500, still never granted: a balance above the allowance is not a
    // balance the job has an opinion about.
    check('the one with 500 is still untouched', (await balance(tx, rich.id))[0].credits_balance === 500);

    /* 6 ─ bought credits survive ------------------------------------------ */
    await tx`update public.users set credits_balance = 12 where id = ${buyer.id}`;
    await grant(tx, '2026-01-02');
    const [b] = await balance(tx, buyer.id);
    check('a balance above 10 keeps its purchased remainder', b.credits_balance === 12, `balance=${b.credits_balance}`);

    /* 7 ─ SET, not += ------------------------------------------------------ */
    await tx`update public.users set credits_balance = 4 where id = ${veteran.id}`;
    await grant(tx, '2026-01-03');
    const [d] = await balance(tx, veteran.id);
    check('a spent account is set to the threshold, not added to', d.credits_balance === 10, `balance=${d.credits_balance}`);

/* 8 ─ the ledger keeps up --------------------------------------------- */
    const rows = await ledger(tx, veteran.id);
    check(
      'each grant writes an adjust row carrying the delta',
      rows.length === 3 &&
        rows.every((x) => x.type === 'adjust' && x.balance_after === 10) &&
        // Compared as a set: `credit_transactions.id` is a random uuid, so the
        // table has no insertion order to read the sequence out of.
        rows.map((x) => x.amount).sort((a, b) => a - b).join(',') === '6,7,8',
      rows.map((x) => `${x.amount}→${x.balance_after}`).join(' '),
    );

    /* 9 ─ the day key is what stops a second grant ------------------------ */
    await tx`update public.users set credits_balance = 4 where id = ${veteran.id}`;
    await grant(tx, '2026-01-03');
    const [sameDay] = await balance(tx, veteran.id);
    check(
      're-running a day already granted leaves the account alone',
      sameDay.credits_balance === 4,
      `balance=${sameDay.credits_balance}`,
    );
    check('and writes no second ledger row', (await ledger(tx, veteran.id)).length === 3);

    /* 10 ─ a brand new account lands at the allowance, not above it -------- */
    const fresh = await user(tx, '55555555-5555-4555-8555-555555555555', 0, 20);
    await tx`update public.users set credits_balance = 20 where id = ${fresh.id}`;
    await grant(tx, '2026-01-04');
    const [f] = await balance(tx, fresh.id);
    check('a day-old account already at 20 is not granted anything', f.credits_balance === 20, `balance=${f.credits_balance}`);

    throw ROLLBACK;
  });
} catch (err) {
  if (err !== ROLLBACK) throw err;
}

/* ── the endpoint ─────────────────────────────────────────────────────── */
const anon = await fetch(`${APP}/api/cron/daily-refill`, { redirect: 'manual' });
check('the endpoint rejects an unauthenticated call', anon.status === 401, `status=${anon.status}`);

if (process.env.CRON_SECRET) {
  const auth = { authorization: `Bearer ${process.env.CRON_SECRET}` };
  const ok = await fetch(`${APP}/api/cron/daily-refill`, { headers: auth });
  const body = await ok.json().catch(() => ({}));
  check(
    'it accepts the cron secret and reports its count',
    ok.status === 200 && typeof body.granted === 'number',
    `status=${ok.status} granted=${body.granted}`,
  );

  // This run is real: it tops up whatever live accounts sit below their
  // allowance, which is the whole point of the job. Running it twice is how the
  // idempotency gets proven against the actual table rather than a fixture.
  const twice = await fetch(`${APP}/api/cron/daily-refill`, { headers: auth });
  const again = await twice.json().catch(() => ({}));
  check('an immediate re-run on real accounts grants nothing', again.granted === 0, `granted=${again.granted}`);
} else {
  check('CRON_SECRET is set so the endpoint could be exercised', false, 'not set in .env.local');
}

await sql.end({ timeout: 5 });

const failed = results.filter((r) => !r.pass);
console.log(
  failed.length
    ? `\n${failed.length}/${results.length} checks FAILED`
    : `\nall ${results.length} checks passed (the fixture rolled back; the two endpoint calls were real)`,
);
process.exit(failed.length ? 1 : 0);