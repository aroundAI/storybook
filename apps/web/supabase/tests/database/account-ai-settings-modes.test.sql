begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(7);

-- FILM-1910: a team allows at least one generation mode, and its default is
-- one it allows. Exercised as the team owner, who writes the table directly
-- under RLS, so the constraints are what stops a bad row, not the page.

select makerkit.set_identifier('owner', 'owner@storybook.dev');

select makerkit.authenticate_as('owner');
select set_config('ai.team', makerkit.get_account_id_by_slug('storybook')::text, true);

select lives_ok(
  $$ insert into public.account_ai_settings (account_id) values (current_setting('ai.team')::uuid) $$,
  'the defaults (both modes, default server) are accepted'
);

select throws_ok(
  $$ update public.account_ai_settings
     set server_generation_enabled = false, external_generation_enabled = false
     where account_id = current_setting('ai.team')::uuid $$,
  '23514',
  null,
  'turning both modes off is refused'
);

select throws_ok(
  $$ update public.account_ai_settings
     set server_generation_enabled = false, external_generation_enabled = false
     where account_id = current_setting('ai.team')::uuid $$,
  '23514',
  'new row for relation "account_ai_settings" violates check constraint "account_ai_settings_a_mode_allowed"',
  'the refusal names the a-mode-allowed constraint'
);

select throws_ok(
  $$ update public.account_ai_settings
     set server_generation_enabled = false
     where account_id = current_setting('ai.team')::uuid $$,
  '23514',
  'new row for relation "account_ai_settings" violates check constraint "account_ai_settings_default_mode_allowed"',
  'turning off the default mode alone is refused'
);

select lives_ok(
  $$ update public.account_ai_settings
     set server_generation_enabled = false, default_mode = 'external'
     where account_id = current_setting('ai.team')::uuid $$,
  'a Claude-only team (server off, default external) is accepted'
);

select lives_ok(
  $$ update public.account_ai_settings
     set server_generation_enabled = true, external_generation_enabled = false, default_mode = 'server'
     where account_id = current_setting('ai.team')::uuid $$,
  'a Gemini-only team (external off, default server) is accepted'
);

select is(
  (select row(server_generation_enabled, external_generation_enabled, default_mode)::text
   from public.account_ai_settings where account_id = current_setting('ai.team')::uuid),
  '(t,f,server)',
  'the last accepted settings are what is stored'
);

select * from finish();
rollback;
