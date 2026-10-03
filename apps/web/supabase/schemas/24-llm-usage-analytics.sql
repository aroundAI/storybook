-- LLM Usage Analytics Table
-- Tracks all LLM executions for cost monitoring and failure analysis

CREATE TABLE IF NOT EXISTS public.llm_usage_analytics (
  id uuid UNIQUE NOT NULL DEFAULT extensions.uuid_generate_v4(),
  account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  template_slug text,
  operation_name text NOT NULL,
  llm_provider text NOT NULL,
  llm_model text NOT NULL,
  prompt_tokens integer NOT NULL,
  completion_tokens integer NOT NULL,
  total_tokens integer NOT NULL,
  prompt_cost numeric(10, 6),
  completion_cost numeric(10, 6),
  total_cost numeric(10, 6),
  latency_ms integer NOT NULL,
  status text NOT NULL CHECK (status IN ('success', 'failure')),
  error_code text,
  error_message text,
  request_config jsonb,
  response_metadata jsonb,
  executed_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  -- FILM-1903: the run this model call was made for (75-generation-runs.sql guards it); required on insert since part C (null only on older rows)
  run_id uuid REFERENCES public.generation_runs(id) ON DELETE SET NULL,
  PRIMARY KEY (id)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_llm_usage_analytics_account_id
  ON public.llm_usage_analytics(account_id);

CREATE INDEX IF NOT EXISTS idx_llm_usage_analytics_executed_at
  ON public.llm_usage_analytics(executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_llm_usage_analytics_template_slug
  ON public.llm_usage_analytics(template_slug);

CREATE INDEX IF NOT EXISTS idx_llm_usage_analytics_status
  ON public.llm_usage_analytics(status);

CREATE INDEX IF NOT EXISTS idx_llm_usage_analytics_account_executed
  ON public.llm_usage_analytics(account_id, executed_at DESC);

-- Enable RLS
ALTER TABLE public.llm_usage_analytics ENABLE ROW LEVEL SECURITY;

-- RLS Policies (KB-52; migration 20260923041957_kb52-llm-usage-analytics-rls.sql)
--
-- Reads on account access: owner or member. A personal account's owner has no
-- membership row, which is why this is has_account_access and not
-- has_role_on_account. No super-admin policy: no screen reads this table.
CREATE POLICY llm_usage_analytics_read
  ON public.llm_usage_analytics
  FOR SELECT
  TO authenticated
  USING (public.has_account_access(account_id));

-- Writes by the service role only. It bypasses RLS, so it needs no policy;
-- a "service role" policy written without TO applies to every role, which
-- is how KB-52 happened. anon and authenticated hold no write privilege.
REVOKE ALL ON public.llm_usage_analytics FROM anon, authenticated;
GRANT SELECT ON public.llm_usage_analytics TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.llm_usage_analytics TO service_role;
