-- ==================================
-- MCP connector monitoring (FILM-1911)
-- ==================================
-- The panels the EDD's "Observability" section asks for, read by the super
-- admin's MCP page (apps/web/app/admin/mcp), and the check behind the alert
-- that an external run recorded a model call.
--
-- Panels: SECURITY DEFINER, because mcp_tool_calls is readable only by a
-- team's owners and generation_runs only by its members, and a super admin
-- reads across teams. Each refuses anyone but public.is_super_admin(), which
-- itself requires an aal2 session. They return aggregates only: no account,
-- user, connection or run id leaves them.
--
-- Guard check: plain invoker, service role only, like
-- expire_generation_runs(). The cron route api/cron/external-run-model-calls
-- calls it hourly.
--
-- Tests: tests/database/mcp-monitoring.test.sql; the four panel functions are
-- pinned in definer-functions-inventory.test.sql.

-- p_days is the window, ending now: 1 to 90 days.
create or replace function public.admin_mcp_check_window(p_days integer)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'refused: MCP monitoring is for super admins'
      using errcode = 'insufficient_privilege';
  end if;

  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'the window must be 1 to 90 days, not %', p_days
      using errcode = 'invalid_parameter_value';
  end if;

  return now() - make_interval(days => p_days);
end;
$$;

revoke all on function public.admin_mcp_check_window(integer) from public, anon, authenticated;

-- Calls per tool, errors per tool and p95 duration per tool.
create or replace function public.admin_mcp_tool_stats(p_days integer default 7)
returns table (tool text, calls bigint, errors bigint, p95_ms double precision)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz := public.admin_mcp_check_window(p_days);
begin
  return query
  select c.tool,
         count(*),
         count(*) filter (where c.status = 'error'),
         percentile_cont(0.95) within group (order by c.duration_ms)
  from public.mcp_tool_calls c
  where c.created_at >= v_since
  group by c.tool
  order by 2 desc, 1;
end;
$$;

-- Error rate by code: each code's calls over every call in the window.
-- No calls means no rows, not a 0% rate.
create or replace function public.admin_mcp_error_codes(p_days integer default 7)
returns table (error_code text, calls bigint, total_calls bigint, rate double precision)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz := public.admin_mcp_check_window(p_days);
begin
  return query
  with windowed as (
    select c.error_code
    from public.mcp_tool_calls c
    where c.created_at >= v_since
  ),
  total as (select count(*) as n from windowed)
  select w.error_code,
         count(*),
         t.n,
         count(*)::double precision / t.n
  from windowed w
  cross join total t
  where w.error_code is not null
  group by w.error_code, t.n
  order by 2 desc, 1;
end;
$$;

-- Generation runs opened in the window, by mode and status.
create or replace function public.admin_generation_run_stats(p_days integer default 7)
returns table (mode text, status text, runs bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz := public.admin_mcp_check_window(p_days);
begin
  return query
  select r.mode, r.status, count(*)
  from public.generation_runs r
  where r.created_at >= v_since
  group by r.mode, r.status
  order by 1, 2;
end;
$$;

-- Runs whose lease expired, per UTC day, every day of the window present
-- (a day with none is a measured 0: expire_generation_runs() stamps every
-- expiry it makes).
create or replace function public.admin_expired_leases_per_day(p_days integer default 7)
returns table (day date, expired bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz := public.admin_mcp_check_window(p_days);
begin
  return query
  select d::date,
         (select count(*)
          from public.generation_runs r
          where r.status = 'expired'
            and (r.finalized_at at time zone 'utc')::date = d::date)
  from generate_series(
    (v_since at time zone 'utc')::date,
    (now() at time zone 'utc')::date,
    interval '1 day'
  ) d
  order by 1;
end;
$$;

revoke all on function public.admin_mcp_tool_stats(integer) from public, anon;
revoke all on function public.admin_mcp_error_codes(integer) from public, anon;
revoke all on function public.admin_generation_run_stats(integer) from public, anon;
revoke all on function public.admin_expired_leases_per_day(integer) from public, anon;
grant execute on function public.admin_mcp_tool_stats(integer) to authenticated;
grant execute on function public.admin_mcp_error_codes(integer) to authenticated;
grant execute on function public.admin_generation_run_stats(integer) to authenticated;
grant execute on function public.admin_expired_leases_per_day(integer) to authenticated;

-- ----------------------------------------------------------------------
-- The guard-failure check
-- ----------------------------------------------------------------------
-- A model-usage row whose run is external means Gemini ran for work an MCP
-- client owns. llm_usage_analytics_server_run_only (FILM-1903) refuses that
-- insert, so this should always be empty; the alert proves it stays so.
-- Ids and times only, never the prompt or the response.
create or replace function public.external_run_model_calls(p_limit integer default 20)
returns table (usage_id uuid, run_id uuid, account_id uuid, created_at timestamptz, total bigint)
language sql
stable
set search_path = ''
as $$
  select u.id, u.run_id, r.account_id, u.created_at, count(*) over ()
  from public.llm_usage_analytics u
  join public.generation_runs r on r.id = u.run_id
  where r.mode = 'external'
  order by u.created_at desc
  limit greatest(p_limit, 1);
$$;

revoke all on function public.external_run_model_calls(integer) from public, anon, authenticated;
grant execute on function public.external_run_model_calls(integer) to service_role;
