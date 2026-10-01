-- ==================================
-- Channel experiments (FILM-1724)
-- ==================================
-- A creator tags each new upload with a style and compares the styles,
-- every video measured at the same age as the others. Different from the
-- Change log (analytics_experiments, FILM-1610), which compares the same
-- videos before and after a change: a new upload has no "before".
--
-- Everything the comparison rests on is held here, by the table, because
-- PostgREST is reachable without going through the actions:
--   * 2–8 styles per experiment;
--   * one channel and one format family per experiment, so Shorts and
--     long-form are never pooled (FILM-1716);
--   * a video is assigned only to an experiment on its own channel and
--     account, published on or after the start, once per experiment;
--   * the lifecycle and the frozen expectation of FILM-1610 rounds 4–5;
--   * the suggested style is computed here, once, and stored with whether
--     the user overrode it.

-- ----------------------------------------------------------------------
-- Lifecycle moves, one rule for both kinds of experiment
-- ----------------------------------------------------------------------
-- planned → running → concluded, or planned | running → abandoned. The
-- Change log's guard (guard_experiment_lifecycle) is re-pointed at this
-- function below, so the two tables cannot drift apart.
create or replace function public.experiment_status_move_allowed(
  p_from text,
  p_to text
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_from is not distinct from p_to
      or (p_from = 'planned' and p_to in ('running', 'abandoned'))
      or (p_from = 'running' and p_to in ('concluded', 'abandoned'));
$$;

grant execute on function public.experiment_status_move_allowed(text, text) to authenticated, service_role;

create or replace function public.guard_experiment_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'planned'
       or new.started_at is not null
       or new.ended_at is not null
       or new.baseline_metrics <> '{}'::jsonb
       or new.result_metrics <> '{}'::jsonb then
      raise exception
        'A new experiment is planned, with no dates or measurements yet';
    end if;

    return new;
  end if;

  -- FILM-1724: the move rule is shared with channel experiments.
  if not public.experiment_status_move_allowed(old.status, new.status) then
    raise exception 'An experiment cannot move from % to %', old.status, new.status;
  end if;

  if (new.started_at is distinct from old.started_at
      or new.baseline_metrics is distinct from old.baseline_metrics)
     and not (old.status = 'planned' and new.status = 'running') then
    raise exception
      'The start date and baseline are recorded once, when the experiment starts';
  end if;

  if new.status = 'running' and new.started_at is null then
    raise exception 'A running experiment needs a start date';
  end if;

  if new.result_metrics is distinct from old.result_metrics
     and not (old.status = 'running' and new.status = 'concluded') then
    raise exception
      'The result is recorded once, when the experiment is concluded';
  end if;

  if new.ended_at is distinct from old.ended_at
     and not (old.status in ('planned', 'running')
              and new.status in ('concluded', 'abandoned')) then
    raise exception 'The end date is recorded once, when the experiment ends';
  end if;

  if old.status <> 'planned'
     and (new.hypothesis is distinct from old.hypothesis
          or new.expected_outcome is distinct from old.expected_outcome) then
    raise exception
      'The hypothesis and expected outcome cannot change once the experiment has started';
  end if;

  if (new.started_at is distinct from old.started_at
      or new.ended_at is distinct from old.ended_at)
     and new.ended_at < new.started_at then
    raise exception 'An experiment cannot end (%) before it started (%)',
      new.ended_at, new.started_at;
  end if;

  return new;
end;
$$;

-- ----------------------------------------------------------------------
-- A publish's format family, in SQL (FILM-1716)
-- ----------------------------------------------------------------------
-- The same two tables as FORMAT_BY_CONTENT_TYPE and DURATION_REFINEMENTS in
-- packages/clickhouse/src/lib/format-families.ts. channel-experiment-sql
-- .test.ts reads these VALUES lists and fails if they disagree, so a family
-- added there fails here until it is mapped. Null for a pair no table knows.
create or replace function public.publish_format_family(
  p_platform text,
  p_content_type text,
  p_duration_seconds integer
) returns text
language sql
immutable
set search_path = ''
as $$
  with declared (platform, content_type, family) as (
    values
      ('youtube', 'full', 'long_horizontal'),
      ('tiktok', 'full', 'long_vertical'),
      ('instagram', 'full', 'long_vertical'),
      ('facebook', 'full', 'long_horizontal'),
      ('twitter', 'full', 'long_horizontal'),
      ('linkedin', 'full', 'long_horizontal'),
      ('youtube', 'short', 'short_vertical'),
      ('tiktok', 'short', 'short_vertical'),
      ('instagram', 'short', 'short_vertical'),
      ('facebook', 'short', 'short_vertical'),
      ('twitter', 'short', 'clip'),
      ('linkedin', 'short', 'clip'),
      ('youtube', 'teaser', 'teaser'),
      ('tiktok', 'teaser', 'teaser'),
      ('instagram', 'teaser', 'teaser'),
      ('facebook', 'teaser', 'teaser'),
      ('twitter', 'teaser', 'teaser'),
      ('linkedin', 'teaser', 'teaser'),
      ('youtube', 'trailer', 'trailer'),
      ('tiktok', 'trailer', 'trailer'),
      ('instagram', 'trailer', 'trailer'),
      ('facebook', 'trailer', 'trailer'),
      ('twitter', 'trailer', 'trailer'),
      ('linkedin', 'trailer', 'trailer')
  ),
  refinement (platform, content_type, above_seconds, family) as (
    values
      ('youtube', 'short', 180, 'long_vertical')
  )
  select coalesce(
    (select r.family from refinement r
      where r.platform = p_platform
        and r.content_type = p_content_type
        and p_duration_seconds is not null
        and p_duration_seconds > r.above_seconds
      limit 1),
    (select d.family from declared d
      where d.platform = p_platform and d.content_type = p_content_type)
  );
$$;

grant execute on function public.publish_format_family(text, text, integer) to authenticated, service_role;

-- A publish is referenced with its channel, so an assignment's channel is
-- the publish's by key (the FILM-1608 composite pattern).
alter table public.publishes
  add constraint publishes_id_connection_key unique (id, platform_connection_id);

-- ----------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------
create table if not exists public.channel_experiments (
  id uuid primary key default extensions.uuid_generate_v4(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  -- A channel-level question: required, and in the experiment's account.
  connection_id uuid not null,
  format_family varchar(30) not null,
  title varchar(200) not null,
  hypothesis text,
  expected_outcome text,
  -- What the user concluded, written once when the experiment ends.
  conclusion text,
  outcome_status varchar(20) not null default 'pending',
  status varchar(20) not null default 'planned',
  -- Calendar days in the creator's own zone (FILM-1610 E1).
  started_at date,
  ended_at date,
  time_zone text not null default 'UTC',
  measures text[] not null
    default array['views', 'ctr', 'avg_view_percentage', 'subscribers_per_1000_views'],
  -- The per-style results as they stood at conclusion, written once by the
  -- conclusion. Empty means not concluded.
  result_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_experiments_status_check
    check (status in ('planned', 'running', 'concluded', 'abandoned')),
  constraint channel_experiments_outcome_status_check
    check (outcome_status in ('pending', 'confirmed', 'rejected', 'inconclusive')),
  constraint channel_experiments_format_family_check
    check (format_family in ('short_vertical', 'long_vertical', 'long_horizontal',
                             'teaser', 'trailer', 'clip', 'live')),
  constraint channel_experiments_measures_check
    check (cardinality(measures) >= 1
           and measures <@ array['views', 'ctr', 'avg_view_percentage',
                                 'subscribers_per_1000_views', 'hook_retention_3s']),
  -- An early-retention point exists only where the curve resolves it:
  -- short-form, where 1% of the video is a few seconds (spec §6).
  constraint channel_experiments_hook_short_only_check
    check (not ('hook_retention_3s' = any(measures))
           or format_family = 'short_vertical'),
  constraint channel_experiments_time_zone_check
    check ((timestamptz '2000-01-01 00:00:00+00' at time zone time_zone) is not null),
  constraint channel_experiments_title_check check (char_length(trim(title)) > 0),
  constraint channel_experiments_text_length_check
    check (char_length(coalesce(hypothesis, '')) <= 2000
           and char_length(coalesce(expected_outcome, '')) <= 2000
           and char_length(coalesce(conclusion, '')) <= 5000),
  constraint channel_experiments_id_connection_key unique (id, connection_id),
  constraint channel_experiments_connection_account_fkey
    foreign key (connection_id, account_id)
    references public.platform_connections (id, account_id)
    on delete cascade
);

comment on table public.channel_experiments is
  'FILM-1724: styles compared across new uploads on one channel and format family, each video measured at the same age';
comment on column public.channel_experiments.result_snapshot is
  'Per-style results frozen at conclusion; {} until concluded';
comment on column public.channel_experiments.time_zone is
  'The creator''s IANA zone: started_at is a date there, and a publish counts as on or after it by its local date there';

create index if not exists idx_channel_experiments_account
  on public.channel_experiments (account_id, created_at desc);
create index if not exists idx_channel_experiments_connection
  on public.channel_experiments (connection_id);

create table if not exists public.channel_experiment_styles (
  id uuid primary key default extensions.uuid_generate_v4(),
  experiment_id uuid not null references public.channel_experiments(id) on delete cascade,
  name varchar(80) not null,
  description text,
  sort_order smallint not null,
  created_at timestamptz not null default now(),
  constraint channel_experiment_styles_name_check check (char_length(trim(name)) > 0),
  constraint channel_experiment_styles_description_check
    check (char_length(coalesce(description, '')) <= 500),
  constraint channel_experiment_styles_sort_order_check check (sort_order between 0 and 99),
  constraint channel_experiment_styles_order_key unique (experiment_id, sort_order),
  constraint channel_experiment_styles_name_key unique (experiment_id, name),
  constraint channel_experiment_styles_id_experiment_key unique (id, experiment_id)
);

create table if not exists public.channel_experiment_videos (
  experiment_id uuid not null,
  style_id uuid not null,
  publish_id uuid not null,
  -- Copied from the experiment by the trigger; the keys below then make the
  -- publish's channel the experiment's.
  connection_id uuid not null,
  suggested_style_id uuid,
  overridden boolean not null default false,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  -- A video belongs to one style per experiment.
  primary key (experiment_id, publish_id),
  -- No action, not cascade: a style with a video cannot be removed.
  constraint channel_experiment_videos_style_fkey
    foreign key (style_id, experiment_id)
    references public.channel_experiment_styles (id, experiment_id),
  constraint channel_experiment_videos_suggested_fkey
    foreign key (suggested_style_id, experiment_id)
    references public.channel_experiment_styles (id, experiment_id)
    on delete set null (suggested_style_id),
  constraint channel_experiment_videos_experiment_fkey
    foreign key (experiment_id, connection_id)
    references public.channel_experiments (id, connection_id)
    on delete cascade,
  constraint channel_experiment_videos_publish_fkey
    foreign key (publish_id, connection_id)
    references public.publishes (id, platform_connection_id)
    on delete cascade
);

comment on column public.channel_experiment_videos.suggested_style_id is
  'The style the table suggested at assignment (channel_experiment_suggested_style); null only if that style was later removed';
comment on column public.channel_experiment_videos.overridden is
  'Whether the user chose a style other than the suggested one';

create index if not exists idx_channel_experiment_videos_style
  on public.channel_experiment_videos (style_id, experiment_id);
create index if not exists idx_channel_experiment_videos_publish
  on public.channel_experiment_videos (publish_id);

-- Team accounts only (KB-99): the one guard every account-scoped table carries.
create trigger require_team_account
  before insert or update of account_id on public.channel_experiments
  for each row execute function kit.require_team_account();

create trigger set_channel_experiments_timestamp
  before update on public.channel_experiments
  for each row execute function public.trigger_set_timestamps();

-- The creator is whoever inserts; it cannot be rewritten (FILM-1610's
-- table-agnostic functions, reused).
create trigger channel_experiments_set_creator
  before insert on public.channel_experiments
  for each row execute function public.set_experiment_creator();

create trigger channel_experiments_keep_creator
  before update of created_by on public.channel_experiments
  for each row execute function public.keep_experiment_creator();

create trigger channel_experiments_keep_account
  before update of account_id on public.channel_experiments
  for each row execute function public.keep_account_id('channel experiment');

-- ----------------------------------------------------------------------
-- Lifecycle (FILM-1610 rounds 4–5, held the same way)
-- ----------------------------------------------------------------------
create or replace function public.guard_channel_experiment_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The service role (seeds, repairs) has no auth.uid() and may write any
  -- state; a foreign-key action arrives nested.
  if auth.uid() is null or pg_trigger_depth() > 1 then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'planned'
       or new.started_at is not null
       or new.ended_at is not null
       or new.conclusion is not null
       or new.outcome_status <> 'pending'
       or new.result_snapshot <> '{}'::jsonb then
      raise exception
        'A new channel experiment is planned, with no dates or result yet';
    end if;

    return new;
  end if;

  if not public.experiment_status_move_allowed(old.status, new.status) then
    raise exception 'A channel experiment cannot move from % to %',
      old.status, new.status;
  end if;

  if new.started_at is distinct from old.started_at
     and not (old.status = 'planned' and new.status = 'running') then
    raise exception 'The start date is recorded once, when the experiment starts';
  end if;

  if new.status = 'running' and new.started_at is null then
    raise exception 'A running experiment needs a start date';
  end if;

  if new.result_snapshot is distinct from old.result_snapshot
     and not (old.status = 'running' and new.status = 'concluded') then
    raise exception 'The result is recorded once, when the experiment is concluded';
  end if;

  if (new.ended_at is distinct from old.ended_at
      or new.conclusion is distinct from old.conclusion
      or new.outcome_status is distinct from old.outcome_status)
     and not (old.status in ('planned', 'running')
              and new.status in ('concluded', 'abandoned')) then
    raise exception 'The end date and conclusion are recorded once, when the experiment ends';
  end if;

  -- What the videos are compared on, and the expectation, are fixed before
  -- any result can be seen (FILM-1610 round 5, H3).
  if old.status <> 'planned'
     and (new.hypothesis is distinct from old.hypothesis
          or new.expected_outcome is distinct from old.expected_outcome
          or new.measures is distinct from old.measures
          or new.format_family is distinct from old.format_family
          or new.connection_id is distinct from old.connection_id
          or new.time_zone is distinct from old.time_zone) then
    raise exception
      'The channel, format, measures, hypothesis and expected outcome cannot change once the experiment has started';
  end if;

  if new.ended_at < new.started_at then
    raise exception 'An experiment cannot end (%) before it started (%)',
      new.ended_at, new.started_at;
  end if;

  return new;
end;
$$;

create trigger channel_experiments_guard_lifecycle
  before insert or update on public.channel_experiments
  for each row execute function public.guard_channel_experiment_lifecycle();

-- ----------------------------------------------------------------------
-- 2–8 styles, checked when the transaction commits
-- ----------------------------------------------------------------------
-- Deferred, so an experiment and its styles are written in one transaction
-- (create_channel_experiment) and a style can be swapped for another.
create or replace function public.check_channel_experiment_style_count()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_experiment uuid;
  v_count int;
begin
  if tg_table_name = 'channel_experiments' then
    v_experiment := new.id;
  elsif tg_op = 'DELETE' then
    v_experiment := old.experiment_id;
  else
    v_experiment := new.experiment_id;
  end if;

  -- Deleted with its experiment: nothing left to count.
  if not exists (select 1 from public.channel_experiments where id = v_experiment) then
    return null;
  end if;

  select count(*) into v_count
    from public.channel_experiment_styles
   where experiment_id = v_experiment;

  if v_count < 2 or v_count > 8 then
    raise exception 'A channel experiment has 2 to 8 styles; this one would have %', v_count
      using errcode = '23514';
  end if;

  return null;
end;
$$;

create constraint trigger channel_experiments_style_count
  after insert on public.channel_experiments
  deferrable initially deferred
  for each row execute function public.check_channel_experiment_style_count();

create constraint trigger channel_experiment_styles_count
  after insert or delete on public.channel_experiment_styles
  deferrable initially deferred
  for each row execute function public.check_channel_experiment_style_count();

-- Styles change only while the experiment is open, and stay in it.
create or replace function public.guard_channel_experiment_style()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' and new.experiment_id is distinct from old.experiment_id then
    raise exception 'A style cannot move to another experiment';
  end if;

  select status into v_status
    from public.channel_experiments
   where id = coalesce(new.experiment_id, old.experiment_id);

  if v_status not in ('planned', 'running') then
    raise exception 'Styles cannot change once the experiment is %', v_status;
  end if;

  if tg_op = 'DELETE' and exists (
    select 1 from public.channel_experiment_videos v where v.style_id = old.id
  ) then
    raise exception 'A style with videos assigned to it cannot be removed'
      using errcode = '23503';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger channel_experiment_styles_guard
  before insert or update or delete on public.channel_experiment_styles
  for each row execute function public.guard_channel_experiment_style();

-- ----------------------------------------------------------------------
-- The suggested style: one rule, here
-- ----------------------------------------------------------------------
-- The style with the fewest videos so far, the earliest in the
-- experiment's order on a tie, so the groups stay balanced. The page reads
-- it through this function and the assignment trigger stores it, so what
-- the page suggests is what the table records.
create or replace function public.channel_experiment_suggested_style(
  p_experiment_id uuid
) returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select s.id
    from public.channel_experiment_styles s
    left join public.channel_experiment_videos v on v.style_id = s.id
   where s.experiment_id = p_experiment_id
   group by s.id, s.sort_order
   order by count(v.publish_id) asc, s.sort_order asc
   limit 1;
$$;

grant execute on function public.channel_experiment_suggested_style(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------
-- Assignment
-- ----------------------------------------------------------------------
create or replace function public.guard_channel_experiment_video()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_experiment public.channel_experiments%rowtype;
  v_publish record;
begin
  if tg_op = 'UPDATE' then
    raise exception 'An assignment is not edited; remove it and assign again';
  end if;

  if tg_op = 'DELETE' then
    -- Deleted with its experiment, style or publish.
    if auth.uid() is null or pg_trigger_depth() > 1 then
      return old;
    end if;

    select * into v_experiment
      from public.channel_experiments where id = old.experiment_id;

    select p.published_at into v_publish
      from public.publishes p where p.id = old.publish_id;

    -- Undone only before any result exists: while the experiment runs and
    -- before the video reaches its first checkpoint (7 days, the earliest
    -- age in FILM-1724 §4). Later, removing a video would let the result
    -- be chosen rather than observed.
    if v_experiment.status <> 'running' then
      raise exception 'Videos cannot be removed once the experiment is %', v_experiment.status;
    end if;

    if v_publish.published_at <= now() - interval '7 days' then
      raise exception
        'This video is 7 or more days old, so its first results exist and it stays in the experiment';
    end if;

    return old;
  end if;

  select * into v_experiment
    from public.channel_experiments where id = new.experiment_id;

  if not found then
    raise exception 'Channel experiment not found' using errcode = '23503';
  end if;

  new.connection_id := v_experiment.connection_id;

  if auth.uid() is not null then
    new.assigned_by := auth.uid();
    new.assigned_at := now();
  end if;

  if v_experiment.status <> 'running' then
    raise exception 'Videos are assigned only while the experiment is running; this one is %',
      v_experiment.status;
  end if;

  select p.published_at, p.status, p.platform, p.content_type, p.duration_seconds,
         pr.account_id
    into v_publish
    from public.publishes p
    join public.episodes e on e.id = p.episode_id
    join public.projects pr on pr.id = e.project_id
   where p.id = new.publish_id;

  if not found then
    raise exception 'Video not found' using errcode = '23503';
  end if;

  if v_publish.account_id <> v_experiment.account_id then
    raise exception 'The video belongs to another account' using errcode = '42501';
  end if;

  if v_publish.status <> 'published' or v_publish.published_at is null then
    raise exception 'Only a published video can be assigned';
  end if;

  -- Older videos are refused: assigning them after seeing how they did
  -- would let the result be chosen rather than observed.
  if (v_publish.published_at at time zone v_experiment.time_zone)::date
     < v_experiment.started_at then
    raise exception 'Only videos published on or after the experiment started (%) can be assigned',
      v_experiment.started_at;
  end if;

  if public.publish_format_family(v_publish.platform, v_publish.content_type,
                                  v_publish.duration_seconds)
     is distinct from v_experiment.format_family then
    raise exception 'This video is not in the experiment''s format family (%)',
      v_experiment.format_family;
  end if;

  -- Whatever the caller sent, the suggestion is the table's.
  new.suggested_style_id := public.channel_experiment_suggested_style(new.experiment_id);
  new.overridden := new.style_id is distinct from new.suggested_style_id;

  return new;
end;
$$;

create trigger channel_experiment_videos_guard
  before insert or update or delete on public.channel_experiment_videos
  for each row execute function public.guard_channel_experiment_video();

-- ----------------------------------------------------------------------
-- Creating an experiment and its styles in one transaction
-- ----------------------------------------------------------------------
create or replace function public.create_channel_experiment(
  p_account_id uuid,
  p_connection_id uuid,
  p_format_family text,
  p_title text,
  p_hypothesis text,
  p_expected_outcome text,
  p_measures text[],
  p_time_zone text,
  p_styles jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.channel_experiments (
    account_id, connection_id, format_family, title, hypothesis,
    expected_outcome, measures, time_zone
  ) values (
    p_account_id, p_connection_id, p_format_family, p_title, p_hypothesis,
    p_expected_outcome, p_measures, p_time_zone
  ) returning id into v_id;

  insert into public.channel_experiment_styles (experiment_id, name, description, sort_order)
  select v_id, style ->> 'name', nullif(style ->> 'description', ''), (ordinality - 1)::smallint
    from jsonb_array_elements(p_styles) with ordinality as styles(style, ordinality);

  return v_id;
end;
$$;

grant execute on function public.create_channel_experiment(
  uuid, uuid, text, text, text, text, text[], text, jsonb
) to authenticated;

-- ----------------------------------------------------------------------
-- RLS: account members read; account members write the experiment and its
-- styles; an assignment also needs a writing role on the video's project.
-- ----------------------------------------------------------------------
alter table public.channel_experiments enable row level security;
alter table public.channel_experiment_styles enable row level security;
alter table public.channel_experiment_videos enable row level security;

revoke all on public.channel_experiments from authenticated, service_role;
revoke all on public.channel_experiment_styles from authenticated, service_role;
revoke all on public.channel_experiment_videos from authenticated, service_role;

grant select, insert, update, delete on public.channel_experiments to authenticated, service_role;
grant select, insert, update, delete on public.channel_experiment_styles to authenticated, service_role;
grant select, insert, delete on public.channel_experiment_videos to authenticated;
grant select, insert, update, delete on public.channel_experiment_videos to service_role;

create policy "channel_experiments_read" on public.channel_experiments for select
  to authenticated using (public.has_account_access(account_id));

create policy "channel_experiments_create" on public.channel_experiments for insert
  to authenticated with check (public.has_account_access(account_id));

create policy "channel_experiments_update" on public.channel_experiments for update
  to authenticated using (public.has_account_access(account_id))
  with check (public.has_account_access(account_id));

-- Deleted only while planned (no video can be assigned yet) or abandoned;
-- a running one is abandoned first, and a concluded one is the evidence
-- FILM-1717 builds on (as KB-7 decided for the Change log).
create policy "channel_experiments_delete" on public.channel_experiments for delete
  to authenticated using (
    public.has_account_access(account_id)
    and status in ('planned', 'abandoned')
  );

create policy "channel_experiment_styles_read" on public.channel_experiment_styles for select
  to authenticated using (
    exists (select 1 from public.channel_experiments e
             where e.id = experiment_id and public.has_account_access(e.account_id))
  );

create policy "channel_experiment_styles_create" on public.channel_experiment_styles for insert
  to authenticated with check (
    exists (select 1 from public.channel_experiments e
             where e.id = experiment_id and public.has_account_access(e.account_id))
  );

create policy "channel_experiment_styles_update" on public.channel_experiment_styles for update
  to authenticated
  using (
    exists (select 1 from public.channel_experiments e
             where e.id = experiment_id and public.has_account_access(e.account_id))
  )
  with check (
    exists (select 1 from public.channel_experiments e
             where e.id = experiment_id and public.has_account_access(e.account_id))
  );

create policy "channel_experiment_styles_delete" on public.channel_experiment_styles for delete
  to authenticated using (
    exists (select 1 from public.channel_experiments e
             where e.id = experiment_id and public.has_account_access(e.account_id))
  );

create policy "channel_experiment_videos_read" on public.channel_experiment_videos for select
  to authenticated using (
    exists (select 1 from public.channel_experiments e
             where e.id = experiment_id and public.has_account_access(e.account_id))
  );

create policy "channel_experiment_videos_create" on public.channel_experiment_videos for insert
  to authenticated with check (
    exists (select 1 from public.channel_experiments e
             where e.id = experiment_id and public.has_account_access(e.account_id))
    and exists (
      select 1
        from public.publishes p
        join public.episodes ep on ep.id = p.episode_id
        join public.project_members pm on pm.project_id = ep.project_id
       where p.id = publish_id
         and pm.user_id = auth.uid()
         and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "channel_experiment_videos_delete" on public.channel_experiment_videos for delete
  to authenticated using (
    exists (select 1 from public.channel_experiments e
             where e.id = experiment_id and public.has_account_access(e.account_id))
  );
