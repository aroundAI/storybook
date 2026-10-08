begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select no_plan();

-- The claims /api/mcp mints, set inline below (packages/features/studio-mcp/src/server/jwt.ts):
-- aal2, and app_metadata.provider = 'mcp'. role is added here to show a
-- super admin's own MCP token still gets no super-admin access.

select tests.create_supabase_user('mcp_owner', 'mcp-owner@makerkit.dev');
select tests.create_supabase_user('other_owner', 'mcp-other@makerkit.dev');

select makerkit.authenticate_as('mcp_owner');
select public.create_team_account('MCP Team');

select makerkit.authenticate_as('other_owner');
select public.create_team_account('Other Team');

-- The owner has MFA, as production's owner does.
select makerkit.authenticate_as('mcp_owner');
select makerkit.set_mfa_factor();

-- 1. An MFA user's MCP token reads their own team (it was refused at aal1).
select set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('request.jwt.claims')::json ->> 'sub',
    'role', 'authenticated',
    'aal', 'aal2',
    'app_metadata', json_build_object('provider', 'mcp', 'role', null))::text, true);

select is(
    (select count(*)::int from public.accounts
     where id = makerkit.get_account_id_by_slug('mcp-team')),
    1,
    'An MCP token for an MFA user reads its own team'
);

select is(
    (select public.has_role_on_account(makerkit.get_account_id_by_slug('mcp-team'))),
    true,
    'An MCP token for an MFA user passes the membership check'
);

-- 2. A super admin's MCP token is not a super admin.
select set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('request.jwt.claims')::json ->> 'sub',
    'role', 'authenticated',
    'aal', 'aal2',
    'app_metadata', json_build_object('provider', 'mcp', 'role', 'super-admin'))::text, true);

select is(
    (select public.is_super_admin()),
    false,
    'A super admin''s MCP token is not a super admin'
);

select is(
    (select count(*)::int from public.accounts
     where id = makerkit.get_account_id_by_slug('other-team')),
    0,
    'A super admin''s MCP token cannot read another team'
);

-- 3. The same super admin in a browser session at aal2 still is one.
select makerkit.authenticate_as('mcp_owner');
select makerkit.set_session_aal('aal2');
select makerkit.set_super_admin();

select is(
    (select public.is_super_admin()),
    true,
    'A super admin''s own aal2 session is still a super admin'
);

select is(
    (select count(*)::int from public.accounts
     where id = makerkit.get_account_id_by_slug('other-team')),
    1,
    'A super admin''s own aal2 session reads another team'
);

select * from finish();

rollback;
