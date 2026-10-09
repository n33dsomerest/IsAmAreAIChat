-- ============================================================================
--  Custom SQL: auth glue, Row Level Security, and the atomic credit engine.
--  Everything here is deliberately in SQL rather than application code because
--  it has to be race-proof â€” two concurrent chat requests must never both see
--  the last credit as available.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  1. Link our profile table to Supabase auth
-- ---------------------------------------------------------------------------

ALTER TABLE public.users
  ADD CONSTRAINT users_id_auth_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Self-referencing branch pointer and the ledger â†’ usage back-reference.
ALTER TABLE public.messages
  ADD CONSTRAINT messages_parent_fkey
  FOREIGN KEY (parent_id) REFERENCES public.messages(id) ON DELETE SET NULL;

ALTER TABLE public.credit_transactions
  ADD CONSTRAINT credit_transactions_usage_event_fkey
  FOREIGN KEY (usage_event_id) REFERENCES public.usage_events(id) ON DELETE SET NULL;

-- Package codes are referenced by seed scripts and admin tooling.
CREATE UNIQUE INDEX IF NOT EXISTS credit_packages_code_key
  ON public.credit_packages (code);

-- `lower(username)` uniqueness must be enforced by a plain index too, so the
-- expression form above stays index-backed for lookups.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_key
  ON public.users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key
  ON public.users (lower(email));

