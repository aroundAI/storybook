-- The Studio's deep-link scheme is storybookstudio:// (owner, 2026-10-05).
-- 20261004191159 seeded the storybookstudio client with the old scheme's
-- callback, and `on conflict do nothing` there leaves an existing row as it
-- was, so a database that already ran it is moved here. Nothing is in
-- production, so the seeded row is replaced outright.
--
-- Tests: tests/database/film-2005-storybookstudio-client.test.sql.

update public.mcp_oauth_clients
set redirect_uris = array['storybookstudio://auth/callback']
where client_id = 'storybookstudio'
  and redirect_uris is distinct from array['storybookstudio://auth/callback'];
