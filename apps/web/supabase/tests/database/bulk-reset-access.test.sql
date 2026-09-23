begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- KB-27 (sibling). A fixed plan, so a truncated run fails as a plan mismatch.
select plan(16);

-- bulk_reset_episodes_to_stage is SECURITY DEFINER and deletes story,
-- screenplay, shots, audio and canon. Before KB-27 it checked only that the
-- episodes belonged to the account the caller *named*, never that the caller
-- could act for it, and that check skipped soft-deleted episodes while the
-- deletes did not. Both were reproduced as a second user over PostgREST.
--
-- The rule: every listed episode (soft-deleted or not) must be in a project
-- of p_account_id that the caller can write (public.can_write_project).
--
-- Fixtures:
--   T   team of kb27b_owner; project P (owner row from the creator trigger).
--       kb27b_member is a project member; kb27b_teammate has an account role
--       and no project row. E1 is live with a story and a canon event; E2 is
--       soft-deleted with a canon event.
--   S   kb27b_solo's personal project, episode F with a canon event.
--   kb27b_stranger has only a personal account.
--
-- Each call's result is stashed with set_config and read back as postgres.

select tests.create_supabase_user('kb27b_owner', 'kb27b-owner@storybook.dev');
select tests.create_supabase_user('kb27b_member', 'kb27b-member@storybook.dev');
select tests.create_supabase_user('kb27b_teammate', 'kb27b-teammate@storybook.dev');
select tests.create_supabase_user('kb27b_solo', 'kb27b-solo@storybook.dev');
select tests.create_supabase_user('kb27b_stranger', 'kb27b-stranger@storybook.dev');

select makerkit.authenticate_as('kb27b_owner');
set local role postgres;

insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
values ('27280000-0000-4000-8000-00000000000a', 'KB-27 reset team', false, tests.get_supabase_uid('kb27b_owner'));

insert into public.projects (id, account_id, name, status)
values ('27280000-0000-4000-8000-000000000001', '27280000-0000-4000-8000-00000000000a', 'KB-27 reset P', 'active');

select makerkit.authenticate_as('kb27b_solo');
set local role postgres;

insert into public.projects (id, account_id, name, status)
values ('27280000-0000-4000-8000-000000000005', tests.get_supabase_uid('kb27b_solo'), 'KB-27 reset S', 'active');

insert into public.accounts_memberships (user_id, account_id, account_role)
values
  (tests.get_supabase_uid('kb27b_member'), '27280000-0000-4000-8000-00000000000a', 'member'),
  (tests.get_supabase_uid('kb27b_teammate'), '27280000-0000-4000-8000-00000000000a', 'member');

insert into public.project_members (project_id, user_id, role)
values ('27280000-0000-4000-8000-000000000001', tests.get_supabase_uid('kb27b_member'), 'member');

insert into public.episodes (id, project_id, number, title, story_data, deleted_at)
values
  ('27280000-0000-4000-8000-000000000002', '27280000-0000-4000-8000-000000000001', 1, 'E1', '{"fullStory": "the real story"}', null),
  ('27280000-0000-4000-8000-000000000003', '27280000-0000-4000-8000-000000000001', 2, 'E2', null, now()),
  ('27280000-0000-4000-8000-000000000006', '27280000-0000-4000-8000-000000000005', 1, 'F', '{"fullStory": "solo"}', null);

insert into public.immutable_events (project_id, event_type, event_key, established_in, season, episode_number, description)
values
  ('27280000-0000-4000-8000-000000000001', 'death', 'e1:canon', '27280000-0000-4000-8000-000000000002', 1, 1, 'E1 canon'),
  ('27280000-0000-4000-8000-000000000001', 'death', 'e2:canon', '27280000-0000-4000-8000-000000000003', 1, 2, 'E2 canon'),
  ('27280000-0000-4000-8000-000000000005', 'death', 'f:canon', '27280000-0000-4000-8000-000000000006', 1, 1, 'F canon');

create or replace function pg_temp.result() returns jsonb language sql as $$
  select current_setting('kb27.result')::jsonb;
$$;

create or replace function pg_temp.events(p_key text) returns bigint language sql as $$
  select count(*) from public.immutable_events where event_key = p_key;
