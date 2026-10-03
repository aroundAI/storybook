-- FILM-1903 part C: an LLM job and a model-usage row cannot exist without a
-- run.
--
-- Part A fired the locks only for a row that carried a run id; part B made
-- every path that writes one carry it (the gateway's recordUsage is the only
-- llm_usage_analytics writer, and every web action that records an LLM job
-- opens its run first). So a row with no run is now only ever a bypass, and
-- this refuses it.
--
-- Required at insert, by trigger, rather than NOT NULL or a CHECK:
--   * NOT NULL needs every historical row backfilled, and a usage row or a
--     job written before runs existed has no run to point at. Inventing one
--     would forge history.
--   * A CHECK ... NOT VALID skips the existing rows only when it is added;
--     Postgres re-checks it on every later UPDATE of such a row. A job queued
--     before the deploy is still marked processing and completed by the
--     worker, and reset-to-storyboard cancels old jobs, so those updates
--     would start failing.
--   * Both columns are `on delete set null`: deleting a run (an account's
--     deletion cascades to its runs) clears run_id on its jobs and usage
--     rows. NOT NULL or a CHECK would make that delete fail.
-- The trigger refuses a new row with no run, and a direct UPDATE that clears
-- run_id; it lets the foreign key's own set-null through (that UPDATE runs
-- one trigger level down, inside the run's deletion). Historical rows keep
-- their null and stay writable.

create or replace function public.assert_server_run()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.run_id is null then
    -- pg_trigger_depth() > 1: the run was deleted and the foreign key's
    -- on delete set null is clearing the column. Anything else is a row
    -- trying to exist without a run.
    if tg_op = 'INSERT' or pg_trigger_depth() = 1 then
      raise exception 'refused: % row without a run: every LLM job and model call belongs to an open server-mode run',
        tg_table_name;
    end if;

    return new;
  end if;

  if not exists (
    select 1
    from public.generation_runs r
    where r.id = new.run_id
      and r.mode = 'server'
      and r.status in ('briefed', 'in_progress')
  ) then
    raise exception 'refused: % row for run %: not an open server-mode run',
      tg_table_name, new.run_id;
  end if;

  return new;
end;
$$;

-- Every job type is locked except the vendor renders, which an external run
-- may legitimately start (FILM-1909) and which make no model call. Part A
-- listed the LLM job types instead; naming the exceptions fails closed, so a
-- job type added to generation_jobs_job_type_check later is locked until
-- someone decides it is a render. `update of job_type` too: turning a voice
-- row into a story row is the same row without a run.
drop trigger generation_jobs_server_run_only on public.generation_jobs;

create trigger generation_jobs_server_run_only
  before insert or update of run_id, job_type on public.generation_jobs
  for each row
  when (new.job_type not in ('video', 'voice', 'music', 'sfx'))
  execute function public.assert_server_run();

drop trigger llm_usage_analytics_server_run_only on public.llm_usage_analytics;

create trigger llm_usage_analytics_server_run_only
  before insert or update of run_id on public.llm_usage_analytics
  for each row
  execute function public.assert_server_run();

comment on column public.generation_jobs.run_id is
  'The server-mode run this job executes. Required on insert for every job type but the vendor renders (video, voice, music, sfx); null only on rows written before FILM-1903 part C or whose run was deleted. FILM-1903';
comment on column public.llm_usage_analytics.run_id is
  'The run this model call was made for. Required on insert; null only on rows written before FILM-1903 part C or whose run was deleted. FILM-1903';
