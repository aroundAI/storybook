-- FILM-2005: StorybookStudio, the desktop editor, signs in to StoryBook as
-- an OAuth client of FILM-1907's server, and a team turns that on.
--
--   1. The storybookstudio client is pre-registered: a public client (no
--      secret; the token endpoint refuses any credential and requires PKCE
--      S256 of every client) whose registered redirect URI is the Studio's
--      custom scheme. /oauth/authorize also accepts
--      http://127.0.0.1:<port>/callback for this client_id alone (RFC 8252
--      §7.3), in oauth/authorize.ts, because a port picked per sign-in
--      cannot be listed here. metadata_url stays null, so the row is never
--      refetched or replaced by a client document; Dynamic Client
--      Registration mints sbk_client_ ids and so cannot claim this one.
--      `on conflict do nothing`: a row an operator changed is kept.
--
--   2. account_ai_settings.desktop_integration_enabled: whether the team
--      uses StorybookStudio. Off by default. It shows "Open in Studio" on
--      the team's episodes and lets a member consent to the storybookstudio
--      client for the team. A team with no account_ai_settings row is off.
--      The table's policies already decide who may change it (owners write,
--      members read), and its account_id FK is covered by the team-only rule
--      (KB-99), so no new table joins the pinned count.
--
-- Tests: tests/database/film-2005-storybookstudio-client.test.sql.

insert into public.mcp_oauth_clients (client_id, client_name, redirect_uris)
values ('storybookstudio', 'StorybookStudio', array['storybookstudio://auth/callback'])
on conflict (client_id) do nothing;

alter table public.account_ai_settings
  add column desktop_integration_enabled boolean not null default false;

comment on column public.account_ai_settings.desktop_integration_enabled is
  'Whether the team uses StorybookStudio: shows Open in Studio and allows consent to the storybookstudio OAuth client (FILM-2005). Off by default; owners change it';
