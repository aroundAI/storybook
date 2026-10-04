-- ==================================
-- Edit sessions and edit events (FILM-2002)
-- ==================================
-- Mirrors migrations/20261004160301_film-2002-edit-sessions-and-events.sql.
-- Schema files are documentation; the database is built from migrations/.
--
-- One edit_sessions row per StorybookStudio session on an episode (at most
-- one open), its append-only edit_events, and the three SECURITY DEFINER
-- functions that are the only writers: open_edit_session,
-- record_edit_events, close_edit_session, with kit.end_edit_session as the
-- seam FILM-2003's deliver_edit calls. episodes.edit_state is in
-- 30-film-studio.sql.

-- ----------------------------------------------------------------------
-- edit_sessions
-- ----------------------------------------------------------------------
create table public.edit_sessions (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- the device: a personal access token or an OAuth consent (FILM-1904)
  connection_id uuid references public.mcp_connections(id) on delete set null,
  package_etag text not null check (char_length(package_etag) between 1 and 200),
  status text not null default 'open'
    check (status in ('open', 'closed', 'delivered')),
  previous_status text not null
    check (previous_status in ('storyboard', 'generating', 'ready', 'published')),
  started_at timestamptz not null default now(),
  -- the open, then every record_edit_events call; the hourly cron closes a
  -- session idle for 24 hours
  last_event_at timestamptz not null default now(),
  closed_at timestamptz,
  delivered_at timestamptz,
  close_reason text check (close_reason in ('client', 'stale', 'admin', 'delivered')),
  summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(summary) = 'object'),
  -- an open session has ended in no way; a closed one has a close time and
  -- reason; a delivered one has both times
  constraint edit_sessions_status_times check (
    (status = 'open' and closed_at is null and delivered_at is null and close_reason is null)
    or (status = 'closed' and closed_at is not null and delivered_at is null and close_reason is not null)
    or (status = 'delivered' and closed_at is not null and delivered_at is not null and close_reason = 'delivered')
  )
);

comment on table public.edit_sessions is
  'One StorybookStudio edit session on an episode (FILM-2002); at most one open per episode';

create index edit_sessions_episode_status_idx
  on public.edit_sessions (episode_id, status);

create unique index edit_sessions_one_open
  on public.edit_sessions (episode_id)
  where status = 'open';

create index edit_sessions_open_idle_idx
  on public.edit_sessions (last_event_at)
  where status = 'open';

create index edit_sessions_user_idx on public.edit_sessions (user_id);
create index edit_sessions_connection_idx on public.edit_sessions (connection_id);

-- ----------------------------------------------------------------------
-- edit_events
-- ----------------------------------------------------------------------
create table public.edit_events (
  id bigserial primary key,
  edit_session_id uuid not null references public.edit_sessions(id) on delete cascade,
  -- the Studio's id for the event, so a retried batch inserts nothing twice
  client_event_id text not null check (char_length(client_event_id) between 1 and 128),
  ts timestamptz not null,
  type text not null check (type in (
    'plan_proposed', 'plan_approved', 'plan_rejected',
    'version_created', 'qa_run', 'delivered'
  )),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  received_at timestamptz not null default now(),
  constraint edit_events_client_event_unique unique (edit_session_id, client_event_id)
);

comment on table public.edit_events is
  'Append-only events of an edit session (FILM-2002); data is validated per type by @kit/desktop-integration';

create index edit_events_session_ts_idx
  on public.edit_events (edit_session_id, ts);

-- ----------------------------------------------------------------------
-- RLS: members of the episode's project read; nobody writes directly
-- ----------------------------------------------------------------------
alter table public.edit_sessions enable row level security;
alter table public.edit_events enable row level security;

revoke all on public.edit_sessions from public, anon, authenticated;
revoke all on public.edit_events from public, anon, authenticated;
grant select on public.edit_sessions to authenticated;
grant select on public.edit_events to authenticated;
grant select, insert, update, delete on public.edit_sessions to service_role;
grant select, insert, update, delete on public.edit_events to service_role;
grant usage, select on sequence public.edit_events_id_seq to service_role;

create policy edit_sessions_read on public.edit_sessions
  for select to authenticated
  using (
    exists (
      select 1 from public.episodes e
      where e.id = edit_sessions.episode_id
        and public.has_role_on_project(e.project_id)
    )
  );

