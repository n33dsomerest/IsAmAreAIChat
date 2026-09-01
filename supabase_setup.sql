-- Run this SQL in your Supabase SQL Editor to clear the old table and create the new one

DROP TABLE IF EXISTS public.usage_logs;

CREATE TABLE public.usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL UNIQUE,
    ip_address TEXT,
    tokens_used BIGINT DEFAULT 0,
    requests_count INT DEFAULT 0,
    last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Note: We intentionally DO NOT enable RLS here so that your API key works without complex auth rules.
-- ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;
