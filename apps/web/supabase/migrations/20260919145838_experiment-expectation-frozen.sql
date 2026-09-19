-- ==================================
-- The expectation is fixed once an experiment starts (FILM-1610 review 5, H3)
-- ==================================
-- The form promises the expected outcome is "recorded before the result is
-- known, so hindsight cannot rewrite it", but a member could rewrite the
-- hypothesis and expected outcome after concluding — reproduced as psql
-- before this migration. The lifecycle guard now refuses both once the
-- experiment has left planned. While planned they can still be refined.

create or replace function public.guard_experiment_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The service role (seeds, backfills, repairs) has no auth.uid() and may
  -- write any state, as with set_experiment_creator.
  if auth.uid() is null then
    return new;
  end if;

  -- A foreign-key action (a channel or user deleted) arrives nested and
  -- touches none of these columns' meaning.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'planned'
       or new.started_at is not null
       or new.ended_at is not null
       -- Snapshots are `not null default '{}'`: empty means not measured.
       or new.baseline_metrics <> '{}'::jsonb
       or new.result_metrics <> '{}'::jsonb then
      raise exception
        'A new experiment is planned, with no dates or measurements yet';
    end if;

    return new;
  end if;

  if new.status is distinct from old.status
     and not (old.status = 'planned' and new.status in ('running', 'abandoned'))
     and not (old.status = 'running' and new.status in ('concluded', 'abandoned')) then
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

  -- Round 5 (H3): the expectation is recorded before the result is known.
  -- Once the experiment has started, rewriting it would let hindsight
  -- match it to the result.
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

drop trigger analytics_experiments_guard_lifecycle on public.analytics_experiments;

create trigger analytics_experiments_guard_lifecycle
  before insert or update of status, started_at, ended_at, baseline_metrics,
    result_metrics, hypothesis, expected_outcome
  on public.analytics_experiments
  for each row execute function public.guard_experiment_lifecycle();
