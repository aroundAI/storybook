-- ==================================
-- External generation: submitting a part (FILM-1908)
-- ==================================
-- An MCP client writes a stage's output itself and submits it part by part
-- (EDD "2. Generation runs and leases"). Each part waits in
-- generation_run_parts until finalize_generation commits the run.
-- authenticated has no write privilege on that table (FILM-1903 part A),
-- and the MCP path never uses the service role for a user, so a part is
-- stored through this SECURITY DEFINER function, gated as the run's other
-- lifecycle functions are (can_drive_generation_run, FILM-1903 part B).
--
-- What it enforces, whatever the application does:
-- - only an external run takes a submitted part: a server run's output is
--   the worker's, written through the gateway;
-- - only the user who opened the run submits to it;
-- - only while the run is open and its lease has not passed; each
--   submission renews the lease and moves a briefed run to in_progress;
-- - a part of at most 256 KB (the tools refuse above 100 KB first, with a
--   field error; this is the backstop).
--
-- Accepted and rejected submissions are both recorded, so
-- get_generation_history can show the validation failures: an accepted
-- part replaces the stored output and keeps the failures before it; a
-- rejected one is appended to the part's failures (the last 20) and never
-- replaces an accepted output. A model the client reports is merged into
-- the run's origin, from which finalize stamps it on the content.
--
-- Tests: tests/database/generation-run-parts.test.sql.

create or replace function public.submit_generation_run_part(
  p_run_id uuid,
  p_part_key text,
  p_output jsonb,
  p_validation jsonb,
  p_accepted boolean,
  p_model text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.generation_runs;
  v_part public.generation_run_parts;
  v_failures jsonb;
  v_is_service boolean :=
    coalesce(auth.role(), current_setting('role', true)) = 'service_role';
begin
  select * into v_run from public.generation_runs where id = p_run_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'RUN_NOT_FOUND');
  end if;

  if not public.can_drive_generation_run(v_run.account_id, v_run.project_id) then
    raise exception 'refused: no write access to run %', p_run_id
      using errcode = 'insufficient_privilege';
  end if;

  if not v_is_service and v_run.created_by is distinct from auth.uid() then
    raise exception 'refused: only the user who opened run % submits to it', p_run_id
      using errcode = 'insufficient_privilege';
  end if;

  if v_run.mode <> 'external' then
    raise exception 'refused: run % is %; only an external run takes a submitted part', p_run_id, v_run.mode
      using errcode = 'check_violation';
  end if;

  if p_part_key is null or char_length(p_part_key) not between 1 and 100 then
    raise exception 'a part key is 1 to 100 characters'
      using errcode = 'check_violation';
  end if;

  if p_output is null or octet_length(p_output::text) > 262144 then
    raise exception 'a part is at most 256 KB'
      using errcode = 'check_violation';
  end if;

  if v_run.status not in ('briefed', 'in_progress')
     or (v_run.lease_expires_at is not null and v_run.lease_expires_at < now()) then
    return jsonb_build_object('ok', false, 'code', 'RUN_NOT_OPEN', 'run', to_jsonb(v_run));
  end if;

  select * into v_part
  from public.generation_run_parts
  where run_id = p_run_id and part_key = p_part_key
  for update;

  v_failures := coalesce(v_part.validation -> 'failures', '[]'::jsonb);

  if p_accepted then
    insert into public.generation_run_parts (run_id, part_key, output, validation, submitted_at)
    values (
      p_run_id, p_part_key, p_output,
      coalesce(p_validation, '{}'::jsonb)
        || jsonb_build_object('status', 'accepted', 'failures', v_failures),
      now()
    )
    on conflict (run_id, part_key) do update
      set output = excluded.output,
          validation = excluded.validation,
          submitted_at = excluded.submitted_at
    returning * into v_part;
  else
    -- the newest 20 failures, oldest first
    select coalesce(jsonb_agg(f.value order by f.ord), '[]'::jsonb) into v_failures
    from (
      select value, ord
      from jsonb_array_elements(
        v_failures || jsonb_build_array(
          jsonb_build_object(
            'at', now(),
            'hash', p_validation -> 'hash',
            'errors', coalesce(p_validation -> 'errors', '[]'::jsonb)
          )
        )
      ) with ordinality as e(value, ord)
      order by ord desc
      limit 20
    ) f;

    if v_part.run_id is null then
      insert into public.generation_run_parts (run_id, part_key, output, validation, submitted_at)
      values (
        p_run_id, p_part_key, p_output,
        jsonb_build_object('status', 'rejected', 'failures', v_failures),
        now()
      )
      returning * into v_part;
    else
      update public.generation_run_parts
      set validation = coalesce(validation, '{}'::jsonb)
            || jsonb_build_object('failures', v_failures)
      where run_id = p_run_id and part_key = p_part_key
      returning * into v_part;
    end if;
  end if;

  update public.generation_runs
  set status = case when status = 'briefed' then 'in_progress' else status end,
      lease_expires_at = now() + interval '30 minutes',
      origin = case
        when p_model is null or char_length(p_model) = 0 then origin
        else origin || jsonb_build_object('model', left(p_model, 100), 'modelReportedBy', 'client')
      end
  where id = p_run_id
  returning * into v_run;

  return jsonb_build_object('ok', true, 'run', to_jsonb(v_run), 'part', to_jsonb(v_part));
end;
$$;

comment on function public.submit_generation_run_part(uuid, text, jsonb, jsonb, boolean, text) is
  'Stores one part an external agent submitted (accepted, or a rejection appended to the part''s failures), renews the lease. FILM-1908';

revoke all on function public.submit_generation_run_part(uuid, text, jsonb, jsonb, boolean, text) from public, anon;
grant execute on function public.submit_generation_run_part(uuid, text, jsonb, jsonb, boolean, text) to authenticated, service_role;