-- ---------------------------------------------------------------------------
--  2. Profile bootstrap trigger
-- ---------------------------------------------------------------------------

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
  v_free_amount := coalesce(v_free_amount, 10);

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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Empty list by default; the owner fills it in (or runs
-- `npm run admin:promote`) before the first signup.
INSERT INTO public.app_settings (key, value)
VALUES ('admin_usernames', '[]'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
--  3. Helpers
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER so it can read `users` while RLS is being evaluated.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Daily request cap: unlimited once the user has ever paid.
CREATE OR REPLACE FUNCTION public.daily_quota_for(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN first_paid_at IS NOT NULL THEN NULL
    WHEN created_at >= now() - (coalesce(
           (SELECT (value ->> 'trial_days')::integer
              FROM public.app_settings WHERE key = 'free_tier'), 3
         ) || ' days')::interval
      THEN coalesce(
             (SELECT (value ->> 'daily_quota')::integer
                FROM public.app_settings WHERE key = 'free_tier'), 10)
    ELSE coalesce(
           (SELECT (value ->> 'daily_quota_after_trial')::integer
              FROM public.app_settings WHERE key = 'free_tier'), 5)
  END
  FROM public.users
  WHERE id = p_user_id;
$$;

-- ---------------------------------------------------------------------------
--  4. The credit engine
-- ---------------------------------------------------------------------------

CREATE TYPE public.credit_result AS (
  ok              boolean,
  reason          text,
  balance         integer,
  usage_event_id  uuid
);

-- Take `FOR UPDATE` on the user row first so concurrent requests serialise.
CREATE OR REPLACE FUNCTION public.consume_credit(
  p_user_id        uuid,
  p_conversation_id uuid,
  p_model_id       uuid,
  p_day            text
)
RETURNS public.credit_result
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_balance    integer;
  v_status     public.user_status;
  v_first_paid timestamptz;
  v_quota      integer;
  v_used       integer;
  v_event_id   uuid;
  v_tx_id      uuid;
BEGIN
  SELECT credits_balance, status, first_paid_at
    INTO v_balance, v_status, v_first_paid
    FROM public.users
   WHERE id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN (false, 'user_not_found'::text, 0::integer, NULL::uuid);
  END IF;

  IF v_status = 'banned' THEN
    RETURN (false, 'banned'::text, v_balance::integer, NULL::uuid);
  END IF;

  v_quota := public.daily_quota_for(p_user_id);
  IF v_quota IS NOT NULL THEN
    SELECT requests_used INTO v_used
      FROM public.rate_limits
     WHERE user_id = p_user_id AND day = p_day
     FOR UPDATE;
    v_used := coalesce(v_used, 0);

    IF v_used >= v_quota THEN
      RETURN (false, 'daily_quota'::text, v_balance::integer, NULL::uuid);
    END IF;
  END IF;

  IF v_balance < 1 THEN
    RETURN (false, 'no_credits'::text, v_balance::integer, NULL::uuid);
  END IF;

  UPDATE public.users
     SET credits_balance = credits_balance - 1
   WHERE id = p_user_id;

  INSERT INTO public.usage_events
    (user_id, conversation_id, model_id, credits_cost, status)
  VALUES
    (p_user_id, p_conversation_id, p_model_id, 1, 'pending')
  RETURNING id INTO v_event_id;

  INSERT INTO public.credit_transactions
    (user_id, type, amount, balance_after, usage_event_id, note)
  VALUES
    (p_user_id, 'deduct', -1, v_balance - 1, v_event_id, 'chat request')
  RETURNING id INTO v_tx_id;

  IF v_quota IS NOT NULL THEN
    INSERT INTO public.rate_limits (user_id, day, requests_used)
    VALUES (p_user_id, p_day, 1)
    ON CONFLICT (user_id, day)
      DO UPDATE SET requests_used = public.rate_limits.requests_used + 1;
  END IF;

  RETURN (true, NULL::text, v_balance - 1, v_event_id);
END;
$$;

-- Called when generation fails before the first token: hand the credit back.
CREATE OR REPLACE FUNCTION public.refund_credit(p_usage_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_status  public.usage_status;
  v_balance integer;
BEGIN
  SELECT user_id, status INTO v_user_id, v_status
    FROM public.usage_events
   WHERE id = p_usage_event_id
     FOR UPDATE;

  IF NOT FOUND OR v_status <> 'pending' THEN
    RETURN false;
  END IF;

  UPDATE public.usage_events
     SET status = 'refunded'
   WHERE id = p_usage_event_id;

  UPDATE public.users
     SET credits_balance = credits_balance + 1
   WHERE id = v_user_id
  RETURNING credits_balance INTO v_balance;

  INSERT INTO public.credit_transactions (user_id, type, amount, balance_after, usage_event_id, note)
  VALUES (v_user_id, 'refund', 1, v_balance, p_usage_event_id, 'generation failed');

  -- Give the daily-quota slot back too.
  UPDATE public.rate_limits
     SET requests_used = greatest(requests_used - 1, 0)
   WHERE user_id = v_user_id
     AND day = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD');

  RETURN true;
END;
$$;

-- Finalise a successful request: record tokens, latency and real provider cost.
CREATE OR REPLACE FUNCTION public.complete_usage(
  p_usage_event_id  uuid,
  p_input_tokens    integer,
  p_output_tokens   integer,
  p_cache_tokens    integer,
  p_latency_ms      integer,
  p_provider_cost   numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.usage_events
     SET status        = 'success',
         input_tokens  = coalesce(p_input_tokens, 0),
         output_tokens = coalesce(p_output_tokens, 0),
         cache_tokens  = coalesce(p_cache_tokens, 0),
         latency_ms    = p_latency_ms,
         provider_cost_usd = coalesce(p_provider_cost, 0)
   WHERE id = p_usage_event_id
     AND status = 'pending';
END;
$$;

-- Grant credits after a verified payment. Idempotent: calling it twice for the
-- same order is a no-op, which protects against webhook/retry double-crediting.
CREATE OR REPLACE FUNCTION public.grant_order_credits(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id   uuid;
  v_status    public.order_status;
  v_credits   integer;
  v_amount    integer;
  v_balance   integer;
BEGIN
  SELECT user_id, status, credits, amount_thb
    INTO v_user_id, v_status, v_credits, v_amount
    FROM public.orders
   WHERE id = p_order_id
     FOR UPDATE;

  IF NOT FOUND OR v_status = 'paid' THEN
    RETURN false;
  END IF;

  UPDATE public.orders
     SET status = 'paid', paid_at = now()
   WHERE id = p_order_id;

  UPDATE public.users
     SET credits_balance  = credits_balance + v_credits,
         total_granted    = total_granted + v_credits,
         total_paid_thb   = total_paid_thb + v_amount,
         first_paid_at    = coalesce(first_paid_at, now())
   WHERE id = v_user_id
  RETURNING credits_balance INTO v_balance;

  INSERT INTO public.credit_transactions (user_id, type, amount, balance_after, order_id, note)
  VALUES (v_user_id, 'topup', v_credits, v_balance, p_order_id, 'purchase');

  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
--  5. Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE public.users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artifacts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_presets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_definitions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_servers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_invocations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.providers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_models     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_packages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log           ENABLE ROW LEVEL SECURITY;

-- users: read self (or any user for admins). Write is column-restricted below.
CREATE POLICY users_select ON public.users
  FOR SELECT USING (id = auth.uid() OR public.is_admin());

CREATE POLICY users_update ON public.users
  FOR UPDATE USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (id = auth.uid() OR public.is_admin());

-- Belt-and-braces: RLS cannot restrict *which columns* an UPDATE touches, so
-- a user could otherwise rewrite their own balance or promote themselves.
CREATE OR REPLACE FUNCTION public.block_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND (OLD.role IS DISTINCT FROM NEW.role
       OR OLD.credits_balance IS DISTINCT FROM NEW.credits_balance
       OR OLD.total_paid_thb IS DISTINCT FROM NEW.total_paid_thb
       OR OLD.total_granted IS DISTINCT FROM NEW.total_granted
       OR OLD.first_paid_at IS DISTINCT FROM NEW.first_paid_at
       OR OLD.status IS DISTINCT FROM NEW.status
       OR OLD.email IS DISTINCT FROM NEW.email)
  THEN
    RAISE EXCEPTION 'protected column update rejected' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_protect_columns
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.block_privilege_escalation();

-- Direct writes to the money tables are denied; only SECURITY DEFINER
-- functions above may touch them from the browser's point of view.
CREATE POLICY conversations_all ON public.conversations
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY messages_all ON public.messages
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.conversations c
             WHERE c.id = messages.conversation_id AND c.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.conversations c
             WHERE c.id = messages.conversation_id AND c.user_id = auth.uid())
  );

CREATE POLICY attachments_all ON public.attachments
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.conversations c
             WHERE c.id = attachments.conversation_id AND c.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.conversations c
             WHERE c.id = attachments.conversation_id AND c.user_id = auth.uid())
  );

CREATE POLICY artifacts_all ON public.artifacts
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.messages m
      JOIN public.conversations c ON c.id = m.conversation_id
      WHERE m.id = artifacts.message_id AND c.user_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.messages m
      JOIN public.conversations c ON c.id = m.conversation_id
      WHERE m.id = artifacts.message_id AND c.user_id = auth.uid()
    )
  );

