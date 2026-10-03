begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(8);

-- FILM-1912: account_ai_settings.performance_context_enabled, the team
-- setting that puts past-episode performance into generation briefs. Off
-- by default; the owner turns it on; a member reads it and cannot change
-- it; a stranger sees nothing.
--
-- Actors (seeded team `storybook`: owner@ is an owner, member@ a member)

select makerkit.set_identifier('owner', 'owner@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');
select tests.create_supabase_user('pc_out', 'pc-out@storybook.dev');

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

select makerkit.authenticate_as('owner');
set local role postgres;
select set_config('pc.team', makerkit.get_account_id_by_slug('storybook')::text, true);

select col_default_is(
  'public', 'account_ai_settings', 'performance_context_enabled', 'false',
  'P1 the setting defaults to off'
);

select col_not_null(
  'public', 'account_ai_settings', 'performance_context_enabled',
  'P1 the setting is never null: off is false, not unknown'
);

select makerkit.authenticate_as('owner');

select lives_ok(
  $$ insert into public.account_ai_settings (account_id)
     values (current_setting('pc.team')::uuid) $$,
  'P2 an owner creates the team''s AI settings'
);

select is(
  (select performance_context_enabled from public.account_ai_settings
    where account_id = current_setting('pc.team')::uuid),
  false,
  'P2 a new row has it off'
);

select is(
  pg_temp.affected($$ update public.account_ai_settings set performance_context_enabled = true
                     where account_id = current_setting('pc.team')::uuid $$),
  1,
  'P3 an owner turns it on'
);

select makerkit.authenticate_as('member');

select is(
  pg_temp.affected($$ update public.account_ai_settings set performance_context_enabled = false
                     where account_id = current_setting('pc.team')::uuid $$),
  0,
  'P4 a member''s update changes nothing'
);

select is(
  (select performance_context_enabled from public.account_ai_settings
    where account_id = current_setting('pc.team')::uuid),
  true,
  'P4 a member reads it, still on'
);

select makerkit.authenticate_as('pc_out');

select is(
  (select count(*)::int from public.account_ai_settings
    where account_id = current_setting('pc.team')::uuid),
  0,
  'P5 a stranger cannot read the team''s setting'
);

select * from finish();
rollback;
