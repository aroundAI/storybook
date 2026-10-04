-- ==================================
-- A team's daily cap on LLM spend through the web app
-- ==================================
-- Owner decision 2026-10-03, recorded under FILM-1910 (team AI settings)
-- and FILM-1902 (the gateway): a team may cap what Gemini costs it a day
-- when StoryBook writes a stage itself (server mode). The cap never applies
-- to external runs (Claude over MCP makes no model call from StoryBook) nor
-- to ElevenLabs renders.
--
-- account_ai_settings.daily_llm_spend_cap_usd: null is no cap; a set cap is
-- above zero. Owners write it, members read it, under the table's existing
-- policies.
--
-- llm_spend_since(account, since): the gateway's read, before it opens a
-- server run. One aggregate, so PostgREST's 1000-row cap cannot truncate
-- it. SECURITY INVOKER and executable by the service role only: the gateway
-- reads with the same service-role client recordUsage writes with, after
-- reading the cap with the caller's own client under RLS, so no new read
-- surface is opened to signed-in users. Only rows of server-mode runs are
-- summed (every row written since FILM-1903 part C has one). A row with no
-- price is counted apart as unpriced, never as 0.
--
-- Tests: tests/database/daily-llm-spend-cap.test.sql.

alter table public.account_ai_settings
  add column daily_llm_spend_cap_usd numeric(12, 2)
    constraint account_ai_settings_daily_llm_spend_cap_positive
      check (daily_llm_spend_cap_usd is null or daily_llm_spend_cap_usd > 0);

comment on column public.account_ai_settings.daily_llm_spend_cap_usd is
  'USD a UTC day of server-mode (Gemini) LLM spend before openRun refuses a new server run; null is no cap. Never applies to external (MCP) runs or renders. Owner decision 2026-10-03';

create index if not exists idx_llm_usage_analytics_account_created
  on public.llm_usage_analytics (account_id, created_at);

create or replace function public.llm_spend_since(
  p_account_id uuid,
  p_since timestamptz
)
returns table (spent_usd numeric, priced_calls integer, unpriced_calls integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    sum(u.total_cost),
    count(u.total_cost)::integer,
    (count(*) - count(u.total_cost))::integer
  from public.llm_usage_analytics u
  join public.generation_runs r on r.id = u.run_id and r.mode = 'server'
  where u.account_id = p_account_id
    and u.created_at >= p_since;
$$;

comment on function public.llm_spend_since(uuid, timestamptz) is
  'Server-mode LLM spend for an account since a time: priced USD sum (null when none is priced), priced and unpriced call counts. Service role only; read by the gateway for the daily spend cap (2026-10-03)';

revoke all on function public.llm_spend_since(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.llm_spend_since(uuid, timestamptz) to service_role;
