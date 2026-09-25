-- ==================================
-- A row may name only its own account's tags and channels (KB-98 and the
-- connection class, KB-109)
-- ==================================
-- A foreign key does not run RLS, so seven write paths accepted the id of
-- another account's tag or channel (platform connection). Reproduced through
-- RLS on 2026-09-25, as a user who owns team A and is not in team T, each of
-- these succeeded on main:
--
--   publish_tags            T's tag on A's video; dim-sync then copied T's
--                           slug into A's ClickHouse video_dim.tags (KB-98)
--   publishes               insert naming T's channel, and an update
--                           repointing A's video at it with status
--                           'scheduled' — the cron, unpublish and the
--                           analytics sync act on a publish's channel
--   episode_/project_publishing_configs, short_publications
--                           insert or update naming T's channel
--   social_posts            insert naming T's channel; publishing a post
--                           decrypts its channel's token
--
-- Decided by the owner on 2026-09-25:
--   * the policies below, two SECURITY DEFINER helpers with explicit EXECUTE
--     grants, a composite FK on social_posts, and account_id frozen on
--     content_tags and platform_connections;
--   * rows already crossing accounts are cleaned here (deleted, or their
--     channel cleared), each step reporting its count as a NOTICE;
--   * a publish naming another account's channel has platform_connection_id
--     cleared, and the migration does not fail over it.
--
-- Every change narrows what was allowed; the policies' USING clauses — who
-- may write — are unchanged. `editable_publish_ids` restates publishes_update's
-- USING, not its WITH CHECK, so it stays true: after the cleanup no existing
-- publish fails the new check, and the freeze below stops a channel moving
-- account and making one fail later.

-- ----------------------------------
-- One rule, two helpers
-- ----------------------------------
-- SECURITY DEFINER: whether a tag or channel belongs to an account is a fact
-- about the two rows, the same for every caller, so it is read without the
-- caller's RLS. Invoker helpers would tie every write below to the read
-- policies of content_tags and platform_connections, and a later narrowing of
-- either would refuse legitimate writes with a message about the wrong table.
-- (A project member outside the account cannot publish either way: the
-- policies' own join to episodes runs under their RLS — observed on main,
-- 2026-09-25.) Each returns one boolean about two ids the caller supplied,
-- the same kind of answer has_role_on_account gives.

