ALTER TABLE "usage_events" ADD COLUMN "provider_id" uuid;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "remote_model_id" text;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "provider_name" text;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_events_remote_model_idx" ON "usage_events" USING btree ("remote_model_id");
--> statement-breakpoint
-- Phase 4 — record which model actually answered, and let a failed request
-- hand its credit back after the stream has started.

-- ── usage_events: which model answered, and why we fell over ───────────────
-- ── complete_usage: partial failures must be able to release the credit ───
CREATE OR REPLACE FUNCTION public.complete_usage(
  p_usage_event_id  uuid,
  p_input_tokens    integer,
  p_output_tokens   integer,
  p_cache_tokens    integer,
  p_latency_ms      integer,
  p_provider_cost   numeric,
  -- null keeps the credit charged; a message means the caller is giving up and
  -- the credit goes back to the user.
  p_error           text   DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_status  public.usage_status;
  v_balance integer;
v_cost    integer;
  v_tx_id   uuid;
  v_created timestamptz;
BEGIN
  SELECT user_id, status, created_at INTO v_user_id, v_status, v_created
    FROM public.usage_events
   WHERE id = p_usage_event_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Already settled (the happy path may have completed before an abort fired).
  IF v_status <> 'pending' THEN
    RETURN;
  END IF;

  UPDATE public.usage_events
     SET status         = CASE WHEN p_error IS NULL THEN 'success'::public.usage_status ELSE 'refunded'::public.usage_status END,
         input_tokens   = coalesce(p_input_tokens, 0),
         output_tokens  = coalesce(p_output_tokens, 0),
         cache_tokens   = coalesce(p_cache_tokens, 0),
         latency_ms     = coalesce(p_latency_ms, 0),
         provider_cost_usd = coalesce(p_provider_cost, 0),
         error          = p_error
   WHERE id = p_usage_event_id;

  IF p_error IS NULL THEN
    RETURN;
  END IF;

  -- Give the credit back. The ledger entry is written rather than editing the
  -- balance alone so the two stay reconcilable.
  SELECT credits_balance INTO v_balance
    FROM public.users
   WHERE id = v_user_id
     FOR UPDATE;

  v_cost := coalesce(
    (SELECT credits_cost FROM public.usage_events WHERE id = p_usage_event_id),
    1);

  UPDATE public.users
     SET credits_balance = credits_balance + v_cost
   WHERE id = v_user_id;

  INSERT INTO public.credit_transactions
    (user_id, type, amount, balance_after, usage_event_id, note)
  VALUES
    (v_user_id, 'refund', v_cost, v_balance + v_cost, p_usage_event_id, p_error);

-- A failed request does not count against the daily free-tier quota.
  -- Keyed off the event's own timestamp in UTC — the same clock the caller
  -- passes to consume_credit — so a refund that lands after midnight still
  -- undoes the counter it incremented, not today's.
  IF public.daily_quota_for(v_user_id) IS NOT NULL THEN
    UPDATE public.rate_limits
       SET requests_used = greatest(requests_used - 1, 0)
     WHERE user_id = v_user_id
       AND day = to_char(v_created AT TIME ZONE 'utc', 'YYYY-MM-DD');
  END IF;
END;
$$;

-- ── refund_credit must respect the status change above ─────────────────────
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
v_cost    integer;
  v_tx_id   uuid;
  v_created timestamptz;
BEGIN
  SELECT user_id, status, created_at INTO v_user_id, v_status, v_created
    FROM public.usage_events
   WHERE id = p_usage_event_id
     FOR UPDATE;

  IF NOT FOUND OR v_status <> 'pending' THEN
    RETURN false;
  END IF;

  SELECT credits_balance INTO v_balance
    FROM public.users
   WHERE id = v_user_id
     FOR UPDATE;

  v_cost := coalesce(
    (SELECT credits_cost FROM public.usage_events WHERE id = p_usage_event_id),
    1);

  UPDATE public.usage_events
     SET status = 'refunded'
   WHERE id = p_usage_event_id;

  UPDATE public.users
     SET credits_balance = credits_balance + v_cost
   WHERE id = v_user_id;

  INSERT INTO public.credit_transactions
    (user_id, type, amount, balance_after, usage_event_id, note)
  VALUES
    (v_user_id, 'refund', v_cost, v_balance + v_cost, p_usage_event_id, 'generation failed');

  -- Give the daily-quota slot back too, on the day the request was charged.
  IF public.daily_quota_for(v_user_id) IS NOT NULL THEN
    UPDATE public.rate_limits
       SET requests_used = greatest(requests_used - 1, 0)
     WHERE user_id = v_user_id
       AND day = to_char(v_created AT TIME ZONE 'utc', 'YYYY-MM-DD');
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_usage(uuid, integer, integer, integer, integer, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refund_credit(uuid) TO authenticated;