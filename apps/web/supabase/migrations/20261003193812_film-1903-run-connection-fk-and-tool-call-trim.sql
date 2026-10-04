-- FILM-1903 / FILM-1904 leftovers: a run references the connection it was
-- opened from, and the hourly cron trims old tool-call logs.
--
-- generation_runs.connection_id was created before mcp_connections existed
-- (the two specs were built in parallel), so it carried no foreign key.
-- ON DELETE SET NULL, as mcp_tool_calls.connection_id does: revoking is an
-- update, so deleting a connection is rare, and the run's history (who
-- opened it is still in created_by and origin) must outlive it. The CHECK
-- mcp_runs_are_external accepts a null connection_id for any mode.
--
-- A run whose connection row is already gone would make the constraint
-- fail to add. Nothing deletes a connection except its account or user
-- cascading (which deletes the run too), so none is expected; the update
-- below nulls any such id first, which is exactly what the new ON DELETE
-- would have done, so the migration cannot fail on old data and does not
-- need NOT VALID.
--
-- The 90-day trim is a plain SQL function (invoker, service role only: the
-- service role bypasses RLS) that deletes at most p_batch rows per call, so
-- the cron route loops in bounded statements rather than holding one long
-- delete. mcp_tool_calls was indexed by (account_id, created_at) and
-- (connection_id, created_at); neither serves "older than a cutoff", so a
-- created_at index is added.
--
-- Tests: tests/database/mcp-run-connection-and-trim.test.sql.

update public.generation_runs r
set connection_id = null
where r.connection_id is not null
  and not exists (
    select 1 from public.mcp_connections c where c.id = r.connection_id
  );

alter table public.generation_runs
  add constraint generation_runs_connection_id_fkey
  foreign key (connection_id) references public.mcp_connections(id)
  on delete set null;

comment on column public.generation_runs.connection_id is
  'The mcp_connections row the run was opened from (FILM-1904); null once that connection is deleted';

create index mcp_tool_calls_created_idx
  on public.mcp_tool_calls (created_at);

create or replace function public.trim_mcp_tool_calls(p_batch integer default 5000)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  if p_batch is null or p_batch < 1 then
    raise exception 'p_batch must be at least 1';
  end if;

  delete from public.mcp_tool_calls
  where id in (
    select id from public.mcp_tool_calls
    where created_at < now() - interval '90 days'
    order by created_at
    limit p_batch
  );

  get diagnostics n = row_count;

  return n;
end;
$$;

comment on function public.trim_mcp_tool_calls(integer) is
  'Deletes up to p_batch mcp_tool_calls rows older than 90 days and returns how many; the hourly cron calls it until it returns less than p_batch (FILM-1904)';

revoke all on function public.trim_mcp_tool_calls(integer) from public, anon, authenticated;
grant execute on function public.trim_mcp_tool_calls(integer) to service_role;
