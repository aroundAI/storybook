-- FILM-1601: channel-level revenue must be deletable, and the tagged-library
-- gate must count videos rather than tag assignments.

drop policy if exists "revenue_records_delete" on public.revenue_records;

create policy "revenue_records_delete" on public.revenue_records for delete
  to authenticated using (
    (
      account_id is not null
      and public.has_account_access(account_id)
    )
    or exists (
      select 1 from public.publishes pub
      join public.episodes e on e.id = pub.episode_id
      join public.project_members pm on pm.project_id = e.project_id
      where pub.id = revenue_records.publish_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin')
    )
  );

create or replace function public.count_tagged_publishes(target_account_id uuid)
returns integer
language sql
security invoker
stable
set search_path = ''
as $$
  select count(distinct pt.publish_id)::int
  from public.publish_tags pt
  join public.content_tags ct on ct.id = pt.tag_id
  where ct.account_id = target_account_id;
$$;

grant execute on function public.count_tagged_publishes(uuid) to authenticated;
