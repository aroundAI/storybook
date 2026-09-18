-- ==================================
-- Experiment log: watched metric, review window, channel, notes (FILM-1610)
-- ==================================
-- FILM-1509 recorded the same six lifetime totals for every experiment, so a
-- CTR test was judged on lifetime views and nothing could say when an
-- experiment was due for review. These columns record which metric the
-- experiment is about, how long it should run, and which channel it ran on.
--
-- `category` and `metric_watched` are unconstrained varchar on purpose: the
-- metric vocabulary lives in a zod enum beside the code that resolves it, and
-- a CHECK here would need a migration every time that set grows.

alter table public.analytics_experiments
  add column if not exists category varchar(30),
  add column if not exists metric_watched varchar(40),
  add column if not exists review_window_days integer not null default 60,
  add column if not exists notes text,
  add column if not exists connection_id uuid,
  add column if not exists review_due_at date
    generated always as (started_at + review_window_days) stored;

-- The zod schema allows 1-365; the table refuses anything else too, since
-- PostgREST is reachable without going through the action.
alter table public.analytics_experiments
  add constraint analytics_experiments_review_window_days_check
  check (review_window_days between 1 and 365);

-- The channel must belong to the experiment's own account. A plain foreign
-- key would not guarantee it: an FK check does not run RLS, so a member of
-- account A could attach account B's channel (the FILM-1608 hole, fixed for
-- channel_analytics_settings in 20260916180412). The composite key reuses the
-- `platform_connections_id_account_key` unique constraint added there.
--
-- `on delete set null (connection_id)` rather than a bare `set null`: on a
-- composite key the bare form would null `account_id` too, which is NOT NULL,
-- so disconnecting a channel would fail instead of detaching the experiment.
-- Nulling only the channel keeps the experiment's history, matching how
-- `project_id` already behaves in this table.
alter table public.analytics_experiments
  add constraint analytics_experiments_connection_account_fkey
  foreign key (connection_id, account_id)
  references public.platform_connections (id, account_id)
  on delete set null (connection_id);

comment on column public.analytics_experiments.metric_watched is 'The one metric this experiment is judged on; resolved into snapshots alongside the fixed totals';
comment on column public.analytics_experiments.review_window_days is 'Planned run length in days; the baseline window before the start has the same length';
comment on column public.analytics_experiments.review_due_at is 'started_at + review_window_days; null until the experiment starts';

-- Serves the due-for-review list. Only running experiments can be due.
create index if not exists idx_analytics_experiments_review_due
  on public.analytics_experiments (account_id, review_due_at)
  where status = 'running';