CREATE POLICY prompt_presets_all ON public.prompt_presets
  FOR ALL USING (user_id = auth.uid() OR is_global)
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

-- Read-only catalogue + tooling config for any signed-in user.
CREATE POLICY providers_read ON public.providers
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY provider_models_read ON public.provider_models
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY credit_packages_read ON public.credit_packages
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY app_settings_read ON public.app_settings
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY tool_definitions_read ON public.tool_definitions
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY mcp_servers_read ON public.mcp_servers
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY tool_invocations_read ON public.tool_invocations
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.messages m
             JOIN public.conversations c ON c.id = m.conversation_id
             WHERE m.id = tool_invocations.message_id AND c.user_id = auth.uid())
  );

-- Ledger tables: a user may read their own rows but never write them.
CREATE POLICY orders_select ON public.orders
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY credit_transactions_select ON public.credit_transactions
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY usage_events_select ON public.usage_events
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY audit_log_read ON public.audit_log
  FOR SELECT USING (public.is_admin());

-- rate_limits stays server-only: no policy at all means deny-by-default.

-- ---------------------------------------------------------------------------
--  6. Grants
--
--  Supabase normally seeds these via ALTER DEFAULT PRIVILEGES when the schema
--  is created. Recreating the schema by hand (or restoring a dump elsewhere)
--  silently drops them, and the symptom is confusing: auth still works, the
--  app still returns 200, but every PostgREST read fails with
--  `permission denied for table users`, so server components quietly fall back
--  to "signed out".
--
--  Access is safe without RLS because RLS is enabled on every table above;
--  `rate_limits` deliberately has no policy, so it stays deny-by-default.
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO postgres, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON ROUTINES TO postgres, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
--  7. Seed data
-- ---------------------------------------------------------------------------

INSERT INTO public.app_settings (key, value) VALUES
  ('free_tier', '{"amount":10,"trial_days":3,"daily_quota":10,"daily_quota_after_trial":5}'::jsonb),
  ('signup_open', '{"enabled":true}'::jsonb),
  ('site', '{"name":"AIChat","tagline_th":"à¹à¸Šà¸— AI à¸«à¸¥à¸²à¸¢à¹‚à¸¡à¹€à¸”à¸¥à¹ƒà¸™à¸—à¸µà¹ˆà¹€à¸”à¸µà¸¢à¸§","tagline_en":"One chat, every frontier model."}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO public.credit_packages (code, name, name_th, price_thb, credits, qr_path, sort_order)
VALUES
  ('starter',  'Starter',  'Starter',  29, 35,  '/qr/29Baht.png', 1),
  ('standard', 'Standard', 'Standard', 59, 85,  '/qr/59Baht.png', 2),
  ('pro',      'Pro',      'Pro',      99, 145, '/qr/99Baht.png', 3)
ON CONFLICT DO NOTHING;
