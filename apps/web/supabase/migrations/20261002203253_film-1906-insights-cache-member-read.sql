-- FILM-1906. Saved Gemini insights (analytics_insights_cache, FILM-808) were
-- reachable by the service role only: the insights handler reads and writes
-- the cache, and no client role held a grant (20260930140000). The MCP
-- get_saved_insights tool reads it with the caller's RLS-scoped client, so
-- a member of the project's account may now SELECT their own projects' rows.
--
-- SELECT only. The handler stays the sole writer; `authenticated` gets no
-- INSERT, UPDATE or DELETE, so a client cannot plant or alter an insight.
-- The predicate is the project read rule (KB-41): the project's account,
-- through has_account_access, which admits the owner or anyone with a role.

grant select on public.analytics_insights_cache to authenticated;

create policy "analytics_insights_cache_read" on public.analytics_insights_cache
  for select to authenticated
  using (
    exists (
      select 1
      from public.projects p
      where p.id = analytics_insights_cache.project_id
        and public.has_account_access(p.account_id)
    )
  );
