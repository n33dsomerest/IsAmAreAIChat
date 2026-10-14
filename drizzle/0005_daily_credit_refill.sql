ALTER TABLE "users" ADD COLUMN "last_refill_day" text;--> statement-breakpoint
CREATE INDEX "users_last_refill_day_idx" ON "users" USING btree ("last_refill_day");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
--  Daily credit refill
--
--  Top every account back up to its daily allowance, once a day, and only when
--  it sits below that allowance.
--
--  Why `SET` and not `+=`. The grant is an allowance, not a reward: a user on 8
--  with a 10 allowance is put on 10, not on 18. Nothing accumulates, which is
--  also what makes the whole thing safe to run more than once — a second pass
--  finds every balance already at or above its threshold and does nothing. The
--  `< threshold` guard is the same property seen from the other side: the
--  function only ever raises a balance, so credits bought through an order are
--  never destroyed by a nightly run.
--
--  Why `last_refill_day` and not "just run once a day". The cron fires on a
--  24h spacing, but a retried or hand-triggered run inside the same day would
--  otherwise find a user who dipped below the threshold that morning and top
--  them up a second time. The column records which UTC date an account was last
--  seen by this job, so the daily grant is once per calendar day regardless of
--  how often the job runs.
--
--  The day key is UTC because that is the clock the rest of the credit system
--  already runs on — `rate_limits.day`, `consume_credit`, and the `day()` helper
--  in the chat route all slice `toISOString()`. The job itself is scheduled at
--  17:00 UTC, which is midnight in Bangkok; on that 24h spacing the UTC key
--  still yields exactly one refill per Bangkok day, so the label lags the local
--  date by seven hours without ever colliding or skipping one.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.grant_daily_credits(
  p_day text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD')
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r        record;
  v_trial  integer;
  v_days   integer;
  v_after  integer;
  v_grants integer := 0;
BEGIN
  -- Read once. The values are used twice per row (select list and predicate),
  -- and re-reading a jsonb setting per row turns a nightly job into a scan.
  SELECT coalesce((value ->> 'daily_refill_credits')::integer, 20),
         coalesce((value ->> 'daily_refill_days')::integer, 7),
         coalesce((value ->> 'daily_refill_credits_after')::integer, 10)
    INTO v_trial, v_days, v_after
    FROM public.app_settings
   WHERE key = 'free_tier';

  v_trial := coalesce(v_trial, 20);
  v_days  := coalesce(v_days, 7);
  v_after := coalesce(v_after, 10);

  FOR r IN
    SELECT u.id,
           u.credits_balance,
           CASE WHEN u.created_at >= now() - make_interval(days => v_days)
                THEN v_trial ELSE v_after END AS target
      FROM public.users u
     WHERE u.last_refill_day IS DISTINCT FROM p_day
       AND u.credits_balance <
           CASE WHEN u.created_at >= now() - make_interval(days => v_days)
                THEN v_trial ELSE v_after END
     ORDER BY u.id
       FOR UPDATE
  LOOP
    UPDATE public.users
       SET credits_balance = r.target,
           last_refill_day = p_day
     WHERE id = r.id;

    -- The ledger keeps `SET` auditable: a row saying "+2, now 10" is the only
    -- way to tell a nightly top-up from a manual adjustment after the fact.
    INSERT INTO public.credit_transactions
      (user_id, type, amount, balance_after, note)
    VALUES
      (r.id, 'adjust', r.target - r.credits_balance, r.target, 'daily credit refill');

    v_grants := v_grants + 1;
  END LOOP;

  RETURN v_grants;
END;
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.grant_daily_credits(text) TO authenticated, service_role;--> statement-breakpoint

-- The welcome bonus and the daily allowance have to agree, or a user who signs
-- up sees fewer credits than the same user would have at midnight tonight.
-- Existing rows are merged key by key rather than replaced: `trial_days`,
-- `daily_quota` and friends were edited after the seed shipped, and this
-- migration is not the place to undo that.
UPDATE public.app_settings
   SET value = value
             || jsonb_build_object(
                  'amount', 20,
                  'daily_refill_credits', 20,
                  'daily_refill_days', 7,
                  'daily_refill_credits_after', 10)
 WHERE key = 'free_tier';
--> statement-breakpoint

-- The trigger's hard fallback only matters when the settings row is missing
-- entirely, which is the one case where the two paths would otherwise disagree.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_free_amount integer;
  v_desired     text;
  v_username    text;
  v_admin_list  text[];
  v_is_admin    boolean;
  i             integer;
BEGIN
  SELECT (value ->> 'amount')::integer
    INTO v_free_amount
    FROM public.app_settings
   WHERE key = 'free_tier';
  -- Matches `daily_refill_credits`: a brand-new account is inside its own trial
  -- window, so the allowance it is topped up to tonight is what it starts with.
  v_free_amount := coalesce(
    v_free_amount,
    (SELECT (value ->> 'daily_refill_credits')::integer
       FROM public.app_settings WHERE key = 'free_tier'),
    20);

  -- `value #>> '{}'` would yield the *text* '["admin"]', not the element
  -- 'admin' — the array has to be expanded element by element.
  SELECT array_agg(elem #>> '{}')
    INTO v_admin_list
    FROM public.app_settings,
         LATERAL jsonb_array_elements(value) AS elem
   WHERE key = 'admin_usernames';

  -- Preferred username: explicitly supplied, else the email local part (Google).
  v_desired := coalesce(
    nullif(new.raw_user_meta_data ->> 'username', ''),
    split_part(coalesce(new.email, ''), '@', 1),
    'user'
  );

  -- Strip anything outside the allowed alphabet, keep it lowercase and short.
  v_desired := lower(regexp_replace(v_desired, '[^a-zA-Z0-9_]', '', 'g'));
  v_desired := left(v_desired, 28);
  IF v_desired !~ '^[a-z]' THEN
    v_desired := 'u' || v_desired;
  END IF;
  IF v_desired = '' THEN
    v_desired := 'user';
  END IF;

  v_username := v_desired;
  IF EXISTS (SELECT 1 FROM public.users WHERE lower(username) = v_username) THEN
    FOR i IN 1..20 LOOP
      v_username := left(v_desired, 27) || substr(md5(random()::text), 1, 4);
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.users WHERE lower(username) = v_username
      );
    END LOOP;
  END IF;

  v_is_admin := v_username = ANY (coalesce(v_admin_list, ARRAY[]::text[]));

  INSERT INTO public.users (id, username, email, display_name, role)
  VALUES (
    new.id,
    v_username,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', v_username),
    CASE WHEN v_is_admin THEN 'admin'::public.user_role ELSE 'user'::public.user_role END
  );

  IF v_free_amount > 0 THEN
    INSERT INTO public.credit_transactions (user_id, type, amount, balance_after, note)
    VALUES (new.id, 'bonus', v_free_amount, v_free_amount, 'welcome bonus');

    UPDATE public.users SET credits_balance = v_free_amount WHERE id = new.id;
  END IF;

  RETURN new;
END;
$$;