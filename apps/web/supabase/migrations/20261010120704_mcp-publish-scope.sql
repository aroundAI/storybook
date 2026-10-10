-- An MCP connection may hold studio:publish: it schedules publishes to the
-- team's channels and cancels them before they go out (owner, 2026-10-10).
-- Publishing now stays a web action. The consent screen offers the scope
-- unticked, so only a person who ticks it grants it.

alter table public.mcp_connections
  drop constraint mcp_connections_scopes_check,
  add constraint mcp_connections_scopes_check
    check (scopes <@ array['studio:read', 'studio:write', 'studio:render', 'studio:publish']);

alter table public.mcp_authorization_codes
  drop constraint mcp_authorization_codes_scopes_check,
  add constraint mcp_authorization_codes_scopes_check
    check (scopes <@ array['studio:read', 'studio:write', 'studio:render', 'studio:publish']);