create or replace function public.connection_in_account(connection_id uuid, account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select connection_in_account.connection_id is null
      or exists (
           select 1 from public.platform_connections c
            where c.id = connection_in_account.connection_id
              and c.account_id = connection_in_account.account_id
         );
$$;

create or replace function public.tag_in_account(tag_id uuid, account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.content_tags t
     where t.id = tag_in_account.tag_id
       and t.account_id = tag_in_account.account_id
  );
$$;

comment on function public.connection_in_account(uuid, uuid) is
  'True when the channel is null or belongs to the account (KB-98). Policies call it with the row''s account.';
comment on function public.tag_in_account(uuid, uuid) is
  'True when the tag belongs to the account (KB-98). Policies call it with the row''s account.';

revoke all on function public.connection_in_account(uuid, uuid) from public, anon;
revoke all on function public.tag_in_account(uuid, uuid) from public, anon;
grant execute on function public.connection_in_account(uuid, uuid) to authenticated, service_role;
grant execute on function public.tag_in_account(uuid, uuid) to authenticated, service_role;

-- ----------------------------------
-- Clean what the old policies let through
-- ----------------------------------
-- Before the policies change: an update of a legacy row would otherwise
-- fail the new WITH CHECK. The publish ids whose tags change are listed so
-- a ClickHouse environment can re-sync them (`upsertVideoDims(ids)`); the
-- daily reconcile covers published ones anyway.

do $$
declare
  n integer;
  ids text;
begin
  with gone as (
    delete from public.publish_tags pt
     using public.content_tags t, public.publishes p, public.episodes e, public.projects pr
     where t.id = pt.tag_id and p.id = pt.publish_id
       and e.id = p.episode_id and pr.id = e.project_id
       and t.account_id <> pr.account_id
    returning pt.publish_id
  )
  select count(*), string_agg(distinct publish_id::text, ',') into n, ids from gone;
  raise notice 'KB-98: deleted % publish_tags rows naming another account''s tag; re-sync publishes: %', n, coalesce(ids, 'none');

  delete from public.experiment_tags et
   using public.content_tags t, public.analytics_experiments x
   where t.id = et.tag_id and x.id = et.experiment_id
     and t.account_id <> x.account_id;
  get diagnostics n = row_count;
  raise notice 'KB-98: deleted % experiment_tags rows naming another account''s tag', n;

  with detached as (
    update public.publishes p
       set platform_connection_id = null
      from public.episodes e, public.projects pr, public.platform_connections c
     where e.id = p.episode_id and pr.id = e.project_id
       and c.id = p.platform_connection_id
       and c.account_id <> pr.account_id
    returning p.id
  )
  select count(*), string_agg(id::text, ',') into n, ids from detached;
  raise notice 'KB-98: cleared the channel on % publishes naming another account''s channel: %', n, coalesce(ids, 'none');

  delete from public.episode_publishing_configs cfg
   using public.episodes e, public.projects pr, public.platform_connections c
   where e.id = cfg.episode_id and pr.id = e.project_id
     and c.id = cfg.platform_connection_id
     and c.account_id <> pr.account_id;
  get diagnostics n = row_count;
  raise notice 'KB-98: deleted % episode_publishing_configs naming another account''s channel', n;

  delete from public.project_publishing_configs cfg
   using public.projects pr, public.platform_connections c
   where pr.id = cfg.project_id
     and c.id = cfg.platform_connection_id
     and c.account_id <> pr.account_id;
  get diagnostics n = row_count;
  raise notice 'KB-98: deleted % project_publishing_configs naming another account''s channel', n;

  update public.short_publications sp
     set platform_connection_id = null
    from public.shorts s, public.episodes e, public.projects pr, public.platform_connections c
   where s.id = sp.short_id and e.id = s.episode_id and pr.id = e.project_id
     and c.id = sp.platform_connection_id
     and c.account_id <> pr.account_id;
  get diagnostics n = row_count;
  raise notice 'KB-98: cleared the channel on % short_publications naming another account''s channel', n;

  update public.social_posts sp
     set platform_connection_id = null
    from public.platform_connections c
   where c.id = sp.platform_connection_id
     and c.account_id <> sp.account_id;
  get diagnostics n = row_count;
  raise notice 'KB-98: cleared the channel on % social_posts naming another account''s channel', n;
end;
$$;

-- ----------------------------------
-- The policies: USING unchanged, WITH CHECK adds the helper
-- ----------------------------------

alter policy "publish_tags_create" on public.publish_tags with check (
  exists (
    select 1
      from public.publishes p
      join public.episodes e on e.id = p.episode_id
      join public.projects pr on pr.id = e.project_id
     where p.id = publish_tags.publish_id
       and public.has_account_access(pr.account_id)
       and public.tag_in_account(publish_tags.tag_id, pr.account_id)
  )
);

alter policy "publishes_create" on public.publishes with check (
  exists (
    select 1
      from public.episodes e
      join public.project_members pm on pm.project_id = e.project_id
      join public.projects pr on pr.id = e.project_id
     where e.id = publishes.episode_id
       and pm.user_id = auth.uid()
       and pm.role in ('owner', 'admin', 'member')
       and public.connection_in_account(publishes.platform_connection_id, pr.account_id)
  )
);

-- publishes_update had no WITH CHECK, so its USING — which never looks at
-- the channel — was the check on the new row.
alter policy "publishes_update" on public.publishes with check (
  exists (
    select 1
      from public.episodes e
      join public.project_members pm on pm.project_id = e.project_id
      join public.projects pr on pr.id = e.project_id
     where e.id = publishes.episode_id
       and pm.user_id = auth.uid()
       and pm.role in ('owner', 'admin', 'member')
       and public.connection_in_account(publishes.platform_connection_id, pr.account_id)
  )
);

alter policy episode_publishing_insert_policy on public.episode_publishing_configs with check (
  exists (
    select 1
      from public.episodes e
      join public.projects p on e.project_id = p.id
     where e.id = episode_publishing_configs.episode_id
       and public.has_role_on_account(p.account_id)
       and public.connection_in_account(episode_publishing_configs.platform_connection_id, p.account_id)
  )
);

alter policy episode_publishing_update_policy on public.episode_publishing_configs with check (
  exists (
    select 1
      from public.episodes e
      join public.projects p on e.project_id = p.id
     where e.id = episode_publishing_configs.episode_id
       and public.has_role_on_account(p.account_id)
       and public.connection_in_account(episode_publishing_configs.platform_connection_id, p.account_id)
  )
);

alter policy project_publishing_insert_policy on public.project_publishing_configs with check (
  exists (
    select 1
      from public.projects p
     where p.id = project_publishing_configs.project_id
       and public.has_role_on_account(p.account_id)
       and public.connection_in_account(project_publishing_configs.platform_connection_id, p.account_id)
  )
);

alter policy project_publishing_update_policy on public.project_publishing_configs with check (
  exists (
    select 1
      from public.projects p
     where p.id = project_publishing_configs.project_id
       and public.has_role_on_account(p.account_id)
       and public.connection_in_account(project_publishing_configs.platform_connection_id, p.account_id)
  )
);

alter policy short_publications_insert_policy on public.short_publications with check (
  exists (
    select 1
      from public.shorts s
      join public.episodes e on s.episode_id = e.id
      join public.projects p on e.project_id = p.id
     where s.id = short_publications.short_id
       and public.has_role_on_account(p.account_id)
       and public.connection_in_account(short_publications.platform_connection_id, p.account_id)
  )
);

alter policy short_publications_update_policy on public.short_publications with check (
  exists (
    select 1
      from public.shorts s
      join public.episodes e on s.episode_id = e.id
      join public.projects p on e.project_id = p.id
     where s.id = short_publications.short_id
       and public.has_role_on_account(p.account_id)
       and public.connection_in_account(short_publications.platform_connection_id, p.account_id)
  )
);

-- ----------------------------------
-- social_posts: the repo's composite-FK idiom, which binds every role
-- ----------------------------------
-- The same shape as analytics_experiments_connection_account_fkey, backed by
-- platform_connections' unique (id, account_id).

alter table public.social_posts
  add constraint social_posts_connection_account_fkey
  foreign key (platform_connection_id, account_id)
  references public.platform_connections (id, account_id)
  on delete set null (platform_connection_id);

-- ----------------------------------
-- A tag or channel stays in its account
-- ----------------------------------
-- A user in two accounts could move one (update account_id), turning every
-- existing link to it cross-account without writing a link row — and moving
-- a channel moves its tokens. Signed-in callers only, as the lifecycle
-- guards: the service role (repairs) has no auth.uid().

create or replace function public.keep_account_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and new.account_id is distinct from old.account_id then
    raise exception 'A % cannot move to another account', tg_argv[0]
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger content_tags_keep_account
  before update of account_id on public.content_tags
  for each row execute function public.keep_account_id('tag');

create trigger platform_connections_keep_account
  before update of account_id on public.platform_connections
  for each row execute function public.keep_account_id('channel');
