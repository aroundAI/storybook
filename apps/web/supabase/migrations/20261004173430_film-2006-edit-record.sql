-- ==================================
-- The Edit record page and the Studio delivery panel (FILM-2006)
-- ==================================
-- Two read-only SECURITY DEFINER functions; no table changes.
--
-- edit_session_device: the device an edit session runs on, for the Edit
-- record page's "open session" line. mcp_connections is readable only by
-- the connection's own user (mcp_connections_read), so a project admin
-- looking at a teammate's session could not see the device name. This
-- returns that one column, and only to a caller with a role on the
-- session's project (the same check as edit_sessions_read): no other
-- connection field, and nothing for anyone else.
--
-- admin_studio_delivery_stats: the super admin's MCP page counter panel
-- for StorybookStudio (FILM-1911's pattern): get_edit_package and
-- deliver_edit calls and TARGET_CHANGED refusals from mcp_tool_calls, and
-- renders left uploading for more than 24 hours, both still uploading and
-- already failed by FILM-2003's hourly sweep. Refuses anyone but
-- public.is_super_admin() through admin_mcp_check_window; counts only.
--
-- Tests: tests/database/edit-record.test.sql; both are pinned in
-- definer-functions-inventory.test.sql.

create or replace function public.edit_session_device(p_session_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select c.name
  from public.edit_sessions s
  join public.episodes e on e.id = s.episode_id
  join public.mcp_connections c on c.id = s.connection_id
  where s.id = p_session_id
    and public.has_role_on_project(e.project_id)
$$;

revoke all on function public.edit_session_device(uuid) from public, anon;
grant execute on function public.edit_session_device(uuid) to authenticated;

-- p_days is the window, ending now: 1 to 90 days (admin_mcp_check_window).
-- expired_uploads counts renders the sweep failed whose 24 hours ran out
-- inside the window, i.e. created no earlier than 24 hours before it.
create or replace function public.admin_studio_delivery_stats(p_days integer default 7)
returns table (
  get_edit_package_calls bigint,
  deliver_edit_calls bigint,
  target_changed_refusals bigint,
  uploading_over_24h bigint,
  expired_uploads bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz := public.admin_mcp_check_window(p_days);
begin
  return query
  select
    (select count(*) from public.mcp_tool_calls c
      where c.created_at >= v_since and c.tool = 'get_edit_package'),
    (select count(*) from public.mcp_tool_calls c
      where c.created_at >= v_since and c.tool = 'deliver_edit'),
    (select count(*) from public.mcp_tool_calls c
      where c.created_at >= v_since and c.error_code = 'TARGET_CHANGED'),
    (select count(*) from public.episode_renders r
      where r.status = 'uploading' and r.created_at < now() - interval '24 hours'),
    (select count(*) from public.episode_renders r
      where r.status = 'failed'
        and r.failure_reason = 'The upload was not finalized within 24 hours'
        and r.created_at >= v_since - interval '24 hours');
end;
$$;

revoke all on function public.admin_studio_delivery_stats(integer) from public, anon;
grant execute on function public.admin_studio_delivery_stats(integer) to authenticated;
