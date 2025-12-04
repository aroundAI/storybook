-- LLM Usage Analytics Table
-- Tracks all LLM executions for cost monitoring and failure analysis

CREATE TABLE IF NOT EXISTS public.llm_usage_analytics (
  id uuid UNIQUE NOT NULL DEFAULT extensions.uuid_generate_v4(),
  account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  template_slug text NOT NULL,
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

-- RLS Policies

-- Users can view their own account's LLM usage
CREATE POLICY "Users can view own account LLM usage"
  ON public.llm_usage_analytics
  FOR SELECT
  TO authenticated
  USING (
    account_id IN (
      SELECT id FROM public.accounts WHERE primary_owner_user_id = auth.uid()
      UNION
      SELECT account_id FROM public.accounts_memberships WHERE user_id = auth.uid()
    )
  );

-- Super admins can view all LLM usage
CREATE POLICY "Super admins can view all LLM usage"
  ON public.llm_usage_analytics
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

-- Service role can insert (for analytics logging from server)
CREATE POLICY "Service role can insert LLM usage"
  ON public.llm_usage_analytics
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Grant permissions
GRANT SELECT ON public.llm_usage_analytics TO authenticated;
GRANT INSERT ON public.llm_usage_analytics TO service_role;
GRANT ALL ON public.llm_usage_analytics TO service_role;
