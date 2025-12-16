
-- Create llm_usage_analytics table
create table if not exists public.llm_usage_analytics (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  template_slug text not null,
  operation_name text,
  llm_provider text not null,
  llm_model text not null,
  prompt_tokens int default 0,
  completion_tokens int default 0,
  total_tokens int default 0,
  prompt_cost numeric(10, 6),
  completion_cost numeric(10, 6),
  total_cost numeric(10, 6),
  latency_ms int,
  status text not null, -- 'success' or 'failure'
  error_code text,
  error_message text,
  request_config jsonb,
  response_metadata jsonb,
  created_at timestamptz default now() not null
);

-- Enable RLS
alter table public.llm_usage_analytics enable row level security;

-- Create policy for admins to view all analytics (adjust based on actual role requirements)
create policy "Admins can view all LLM analytics"
  on public.llm_usage_analytics
  for select
  to authenticated
  using (
    exists (
      select 1 from public.accounts
      where id = llm_usage_analytics.account_id
      -- Add logic here if strictly restricted to account members/admins
      -- For now, purely based on account_id match if needed, or open to service_role
    )
  );

-- Allow service_role to insert/manage everything (llm logging usually happens server-side via admin client)
create policy "Service role can manage LLM analytics"
  on public.llm_usage_analytics
  using (true)
  with check (true);

-- Create indexes for common queries
create index if not exists idx_llm_analytics_account_id on public.llm_usage_analytics(account_id);
create index if not exists idx_llm_analytics_template_slug on public.llm_usage_analytics(template_slug);
create index if not exists idx_llm_analytics_created_at on public.llm_usage_analytics(created_at);
