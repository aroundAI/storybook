-- /api/mcp mints aal2 for every connection (an MFA user approved it at aal2:
-- consent and token creation both pass requireUser's MFA check), because the
-- restrictive restrict_mfa_* policies hide an MFA user's own team from an
-- aal1 token. aal2 is also the one condition is_super_admin() checks besides
-- the role, so a super admin's MCP token would pass every super-admin policy
-- and admin_* function. An MCP token is never a super admin: its claims carry
-- app_metadata.provider = 'mcp' (packages/features/studio-mcp/src/server/jwt.ts).
--
-- Tests: tests/database/mcp-token-super-admin.test.sql.

create or replace function public.is_super_admin() returns boolean
    set search_path = '' as
$$
declare
    is_super_admin boolean;
begin
    if not public.is_aal2() then
        return false;
    end if;

    if (auth.jwt() ->> 'app_metadata')::jsonb ->> 'provider' = 'mcp' then
        return false;
    end if;

    select (auth.jwt() ->> 'app_metadata')::jsonb ->> 'role' = 'super-admin' into is_super_admin;

    return coalesce(is_super_admin, false);
end
$$ language plpgsql;
