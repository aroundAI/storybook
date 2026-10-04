begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(15);

-- Owner decision 2026-10-03 (FILM-1910, FILM-1902): a team's daily cap on
-- LLM spend through the web app. The setting: owners write, members read,
-- a set cap is above zero. The gateway's read, llm_spend_since: only the
-- service role may call it, and it sums the account's priced usage of
-- server-mode runs since a time, counting unpriced rows apart.
--
-- Actors (seeded team `storybook`): owner@ an owner, member@ a member,
-- cap_out a stranger with a team of one.

select makerkit.set_identifier('owner', 'owner@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');
select tests.create_supabase_user('cap_out', 'cap-out@storybook.dev');

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
select set_config('cap.team', makerkit.get_account_id_by_slug('storybook')::text, true);

-- ------------------------------------------------------------------
-- The setting
-- ------------------------------------------------------------------
select lives_ok(
  $$ insert into public.account_ai_settings (account_id) values (current_setting('cap.team')::uuid) $$,
  'S1 a team row with no cap is accepted'
);

select is(
  (select daily_llm_spend_cap_usd from public.account_ai_settings
   where account_id = current_setting('cap.team')::uuid),
  null,
  'S2 the cap defaults to null: no cap'
);

select throws_ok(
  $$ update public.account_ai_settings set daily_llm_spend_cap_usd = 0
     where account_id = current_setting('cap.team')::uuid $$,
  '23514',
  'new row for relation "account_ai_settings" violates check constraint "account_ai_settings_daily_llm_spend_cap_positive"',
  'S3 a cap of zero is refused'
);

select throws_ok(
  $$ update public.account_ai_settings set daily_llm_spend_cap_usd = -5
     where account_id = current_setting('cap.team')::uuid $$,
  '23514',
  null,
  'S4 a negative cap is refused'
);

select is(
  pg_temp.affected($$ update public.account_ai_settings set daily_llm_spend_cap_usd = 5
     where account_id = current_setting('cap.team')::uuid $$),
  1,
  'S5 the owner sets a cap'
);

select makerkit.authenticate_as('member');

select is(
  (select daily_llm_spend_cap_usd from public.account_ai_settings
   where account_id = current_setting('cap.team')::uuid),
  5.00::numeric,
  'S6 a member reads the cap'
);

select is(
  pg_temp.affected($$ update public.account_ai_settings set daily_llm_spend_cap_usd = 500
     where account_id = current_setting('cap.team')::uuid $$),
  0,
  'S7 a member cannot change the cap'
);

select makerkit.authenticate_as('cap_out');

select is(
  (select count(*)::int from public.account_ai_settings
   where account_id = current_setting('cap.team')::uuid),
  0,
  'S8 a stranger does not see the team''s settings'
);

-- ------------------------------------------------------------------
-- llm_spend_since
-- ------------------------------------------------------------------
select makerkit.authenticate_as('member');

select throws_ok(
  $$ select * from public.llm_spend_since(current_setting('cap.team')::uuid, now() - interval '1 day') $$,
  '42501',
  null,
  'F1 a signed-in member cannot call the spend read'
);

-- Fixtures as postgres: a server run and an external run on one project,
-- today's priced and unpriced rows, yesterday's row, another team's row
set local role postgres;
select set_config('cap.owner', tests.get_supabase_uid('owner')::text, true);

insert into public.projects (id, account_id, name, status) values
  ('1910ca00-0000-4000-8000-000000000001', current_setting('cap.team')::uuid, 'Cap project', 'active');
insert into public.episodes (id, project_id, number, title) values
  ('1910ca00-0000-4000-8000-000000000011', '1910ca00-0000-4000-8000-000000000001', 1, 'Ep 1'),
  ('1910ca00-0000-4000-8000-000000000012', '1910ca00-0000-4000-8000-000000000001', 2, 'Ep 2');

insert into public.generation_runs (id, account_id, project_id, target_type, target_id, stage, mode, created_by)
values ('1910ca00-0000-4000-8000-0000000000a1', current_setting('cap.team')::uuid,
        '1910ca00-0000-4000-8000-000000000001', 'episode', '1910ca00-0000-4000-8000-000000000011',
        'story', 'server', current_setting('cap.owner')::uuid);
insert into public.generation_runs (id, account_id, project_id, target_type, target_id, stage, mode, created_by)
values ('1910ca00-0000-4000-8000-0000000000e1', current_setting('cap.team')::uuid,
        '1910ca00-0000-4000-8000-000000000001', 'episode', '1910ca00-0000-4000-8000-000000000012',
        'story', 'external', current_setting('cap.owner')::uuid);

insert into public.llm_usage_analytics (account_id, llm_provider, llm_model, status, total_cost, run_id, created_at) values
  (current_setting('cap.team')::uuid, 'gemini', 'gemini-2.5-pro', 'success', 1.25, '1910ca00-0000-4000-8000-0000000000a1', now()),
  (current_setting('cap.team')::uuid, 'gemini', 'gemini-2.5-pro', 'success', 2.50, '1910ca00-0000-4000-8000-0000000000a1', now()),
  (current_setting('cap.team')::uuid, 'voyage', 'voyage-3-large', 'success', null, '1910ca00-0000-4000-8000-0000000000a1', now()),
  (current_setting('cap.team')::uuid, 'gemini', 'gemini-2.5-pro', 'success', 9.00, '1910ca00-0000-4000-8000-0000000000a1', now() - interval '1 day');

-- Rows the run lock would refuse, written past it: a usage row on an
-- external run and one with no run must not count even if they exist
set local session_replication_role = replica;
insert into public.llm_usage_analytics (account_id, llm_provider, llm_model, status, total_cost, run_id) values
  (current_setting('cap.team')::uuid, 'gemini', 'gemini-2.5-pro', 'success', 40.00, '1910ca00-0000-4000-8000-0000000000e1'),
  (current_setting('cap.team')::uuid, 'gemini', 'gemini-2.5-pro', 'success', 80.00, null);
set local session_replication_role = origin;

set local role service_role;

select is(
  (select spent_usd from public.llm_spend_since(current_setting('cap.team')::uuid, now() - interval '1 hour')),
  3.75::numeric,
  'F2 today''s spend is the priced rows of server runs: 1.25 + 2.50, not the external or run-less rows'
);

select is(
  (select row(priced_calls, unpriced_calls)::text
   from public.llm_spend_since(current_setting('cap.team')::uuid, now() - interval '1 hour')),
  '(2,1)',
  'F3 the unpriced embedding is counted apart, not as 0'
);

select is(
  (select spent_usd from public.llm_spend_since(current_setting('cap.team')::uuid, now() - interval '2 days')),
  12.75::numeric,
  'F4 a row before the start is excluded only by the start: yesterday''s 9.00 counts from two days back'
);

select is(
  (select row(spent_usd, priced_calls, unpriced_calls)::text
   from public.llm_spend_since(makerkit.get_account_id_by_slug('storybook'), now() + interval '1 hour')),
  '(,0,0)',
  'F5 nothing since: spend is null (none priced), not 0'
);

select is(
  (select row(spent_usd, priced_calls, unpriced_calls)::text
   from public.llm_spend_since(gen_random_uuid(), now() - interval '2 days')),
  '(,0,0)',
  'F6 another account sees none of this team''s spend'
);

select is(
  (select prosecdef from pg_proc where oid = 'public.llm_spend_since(uuid, timestamptz)'::regprocedure),
  false,
  'F7 the read is SECURITY INVOKER: it opens no surface past the service role'
);

select * from finish();
rollback;
