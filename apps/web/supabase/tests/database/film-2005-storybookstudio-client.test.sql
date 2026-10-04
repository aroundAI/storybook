begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(14);

-- FILM-2005: the pre-registered storybookstudio OAuth client, and the team
-- setting that turns StorybookStudio on.
--
-- Actors (seeded team `storybook`: owner@ is an owner, member@ a member)

select makerkit.set_identifier('owner', 'owner@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');
select tests.create_supabase_user('di_out', 'di-out@storybook.dev');

create function pg_temp.affected(q text) returns integer
language plpgsql as $$
declare n integer;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end;
$$;
grant execute on function pg_temp.affected(text) to authenticated;

-- ---------------------------------------------------------------------
-- The client row
-- ---------------------------------------------------------------------

select is(
  (select count(*)::int from public.mcp_oauth_clients where client_id = 'storybookstudio'),
  1,
  'C1 the storybookstudio client is registered'
);

select row_eq(
  $$ select client_name, redirect_uris, metadata_url
       from public.mcp_oauth_clients where client_id = 'storybookstudio' $$,
  row('StorybookStudio'::text, array['storybookstudio://auth/callback']::text[], null::text),
  'C1 named StorybookStudio, redirecting to storybookstudio://auth/callback, never described by a fetched document'
);

select is(
  pg_temp.affected($$ insert into public.mcp_oauth_clients (client_id, client_name, redirect_uris)
                     values ('storybookstudio', 'StorybookStudio', array['storybookstudio://auth/callback'])
                     on conflict (client_id) do nothing $$),
  0,
  'C2 the seed is idempotent: running it again inserts nothing'
);

select is(
  (select client_name from public.mcp_oauth_clients where client_id = 'storybookstudio'),
  'StorybookStudio',
  'C2 and leaves one row as it was'
);

select makerkit.authenticate_as('member');

select throws_ok(
  $$ select client_id from public.mcp_oauth_clients where client_id = 'storybookstudio' $$,
  '42501',
  null,
  'C3 a signed-in user cannot read the client table (service role only)'
);

set local role postgres;

-- ---------------------------------------------------------------------
-- The team setting
-- ---------------------------------------------------------------------

select set_config('di.team', makerkit.get_account_id_by_slug('storybook')::text, true);

select col_default_is(
  'public', 'account_ai_settings', 'desktop_integration_enabled', 'false',
  'S1 the setting defaults to off'
);

select col_not_null(
  'public', 'account_ai_settings', 'desktop_integration_enabled',
  'S1 the setting is never null: off is false, not unknown'
);

select makerkit.authenticate_as('owner');

select lives_ok(
  $$ insert into public.account_ai_settings (account_id)
     values (current_setting('di.team')::uuid)
     on conflict (account_id) do nothing $$,
  'S2 an owner creates the team''s AI settings'
);

select is(
  (select desktop_integration_enabled from public.account_ai_settings
    where account_id = current_setting('di.team')::uuid),
  false,
  'S2 a new row has it off'
);

select is(
  pg_temp.affected($$ update public.account_ai_settings set desktop_integration_enabled = true
                     where account_id = current_setting('di.team')::uuid $$),
  1,
  'S3 an owner turns it on'
);

select makerkit.authenticate_as('member');

select is(
  pg_temp.affected($$ update public.account_ai_settings set desktop_integration_enabled = false
                     where account_id = current_setting('di.team')::uuid $$),
  0,
  'S4 a member''s update changes nothing'
);

select is(
  (select desktop_integration_enabled from public.account_ai_settings
    where account_id = current_setting('di.team')::uuid),
  true,
  'S4 a member reads it, still on: the button and the consent read it as the member'
);

select makerkit.authenticate_as('di_out');

select is(
  (select count(*)::int from public.account_ai_settings
    where account_id = current_setting('di.team')::uuid),
  0,
  'S5 a stranger cannot read the team''s setting'
);

select is(
  pg_temp.affected($$ update public.account_ai_settings set desktop_integration_enabled = false
                     where account_id = current_setting('di.team')::uuid $$),
  0,
  'S5 nor change it'
);

select * from finish();
rollback;
