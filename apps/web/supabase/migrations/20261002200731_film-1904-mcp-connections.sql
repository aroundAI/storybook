-- FILM-1904: the remote MCP server's connection model.
--
-- An MCP client (Claude Desktop, claude.ai, a script) acts as one user inside
-- one team. Each grant is an mcp_connections row: a personal access token
-- created in settings today, an OAuth consent once FILM-1907 lands. The
-- credential itself is never stored: mcp_tokens holds SHA-256 hashes, and
-- the auth wrapper looks a presented token up by its hash. Every tool call
-- leaves an mcp_tool_calls row (what ran, how it ended, how long it took,
-- never the payload) so a team owner can see what a connected app did.
--
-- Access: a user reads their own connections and revokes them (the only
-- column authenticated may update is revoked_at). Tokens are service role
-- only, read by withMcpAuth and written by create_mcp_personal_access_token
-- below and by FILM-1907's token endpoint. Tool calls are read by the team's
-- owners; the auth wrapper writes them.
--
-- TEXT with CHECK rather than enums, as generation_jobs does.
--
-- Tests: tests/database/mcp-connections-rls.test.sql; the definer function is
-- pinned in definer-functions-inventory.test.sql.

create table public.mcp_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  -- FILM-1907 registers clients in mcp_oauth_clients and adds the reference
  client_id text,
  kind text not null check (kind in ('oauth', 'pat')),
  name text not null check (char_length(name) between 1 and 100),
  scopes text[] not null default '{}'
    check (scopes <@ array['studio:read', 'studio:write', 'studio:render']),
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.mcp_connections is
  'One grant to an MCP client: a personal access token or an OAuth consent, bound to one user and one team (FILM-1904)';

create index mcp_connections_user_account_idx
  on public.mcp_connections (user_id, account_id);

create index mcp_connections_account_idx
  on public.mcp_connections (account_id);

-- A connection is bound to a team (KB-99: the product is team accounts only)
create trigger require_team_account
  before insert or update of account_id on public.mcp_connections
  for each row execute function kit.require_team_account();

alter table public.mcp_connections enable row level security;

revoke all on public.mcp_connections from anon, authenticated;
grant select on public.mcp_connections to authenticated;
-- Revoking is the only change a user makes; the column grant keeps a
-- permitted UPDATE from renaming or re-scoping a connection.
grant update (revoked_at) on public.mcp_connections to authenticated;
grant select, insert, update, delete on public.mcp_connections to service_role;

create policy mcp_connections_read on public.mcp_connections
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy mcp_connections_revoke on public.mcp_connections
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table public.mcp_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  connection_id uuid not null references public.mcp_connections(id) on delete cascade,
  kind text not null check (kind in ('access', 'refresh', 'pat')),
  -- null: does not expire (a personal access token lives until revoked)
  expires_at timestamptz,
  rotated_from text references public.mcp_tokens(token_hash) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.mcp_tokens is
  'SHA-256 hashes of MCP credentials; service role only (FILM-1904)';

create index mcp_tokens_connection_idx on public.mcp_tokens (connection_id);

alter table public.mcp_tokens enable row level security;

revoke all on public.mcp_tokens from anon, authenticated;
grant select, insert, update, delete on public.mcp_tokens to service_role;

create table public.mcp_tool_calls (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references public.mcp_connections(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  tool text not null,
  -- generation_runs arrives with FILM-1903; until then an unreferenced id
  run_id uuid,
  status text not null check (status in ('ok', 'error')),
  error_code text check (error_code in (
    'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION_FAILED',
    'RUN_IN_PROGRESS', 'TARGET_CHANGED', 'RUN_EXPIRED', 'RATE_LIMITED', 'INTERNAL'
  )),
  duration_ms integer not null check (duration_ms >= 0),
  created_at timestamptz not null default now(),
  check ((status = 'ok') = (error_code is null))
);

comment on table public.mcp_tool_calls is
  'One row per MCP tool call: tool, outcome and duration, never the payload (FILM-1904)';

create index mcp_tool_calls_account_created_idx
  on public.mcp_tool_calls (account_id, created_at desc);

create index mcp_tool_calls_connection_created_idx
  on public.mcp_tool_calls (connection_id, created_at desc);

create trigger require_team_account
  before insert or update of account_id on public.mcp_tool_calls
  for each row execute function kit.require_team_account();

alter table public.mcp_tool_calls enable row level security;

revoke all on public.mcp_tool_calls from anon, authenticated;
grant select on public.mcp_tool_calls to authenticated;
grant select, insert, update, delete on public.mcp_tool_calls to service_role;

create policy mcp_tool_calls_read on public.mcp_tool_calls
  for select
  to authenticated
  using (public.has_role_on_account(account_id, 'owner'));

-- Creating a personal access token writes a connection and its token hash
-- together. authenticated cannot insert either table, so this runs with the
-- definer's rights after checking the caller: signed in, and a member of the
-- team the token is bound to. The plaintext token never reaches the
-- database; the caller hashes it and keeps the plaintext to show once.
create function public.create_mcp_personal_access_token(
  p_account_id uuid,
  p_name text,
  p_scopes text[],
  p_token_hash text
) returns public.mcp_connections
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.mcp_connections;
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if not public.has_role_on_account(p_account_id) then
    raise exception 'not a member of this team' using errcode = '42501';
  end if;

  insert into public.mcp_connections (user_id, account_id, kind, name, scopes)
  values ((select auth.uid()), p_account_id, 'pat', p_name, p_scopes)
  returning * into v_connection;

  insert into public.mcp_tokens (token_hash, connection_id, kind)
  values (p_token_hash, v_connection.id, 'pat');

  return v_connection;
end;
$$;

revoke all on function public.create_mcp_personal_access_token(uuid, text, text[], text) from public;
grant execute on function public.create_mcp_personal_access_token(uuid, text, text[], text) to authenticated, service_role;