$$;

create or replace function pg_temp.e1_story() returns jsonb language sql as $$
  select story_data from public.episodes where id = '27280000-0000-4000-8000-000000000002';
$$;

-- ==================================
-- B1: a stranger names the victim's account
-- ==================================
select makerkit.authenticate_as('kb27b_stranger');
select set_config('kb27.result', public.bulk_reset_episodes_to_stage(
  array['27280000-0000-4000-8000-000000000002']::uuid[], 'draft', '27280000-0000-4000-8000-00000000000a')::text, true);

set local role postgres;
select is(pg_temp.result()->>'reset_count', '0', 'B1: a stranger resets nothing');
select is(jsonb_array_length(pg_temp.result()->'errors'), 1, 'B1: and is told so');
select isnt(pg_temp.e1_story(), null, 'B1: the story survives');
select is(pg_temp.events('e1:canon'), 1::bigint, 'B1: the canon event survives');

-- ==================================
-- B2: a stranger names their OWN account, with a soft-deleted victim episode
-- ==================================
select makerkit.authenticate_as('kb27b_stranger');
select set_config('kb27.result', public.bulk_reset_episodes_to_stage(
  array['27280000-0000-4000-8000-000000000003']::uuid[], 'draft', tests.get_supabase_uid('kb27b_stranger'))::text, true);

set local role postgres;
select is(pg_temp.result()->>'reset_count', '0', 'B2: nothing is reset');
select is(jsonb_array_length(pg_temp.result()->'errors'), 1, 'B2: a soft-deleted episode of another account is refused');
select is(pg_temp.events('e2:canon'), 1::bigint, 'B2: its canon event survives');

-- ==================================
-- B5: a team member with no project row (owner's decision: refused)
-- ==================================
select makerkit.authenticate_as('kb27b_teammate');
select set_config('kb27.result', public.bulk_reset_episodes_to_stage(
  array['27280000-0000-4000-8000-000000000002']::uuid[], 'draft', '27280000-0000-4000-8000-00000000000a')::text, true);

set local role postgres;
select is(jsonb_array_length(pg_temp.result()->'errors'), 1, 'B5: a role on the account without a project row is refused');
select is(pg_temp.events('e1:canon'), 1::bigint, 'B5: the canon event survives');

-- ==================================
-- B6: a project writer naming a different account than the episode's
-- ==================================
select makerkit.authenticate_as('kb27b_member');
select set_config('kb27.result', public.bulk_reset_episodes_to_stage(
  array['27280000-0000-4000-8000-000000000002']::uuid[], 'draft', tests.get_supabase_uid('kb27b_member'))::text, true);

set local role postgres;
select is(jsonb_array_length(pg_temp.result()->'errors'), 1, 'B6: an episode outside the named account is refused');

-- ==================================
-- B3: a project member resets their own episode
-- ==================================
select makerkit.authenticate_as('kb27b_member');
select set_config('kb27.result', public.bulk_reset_episodes_to_stage(
  array['27280000-0000-4000-8000-000000000002']::uuid[], 'draft', '27280000-0000-4000-8000-00000000000a')::text, true);

set local role postgres;
select is(pg_temp.result()->>'reset_count', '1', 'B3: a project member resets the episode');
select is(jsonb_array_length(pg_temp.result()->'errors'), 0, 'B3: with no errors');
select is(pg_temp.e1_story(), null, 'B3: the story is cleared');
select is(pg_temp.events('e1:canon'), 0::bigint, 'B3: the episode''s canon is removed');

-- ==================================
-- B4: a personal-account owner resets their own episode
-- ==================================
select makerkit.authenticate_as('kb27b_solo');
select set_config('kb27.result', public.bulk_reset_episodes_to_stage(
  array['27280000-0000-4000-8000-000000000006']::uuid[], 'draft', tests.get_supabase_uid('kb27b_solo'))::text, true);

set local role postgres;
select is(pg_temp.result()->>'reset_count', '1', 'B4: a personal-account owner resets their own episode');
select is(pg_temp.events('f:canon'), 0::bigint, 'B4: its canon is removed');

select * from finish();

rollback;
