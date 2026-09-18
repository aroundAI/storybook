-- ==================================
-- Analytics Experiment Log (FILM-1509)
-- ==================================
-- Studio tells you what the numbers did, never what you changed. This log
-- records the intent behind each change and captures metric snapshots at
-- start and conclusion, so longitudinal data stays interpretable months
-- later instead of merely historical.

create table if not exists public.analytics_experiments (
  id uuid primary key default extensions.uuid_generate_v4(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title varchar(200) not null,
  hypothesis text,
  change_description text not null,
  expected_outcome text,
  actual_outcome text,
  outcome_status varchar(20) not null default 'pending',
  status varchar(20) not null default 'planned',
  started_at date,
  ended_at date,
  baseline_metrics jsonb not null default '{}'::jsonb,
  result_metrics jsonb not null default '{}'::jsonb,
  -- FILM-1610 (migration 20260918184817)
  category varchar(30),
  metric_watched varchar(40),
  review_window_days integer not null default 60,
  notes text,
  connection_id uuid,
  review_due_at date generated always as (started_at + review_window_days) stored,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (outcome_status in ('pending', 'confirmed', 'rejected', 'inconclusive')),
  check (status in ('planned', 'running', 'concluded', 'abandoned')),
  constraint analytics_experiments_review_window_days_check
    check (review_window_days between 1 and 365),
  constraint analytics_experiments_notes_length_check
    check (char_length(notes) <= 5000),
  -- The channel must belong to the experiment's own account; see the
  -- migration for why this is composite and why it nulls only connection_id.
  constraint analytics_experiments_connection_account_fkey
    foreign key (connection_id, account_id)
    references public.platform_connections (id, account_id)
    on delete set null (connection_id)
);

comment on table public.analytics_experiments is 'Manual log of deliberate content changes with baseline/result metric snapshots';
comment on column public.analytics_experiments.baseline_metrics is 'Metric totals for linked publishes captured when the experiment started';
comment on column public.analytics_experiments.result_metrics is 'Metric totals captured when the experiment concluded';
comment on column public.analytics_experiments.metric_watched is 'The one metric this experiment is judged on; resolved into snapshots alongside the fixed totals';
comment on column public.analytics_experiments.review_window_days is 'Planned run length in days; the baseline window before the start has the same length';
comment on column public.analytics_experiments.review_due_at is 'started_at + review_window_days; null until the experiment starts';

create index if not exists idx_analytics_experiments_account
  on public.analytics_experiments(account_id, created_at desc);
create index if not exists idx_analytics_experiments_status
  on public.analytics_experiments(account_id, status);
create index if not exists idx_analytics_experiments_review_due
  on public.analytics_experiments (account_id, review_due_at)
  where status = 'running';

create trigger set_analytics_experiments_timestamp
  before update on public.analytics_experiments
  for each row
  execute function public.trigger_set_timestamps();

-- Experiments link to the content they were run on
create table if not exists public.experiment_publishes (
  experiment_id uuid not null references public.analytics_experiments(id) on delete cascade,
  publish_id uuid not null references public.publishes(id) on delete cascade,
  primary key (experiment_id, publish_id)
);

-- ...and optionally to the taxonomy tags they were testing
create table if not exists public.experiment_tags (
  experiment_id uuid not null references public.analytics_experiments(id) on delete cascade,
  tag_id uuid not null references public.content_tags(id) on delete cascade,
  primary key (experiment_id, tag_id)
);

create index if not exists idx_experiment_publishes_publish
  on public.experiment_publishes(publish_id);

-- ==================================
-- RLS
-- ==================================

alter table public.analytics_experiments enable row level security;
alter table public.experiment_publishes enable row level security;
alter table public.experiment_tags enable row level security;

revoke all on public.analytics_experiments from authenticated, service_role;
revoke all on public.experiment_publishes from authenticated, service_role;
revoke all on public.experiment_tags from authenticated, service_role;

grant select, insert, update, delete on public.analytics_experiments to authenticated;
grant select, insert, delete on public.experiment_publishes to authenticated;
grant select, insert, delete on public.experiment_tags to authenticated;
grant select, insert, update, delete on public.analytics_experiments to service_role;
grant select, insert, update, delete on public.experiment_publishes to service_role;
grant select, insert, update, delete on public.experiment_tags to service_role;

create policy "analytics_experiments_read" on public.analytics_experiments for select
  to authenticated using (public.has_account_access(account_id));

create policy "analytics_experiments_create" on public.analytics_experiments for insert
  to authenticated with check (public.has_account_access(account_id));

create policy "analytics_experiments_update" on public.analytics_experiments for update
  to authenticated using (public.has_account_access(account_id));

create policy "analytics_experiments_delete" on public.analytics_experiments for delete
  to authenticated using (public.has_account_access(account_id));

-- Join tables authorize through their parent experiment
create policy "experiment_publishes_read" on public.experiment_publishes for select
  to authenticated using (
    exists (
      select 1 from public.analytics_experiments e
      where e.id = experiment_id
        and public.has_account_access(e.account_id)
    )
  );

-- The linked publish must belong to the experiment's account (migration
-- 20260918203816), and links change only while the experiment is planned
-- (20260918221250): snapshots read linked videos from ClickHouse, outside RLS.
create policy "experiment_publishes_create" on public.experiment_publishes for insert
  to authenticated with check (
    exists (
      select 1
        from public.analytics_experiments e
        join public.publishes pub on pub.id = experiment_publishes.publish_id
        join public.episodes ep on ep.id = pub.episode_id
        join public.projects p on p.id = ep.project_id
       where e.id = experiment_publishes.experiment_id
         and public.has_account_access(e.account_id)
         and p.account_id = e.account_id
         and e.status = 'planned'
    )
  );

