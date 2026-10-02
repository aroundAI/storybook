-- FILM-1907: StoryBook as an OAuth 2.1 authorization server for the MCP
-- connector.
--
-- Two tables, both service role only, read and written by the /oauth/*
-- endpoints alone:
--
--   mcp_oauth_clients        who may ask for a grant: a client registered
--                            through Dynamic Client Registration (RFC 7591),
--                            or one described by a client metadata document
--                            at an https URL that is also its client_id
--                            (metadata_url set). redirect_uris is the whole
--                            open-redirect defence: /oauth/authorize matches
--                            the request's redirect_uri against it exactly.
--   mcp_authorization_codes  one row per code, stored hashed, single use
--                            (used_at), 60 seconds (expires_at), carrying
--                            the PKCE challenge the token endpoint verifies.
--
-- And three changes to FILM-1904's tables:
--
--   mcp_connections.client_id now references mcp_oauth_clients. A personal
--   access token has no client (null).
--   mcp_tokens.audience records the MCP resource URL an access or refresh
--   token was issued for (RFC 8707); the verifier refuses a token for any
--   other resource. Null for personal access tokens, which are not
--   audience-bound.
--   A password change revokes the user's MCP grants: GoTrue updates
--   auth.users.encrypted_password, and kit.revoke_mcp_grants_on_password_change
--   sets revoked_at on every live connection and token of that user, the
--   way kit.handle_update_user_email already reacts to an email change.
--   Deleting the user cascades (user_id references auth.users on delete
--   cascade on connections and codes).
--
-- Tests: tests/database/mcp-oauth-clients-and-codes.test.sql.

create table public.mcp_oauth_clients (
  client_id text primary key check (char_length(client_id) between 1 and 2048),
  client_name text not null check (char_length(client_name) between 1 and 200),
  redirect_uris text[] not null check (cardinality(redirect_uris) between 1 and 20),
  -- set when the client is described by a metadata document at this URL
  -- (then client_id = metadata_url); null for a registered client
  metadata_url text check (metadata_url is null or metadata_url ~ '^https://'),
  created_at timestamptz not null default now()
);

comment on table public.mcp_oauth_clients is
  'OAuth clients that may request an MCP grant: registered (RFC 7591) or described by a client metadata document (FILM-1907)';

alter table public.mcp_oauth_clients enable row level security;

revoke all on public.mcp_oauth_clients from anon, authenticated;
grant select, insert, update, delete on public.mcp_oauth_clients to service_role;

create table public.mcp_authorization_codes (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  client_id text not null references public.mcp_oauth_clients(client_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  scopes text[] not null
    check (scopes <@ array['studio:read', 'studio:write', 'studio:render']),
  code_challenge text not null check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  redirect_uri text not null,
  -- the MCP resource URL the code was requested for (RFC 8707)
  resource text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.mcp_authorization_codes is
  'SHA-256 hashes of single-use, 60-second OAuth authorization codes with their PKCE challenge (FILM-1907)';

create index mcp_authorization_codes_user_idx
  on public.mcp_authorization_codes (user_id);

alter table public.mcp_authorization_codes enable row level security;

revoke all on public.mcp_authorization_codes from anon, authenticated;
grant select, insert, update, delete on public.mcp_authorization_codes to service_role;

alter table public.mcp_connections
  add constraint mcp_connections_client_id_fkey
  foreign key (client_id) references public.mcp_oauth_clients(client_id) on delete set null;

-- A connection made by consent names its client; a personal access token
-- has none.
alter table public.mcp_connections
  add constraint mcp_connections_oauth_has_client
  check (kind <> 'oauth' or client_id is not null);

alter table public.mcp_tokens
  add column audience text;

comment on column public.mcp_tokens.audience is
  'The MCP resource URL the token is bound to (RFC 8707); null for a personal access token';

-- A password change is the moment a user stops trusting whoever held their
-- credentials. Supabase sessions end with it; MCP grants are our own, so we
-- end them here. Runs as the definer because GoTrue (supabase_auth_admin)
-- fires the trigger and holds no grant on public tables. Not callable by
-- anyone: no execute grant, and a trigger function cannot be called from
-- SQL anyway.
create function kit.revoke_mcp_grants_on_password_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.mcp_connections
     set revoked_at = now()
   where user_id = new.id
     and revoked_at is null;

  update public.mcp_tokens t
     set revoked_at = now()
    from public.mcp_connections c
   where c.id = t.connection_id
     and c.user_id = new.id
     and t.revoked_at is null;

  return new;
end;
$$;

revoke all on function kit.revoke_mcp_grants_on_password_change() from public;

create trigger on_auth_user_password_changed
after update of encrypted_password on auth.users
for each row
when (old.encrypted_password is distinct from new.encrypted_password)
execute procedure kit.revoke_mcp_grants_on_password_change();