create policy edit_events_read on public.edit_events
  for select to authenticated
  using (
    exists (
      select 1
      from public.edit_sessions s
      join public.episodes e on e.id = s.episode_id
      where s.id = edit_events.edit_session_id
        and public.has_role_on_project(e.project_id)
    )
  );

-- ----------------------------------------------------------------------
-- kit.released_edit_state: edit_state once a session ends
-- ----------------------------------------------------------------------
-- Clears the session fields when they name this session; a delivery also
-- stamps lastDeliveredAt and the delivered edit's version count.
create or replace function kit.released_edit_state(
  p_edit_state jsonb,
  p_session_id uuid,
  p_delivered_at timestamptz default null,
  p_versions integer default null
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select
    case
      when coalesce(p_edit_state, '{}'::jsonb)->>'sessionId' = p_session_id::text
        then coalesce(p_edit_state, '{}'::jsonb)
          || jsonb_build_object('sessionId', null, 'editedBy', null, 'since', null)
      else coalesce(p_edit_state, '{}'::jsonb)
    end
    || case
      when p_delivered_at is not null then
        jsonb_build_object('lastDeliveredAt', p_delivered_at, 'editedIn', 'studio')
        || case when p_versions is not null
             then jsonb_build_object('versions', p_versions)
             else '{}'::jsonb end
      else '{}'::jsonb
    end;
$$;

revoke all on function kit.released_edit_state(jsonb, uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function kit.released_edit_state(jsonb, uuid, timestamptz, integer) to service_role;

-- ----------------------------------------------------------------------
-- kit.end_edit_session: the one place a session ends
-- ----------------------------------------------------------------------
-- No access check: callers check first (close_edit_session here,
-- deliver_edit in FILM-2003, the service role's stale close). Not
-- executable by authenticated. Locks the episode, then the session (the
-- order every edit-session writer uses).
--
-- 'closed': the episode goes back to previous_status if it is still
-- 'editing'. 'delivered': the status is the caller's to set (deliver_edit
-- moves it to ready in the same transaction); edit_state gets
-- lastDeliveredAt and summary.versions.
create or replace function kit.end_edit_session(
  p_session_id uuid,
  p_outcome text,
  p_summary jsonb,
  p_reason text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_episode_id uuid;
  v_episode public.episodes;
  v_session public.edit_sessions;
  v_now timestamptz := now();
  v_restored text;
  v_versions integer;
begin
  if p_outcome not in ('closed', 'delivered') then
    raise exception 'refused: a session ends closed or delivered, not %', p_outcome
      using errcode = 'check_violation';
  end if;

  select s.episode_id into v_episode_id
  from public.edit_sessions s where s.id = p_session_id;

  if v_episode_id is null then
    raise exception 'refused: no edit session %', p_session_id
      using errcode = 'no_data_found';
  end if;

  select * into v_episode from public.episodes e where e.id = v_episode_id for update;
  select * into v_session from public.edit_sessions s where s.id = p_session_id for update;

  if v_session.status <> 'open' then
    raise exception 'refused: edit session % is already %', p_session_id, v_session.status
      using errcode = 'check_violation';
  end if;

  update public.edit_sessions
  set status = p_outcome,
      closed_at = v_now,
      delivered_at = case when p_outcome = 'delivered' then v_now end,
      close_reason = case when p_outcome = 'delivered' then 'delivered' else p_reason end,
      summary = coalesce(p_summary, '{}'::jsonb)
  where id = p_session_id
  returning * into v_session;

  if p_outcome = 'closed' and v_episode.status = 'editing' then
    v_restored := v_session.previous_status;
  end if;

  if p_outcome = 'delivered' and jsonb_typeof(p_summary->'versions') = 'number' then
    v_versions := (p_summary->>'versions')::integer;
  end if;

  update public.episodes
  set status = coalesce(v_restored, status),
      edit_state = kit.released_edit_state(
        edit_state,
        p_session_id,
        case when p_outcome = 'delivered' then v_now end,
        v_versions
      )
  where id = v_episode_id
  returning * into v_episode;

  return jsonb_build_object(
    'ok', true,
    'session', to_jsonb(v_session),
    'restoredStatus', v_restored,
    'episodeStatus', v_episode.status,
    'episodeVersion', v_episode.version
  );
end;
$$;

revoke all on function kit.end_edit_session(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function kit.end_edit_session(uuid, text, jsonb, text) to service_role;

-- ----------------------------------------------------------------------
-- open_edit_session
-- ----------------------------------------------------------------------
-- Returns {ok: true, existing, session, previousStatus, episodeVersion}, or
-- {ok: false, code, ...}: NOT_FOUND (no such live episode the caller can
-- see), FORBIDDEN (a viewer, or a connection that is not the caller's),
-- VALIDATION_FAILED (draft or story: nothing to edit), RUN_IN_PROGRESS
-- (another user's session is open; holder names who and since). The same
-- user opening again gets the session already open.
create or replace function public.open_edit_session(
  p_episode_id uuid,
  p_package_etag text,
  p_connection_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_episode public.episodes;
  v_account_id uuid;
  v_role public.project_role;
  v_open public.edit_sessions;
  v_session public.edit_sessions;
  v_previous text;
  v_name text;
begin
  if v_uid is null then
    raise exception 'refused: open_edit_session needs a signed-in user'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_episode
  from public.episodes e
  where e.id = p_episode_id and e.deleted_at is null
  for update;

  if v_episode.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  select p.account_id into v_account_id from public.projects p where p.id = v_episode.project_id;

  select pm.role into v_role
  from public.project_members pm
  where pm.project_id = v_episode.project_id and pm.user_id = v_uid;

  if v_role is null and not public.has_role_on_account(v_account_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_role is null or v_role not in ('owner', 'admin', 'member') then
    return jsonb_build_object(
      'ok', false, 'code', 'FORBIDDEN',
      'role', coalesce(v_role::text, 'none')
    );
  end if;

  if p_connection_id is not null and not exists (
    select 1 from public.mcp_connections c
    where c.id = p_connection_id and c.user_id = v_uid and c.revoked_at is null
  ) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'role', v_role::text,
      'reason', 'connection');
  end if;

  select * into v_open
  from public.edit_sessions s
  where s.episode_id = p_episode_id and s.status = 'open';

  if v_open.id is not null then
    if v_open.user_id = v_uid then
      return jsonb_build_object(
        'ok', true,
        'existing', true,
        'session', to_jsonb(v_open),
        'previousStatus', v_open.previous_status,
        'episodeVersion', v_episode.version
      );
    end if;

    return jsonb_build_object(
      'ok', false,
      'code', 'RUN_IN_PROGRESS',
      'holder', jsonb_build_object(
        'sessionId', v_open.id,
        'userId', v_open.user_id,
        'name', (select a.name from public.accounts a
                  where a.id = v_open.user_id and a.is_personal_account),
        'since', v_open.started_at
      )
    );
  end if;

  if v_episode.status in ('draft', 'story') then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_FAILED', 'status', v_episode.status);
  end if;

  -- 'editing' with no open session never comes from these functions; take
  -- the status the last session replaced, else storyboard
  if v_episode.status = 'editing' then
    select s.previous_status into v_previous
    from public.edit_sessions s
    where s.episode_id = p_episode_id
    order by s.started_at desc
    limit 1;
    v_previous := coalesce(v_previous, 'storyboard');
  else
    v_previous := v_episode.status;
  end if;

  select a.name into v_name
  from public.accounts a
  where a.id = v_uid and a.is_personal_account;

  insert into public.edit_sessions (episode_id, user_id, connection_id, package_etag, previous_status)
  values (p_episode_id, v_uid, p_connection_id, p_package_etag, v_previous)
  returning * into v_session;

  update public.episodes
  set status = 'editing',
      edit_state = jsonb_build_object('lastDeliveredAt', null, 'versions', 0)
        || edit_state
        || jsonb_build_object(
          'sessionId', v_session.id,
          'editedBy', jsonb_build_object('userId', v_uid, 'name', v_name),
          'since', v_session.started_at,
          'editedIn', 'studio'
        )
  where id = p_episode_id
  returning * into v_episode;

  return jsonb_build_object(
    'ok', true,
    'existing', false,
    'session', to_jsonb(v_session),
    'previousStatus', v_previous,
    'episodeVersion', v_episode.version
  );
end;
$$;

revoke all on function public.open_edit_session(uuid, text, uuid) from public, anon;
grant execute on function public.open_edit_session(uuid, text, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------
-- record_edit_events
-- ----------------------------------------------------------------------
-- p_events is [{client_event_id, ts, type, data}], at most 500. Returns
-- {ok: true, accepted, duplicates} or {ok: false, code}: NOT_FOUND,
-- FORBIDDEN (not the session's user), VALIDATION_FAILED (closed session,
-- too many events). Per-type data is validated by the tool before this.
create or replace function public.record_edit_events(
  p_session_id uuid,
  p_events jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.edit_sessions;
  v_total integer;
  v_inserted integer;
begin
  if v_uid is null then
    raise exception 'refused: record_edit_events needs a signed-in user'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_session from public.edit_sessions s where s.id = p_session_id for share;

  if v_session.id is null or not exists (
    select 1 from public.episodes e
    where e.id = v_session.episode_id and public.has_role_on_project(e.project_id)
  ) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_session.user_id <> v_uid then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  if v_session.status <> 'open' then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_FAILED', 'status', v_session.status);
  end if;

  if jsonb_typeof(p_events) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_FAILED', 'reason', 'events');
  end if;

  v_total := jsonb_array_length(p_events);

  if v_total > 500 then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_FAILED', 'reason', 'too_many', 'count', v_total);
  end if;

  insert into public.edit_events (edit_session_id, client_event_id, ts, type, data)
  select p_session_id, x.client_event_id, x.ts, x.type, coalesce(x.data, '{}'::jsonb)
  from jsonb_to_recordset(p_events) as x(client_event_id text, ts timestamptz, type text, data jsonb)
  on conflict (edit_session_id, client_event_id) do nothing;

  get diagnostics v_inserted = row_count;

  update public.edit_sessions set last_event_at = now() where id = p_session_id;

  return jsonb_build_object('ok', true, 'accepted', v_inserted, 'duplicates', v_total - v_inserted);
end;
$$;

revoke all on function public.record_edit_events(uuid, jsonb) from public, anon;
grant execute on function public.record_edit_events(uuid, jsonb) to authenticated, service_role;

-- ----------------------------------------------------------------------
-- close_edit_session
-- ----------------------------------------------------------------------
-- p_summary is computed by summarizeEditSession (@kit/desktop-integration).
-- p_reason: 'client' (the session's user), 'admin' (a project owner or
-- admin, FILM-2006's force-close), 'stale' (the service role's hourly
-- cron). Returns kit.end_edit_session's answer, or {ok: false, code}:
-- NOT_FOUND, FORBIDDEN, VALIDATION_FAILED (already closed or delivered).
create or replace function public.close_edit_session(
  p_session_id uuid,
  p_summary jsonb,
  p_reason text default 'client'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_service boolean := coalesce(auth.role(), current_setting('role', true)) = 'service_role';
  v_session public.edit_sessions;
  v_project_id uuid;
  v_role public.project_role;
begin
  if p_reason is null or p_reason not in ('client', 'admin', 'stale') then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_FAILED', 'reason', 'reason');
  end if;

  if jsonb_typeof(coalesce(p_summary, '{}'::jsonb)) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_FAILED', 'reason', 'summary');
  end if;

  select * into v_session from public.edit_sessions s where s.id = p_session_id;

  if v_session.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if not v_service then
    if v_uid is null then
      raise exception 'refused: close_edit_session needs a signed-in user'
        using errcode = 'insufficient_privilege';
    end if;

    select e.project_id into v_project_id from public.episodes e where e.id = v_session.episode_id;

    select pm.role into v_role
    from public.project_members pm
    where pm.project_id = v_project_id and pm.user_id = v_uid;

    if v_role is null then
      return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    end if;

    if p_reason = 'stale'
      or (p_reason = 'client' and v_session.user_id <> v_uid)
      or (p_reason = 'admin' and v_role not in ('owner', 'admin')) then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
    end if;
  end if;

  if v_session.status <> 'open' then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_FAILED', 'status', v_session.status);
  end if;

  begin
    return kit.end_edit_session(p_session_id, 'closed', coalesce(p_summary, '{}'::jsonb), p_reason);
  exception
    -- a concurrent close or delivery got there between the read and the lock
    when check_violation then
      select s.status into v_session.status from public.edit_sessions s where s.id = p_session_id;
      return jsonb_build_object('ok', false, 'code', 'VALIDATION_FAILED', 'status', v_session.status);
  end;
end;
$$;

revoke all on function public.close_edit_session(uuid, jsonb, text) from public, anon;
grant execute on function public.close_edit_session(uuid, jsonb, text) to authenticated, service_role;