create policy "experiment_publishes_delete" on public.experiment_publishes for delete
  to authenticated using (
    exists (
      select 1 from public.analytics_experiments e
       where e.id = experiment_id
         and public.has_account_access(e.account_id)
         and e.status = 'planned'
    )
  );

create policy "experiment_tags_read" on public.experiment_tags for select
  to authenticated using (
    exists (
      select 1 from public.analytics_experiments e
      where e.id = experiment_id
        and public.has_account_access(e.account_id)
    )
  );

create policy "experiment_tags_create" on public.experiment_tags for insert
  to authenticated with check (
    exists (
      select 1 from public.analytics_experiments e
      where e.id = experiment_id
        and public.has_account_access(e.account_id)
    )
  );

create policy "experiment_tags_delete" on public.experiment_tags for delete
  to authenticated using (
    exists (
      select 1 from public.analytics_experiments e
      where e.id = experiment_id
        and public.has_account_access(e.account_id)
    )
  );

-- ==================================
-- Integrity enforced by the table (FILM-1610 review, migration 20260918221250)
-- ==================================

create or replace function public.replace_experiment_publishes(
  p_experiment_id uuid,
  p_publish_ids uuid[]
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.experiment_publishes
   where experiment_id = p_experiment_id;

  insert into public.experiment_publishes (experiment_id, publish_id)
  select p_experiment_id, publish_id
    from (select distinct unnest(p_publish_ids) as publish_id) ids;
end;
$$;

create or replace function public.replace_experiment_tags(
  p_experiment_id uuid,
  p_tag_ids uuid[]
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.experiment_tags
   where experiment_id = p_experiment_id;

  insert into public.experiment_tags (experiment_id, tag_id)
  select p_experiment_id, tag_id
    from (select distinct unnest(p_tag_ids) as tag_id) ids;
end;
$$;

grant execute on function public.replace_experiment_publishes(uuid, uuid[]) to authenticated;
grant execute on function public.replace_experiment_tags(uuid, uuid[]) to authenticated;

create or replace function public.freeze_started_experiment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'planned'
     and (new.metric_watched is distinct from old.metric_watched
          or new.review_window_days is distinct from old.review_window_days) then
    raise exception
      'The watched metric and review window cannot change once an experiment has started';
  end if;

  return new;
end;
$$;

create trigger analytics_experiments_freeze_started
  before update of metric_watched, review_window_days on public.analytics_experiments
  for each row execute function public.freeze_started_experiment();

-- An experiment's creator is whoever inserts it. A service-role insert has no
-- auth.uid(), so it keeps what it wrote (seeds and backfills).
create or replace function public.set_experiment_creator()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.created_by = auth.uid();
  end if;

  return new;
end;
$$;

create trigger analytics_experiments_set_creator
  before insert on public.analytics_experiments
  for each row execute function public.set_experiment_creator();
