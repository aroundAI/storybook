begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(32);

-- FILM-CC-04 KB-18. Verifying or disputing a fact goes through
-- public.set_fact_verification, the only end-user path into those states.
-- The member UPDATE policy is deliberately unchanged, and is asserted here too.
--
-- Every case works on its own fact, so no case depends on another having
-- succeeded or failed.
--
--   f01..f05  reviewed successfully
--   f06, f11-f14  each refused to one user who may not review; must end unchanged
--   f07       direct UPDATEs through the policy
--   f08       retracted
--   f09       bad input
--   f10       a verified fact whose claim a member then edits

select tests.create_supabase_user('kb18_owner', 'kb18-owner@storybook.dev');
select tests.create_supabase_user('kb18_admin', 'kb18-admin@storybook.dev');
select tests.create_supabase_user('kb18_member', 'kb18-member@storybook.dev');
select tests.create_supabase_user('kb18_viewer', 'kb18-viewer@storybook.dev');
select tests.create_supabase_user('kb18_offproject', 'kb18-offproject@storybook.dev');
select tests.create_supabase_user('kb18_stranger', 'kb18-stranger@storybook.dev');

-- Authenticated first so the project's created_by, and so its owner
-- membership (add_project_owner), is kb18_owner.
select makerkit.authenticate_as('kb18_owner');
set local role postgres;

select set_config('t.team', makerkit.get_account_id_by_slug('storybook')::text, true);
select set_config('t.owner', tests.get_supabase_uid('kb18_owner')::text, true);
select set_config('t.admin', tests.get_supabase_uid('kb18_admin')::text, true);
select set_config('t.member', tests.get_supabase_uid('kb18_member')::text, true);

update public.accounts set name = 'Olive Owner' where id = current_setting('t.owner')::uuid;
update public.accounts set name = 'Adam Admin' where id = current_setting('t.admin')::uuid;

-- kb18_offproject owns the account but is on no project: they can read the
-- facts (SELECT is account-scoped) and must still not review them.
insert into public.accounts_memberships (user_id, account_id, account_role) values
  (current_setting('t.owner')::uuid, current_setting('t.team')::uuid, 'member'),
  (current_setting('t.admin')::uuid, current_setting('t.team')::uuid, 'member'),
  (current_setting('t.member')::uuid, current_setting('t.team')::uuid, 'member'),
  (tests.get_supabase_uid('kb18_viewer'), current_setting('t.team')::uuid, 'member'),
  (tests.get_supabase_uid('kb18_offproject'), current_setting('t.team')::uuid, 'owner');

insert into public.projects (id, account_id, name, status)
  values ('e2e2e2e2-0000-4000-8000-000000000001', current_setting('t.team')::uuid,
          'KB-18 review project', 'active');

insert into public.project_members (project_id, user_id, role) values
  ('e2e2e2e2-0000-4000-8000-000000000001', current_setting('t.admin')::uuid, 'admin'),
  ('e2e2e2e2-0000-4000-8000-000000000001', current_setting('t.member')::uuid, 'member'),
  ('e2e2e2e2-0000-4000-8000-000000000001', tests.get_supabase_uid('kb18_viewer'), 'viewer');

insert into public.verified_facts (id, project_id, claim, source_type)
select ('e2e2e2e2-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'e2e2e2e2-0000-4000-8000-000000000001', 'KB-18 fact ' || n, 'textbook'
  from generate_series(1, 14) n;

-- Written directly with the triggers off: states the review path cannot
-- reach, to start cases from.
alter table public.verified_facts disable trigger user;
update public.verified_facts set verification_status = 'pending_review'
 where id = 'e2e2e2e2-0000-4000-8000-000000000005';
update public.verified_facts set verification_status = 'retracted'
 where id = 'e2e2e2e2-0000-4000-8000-000000000008';
alter table public.verified_facts enable trigger user;

select is(
  (select role::text from public.project_members
    where project_id = 'e2e2e2e2-0000-4000-8000-000000000001'
      and user_id = current_setting('t.owner')::uuid),
  'owner', 'setup: the project''s creator is its owner');

-- ----------------------------------
-- Owners and admins can review
-- ----------------------------------
select makerkit.authenticate_as('kb18_owner');

select is(
  public.set_fact_verification('e2e2e2e2-0000-4000-8000-000000000001', 'verified', '  Checked  ')::text,
  'verified', 'the project owner verifies a fact');

set local role postgres;

select is(
  (select verification_status::text from public.verified_facts where id = 'e2e2e2e2-0000-4000-8000-000000000001'),
  'verified', 'the fact is stored as verified');
select is(
  (select verified_by from public.verified_facts where id = 'e2e2e2e2-0000-4000-8000-000000000001'),
  current_setting('t.owner')::uuid, 'verified_by is the caller');
select is(
  (select verified_by_name from public.verified_facts where id = 'e2e2e2e2-0000-4000-8000-000000000001'),
  'Olive Owner', 'the verifier''s name is kept beside the key (KB-1 snapshot still fires)');
select is(
  (select updated_by from public.verified_facts where id = 'e2e2e2e2-0000-4000-8000-000000000001'),
  current_setting('t.owner')::uuid, 'updated_by is the caller');
select ok(
  (select verified_at is not null and verification_notes = 'Checked'
     from public.verified_facts where id = 'e2e2e2e2-0000-4000-8000-000000000001'),
  'verified_at is set and the note is stored trimmed');

select makerkit.authenticate_as('kb18_admin');

select lives_ok(
  $$ select public.set_fact_verification('e2e2e2e2-0000-4000-8000-000000000002', 'verified') $$,
  'a project admin verifies a fact');
select lives_ok(
  $$ select public.set_fact_verification('e2e2e2e2-0000-4000-8000-000000000004', 'disputed', 'Source is a blog') $$,
  'a project admin disputes a fact');

select makerkit.authenticate_as('kb18_owner');

select lives_ok(
  $$ select public.set_fact_verification('e2e2e2e2-0000-4000-8000-000000000003', 'disputed', 'Wrong year') $$,
  'the project owner disputes a fact');
select lives_ok(
  $$ select public.set_fact_verification('e2e2e2e2-0000-4000-8000-000000000005', 'verified') $$,
  'a pending_review fact can be verified');

set local role postgres;

select is(
  (select verification_status::text || '|' || coalesce(verified_by::text, '') || '|' || coalesce(verified_by_name, '')
     from public.verified_facts where id = 'e2e2e2e2-0000-4000-8000-000000000002'),
  'verified|' || current_setting('t.admin') || '|Adam Admin',
  'the admin''s verification is theirs');
select is(
  (select verification_status::text || '|' || verification_notes || '|' || coalesce(verified_by::text, '')
          || '|' || coalesce(verified_at::text, '') || '|' || coalesce(verified_by_name, '')
     from public.verified_facts where id = 'e2e2e2e2-0000-4000-8000-000000000003'),
  'disputed|Wrong year|||',
  'a dispute stores the reason and names no verifier');
select is(
  (select verification_status::text from public.verified_facts where id = 'e2e2e2e2-0000-4000-8000-000000000004'),
  'disputed', 'the admin''s dispute is stored');

-- ----------------------------------
-- Nobody else can
-- ----------------------------------
select makerkit.authenticate_as('kb18_member');

select throws_ok(
  $$ select public.set_fact_verification('e2e2e2e2-0000-4000-8000-000000000006', 'verified') $$,
  '42501', null, 'a project member cannot verify');
select throws_ok(
  $$ select public.set_fact_verification('e2e2e2e2-0000-4000-8000-000000000011', 'disputed', 'no') $$,
  '42501', null, 'a project member cannot dispute');

select makerkit.authenticate_as('kb18_viewer');

select throws_ok(
  $$ select public.set_fact_verification('e2e2e2e2-0000-4000-8000-000000000012', 'verified') $$,
  '42501', null, 'a project viewer cannot verify');

select makerkit.authenticate_as('kb18_offproject');

select throws_ok(
  $$ select public.set_fact_verification('e2e2e2e2-0000-4000-8000-000000000013', 'verified') $$,
  '42501', null, 'an account owner who is not on the project cannot verify');

-- A stranger gets the answer a missing fact gets: nothing to learn about
-- another account's facts.
select makerkit.authenticate_as('kb18_stranger');

select throws_ok(
  $$ select public.set_fact_verification('e2e2e2e2-0000-4000-8000-000000000014', 'verified') $$,
  'P0002', 'Fact not found', 'a user from another account is told the fact does not exist');

select makerkit.authenticate_as('kb18_owner');

select throws_ok(
  $$ select public.set_fact_verification(gen_random_uuid(), 'verified') $$,
  'P0002', 'Fact not found', 'a fact that does not exist is not found');

-- Asked of the grant itself: here anon is already stopped at the schema, which
-- would hide a grant made to it by mistake.
set local role postgres;

select ok(
  not has_function_privilege('anon', 'public.set_fact_verification'::regproc, 'execute')
  and not has_function_privilege('public', 'public.set_fact_verification'::regproc, 'execute')
  and has_function_privilege('authenticated', 'public.set_fact_verification'::regproc, 'execute'),
  'only signed-in users may call it; anon and public may not');

select is(
  (select string_agg(verification_status::text || '|' || coalesce(verified_by::text, 'none'), ',' order by id)
     from public.verified_facts
    where id in ('e2e2e2e2-0000-4000-8000-000000000006', 'e2e2e2e2-0000-4000-8000-000000000011',
                 'e2e2e2e2-0000-4000-8000-000000000012', 'e2e2e2e2-0000-4000-8000-000000000013',
                 'e2e2e2e2-0000-4000-8000-000000000014')),
  'unverified|none,unverified|none,unverified|none,unverified|none,unverified|none',
  'every refused review left its fact as it was');

-- The function takes no user id: the verifier cannot be named by a caller.
select is(
  (select count(*)::int
     from pg_proc p, unnest(p.proargtypes::oid[]) as arg(t)
    where p.oid = 'public.set_fact_verification'::regproc
      and arg.t = 'uuid'::regtype),
  1, 'the only uuid the function accepts is the fact''s');

-- ----------------------------------
-- The member policy is not loosened
-- ----------------------------------
select makerkit.authenticate_as('kb18_member');

select throws_ok(
  $$ update public.verified_facts
        set verification_status = 'verified', verified_at = now(),
            verified_by = current_setting('t.owner')::uuid
      where id = 'e2e2e2e2-0000-4000-8000-000000000007' $$,
  '42501', null, 'a member cannot self-verify by a direct UPDATE, in anyone''s name');

select makerkit.authenticate_as('kb18_owner');

select throws_ok(
  $$ update public.verified_facts
        set verification_status = 'verified', verified_at = now(), verified_by = auth.uid()
      where id = 'e2e2e2e2-0000-4000-8000-000000000007' $$,
  '42501', null, 'the owner cannot verify by a direct UPDATE either: the function is the only path');

-- ----------------------------------
-- Only unverified and pending_review facts are reviewed
-- ----------------------------------
select throws_ok(
  $$ select public.set_fact_verification('e2e2e2e2-0000-4000-8000-000000000001', 'disputed', 'changed my mind') $$,
  '55000', 'Fact is already verified', 'a verified fact cannot be disputed from a stale page');
select throws_ok(
  $$ select public.set_fact_verification('e2e2e2e2-0000-4000-8000-000000000003', 'verified') $$,
  '55000', 'Fact is already disputed', 'a disputed fact cannot be verified from a stale page');
select throws_ok(
  $$ select public.set_fact_verification('e2e2e2e2-0000-4000-8000-000000000008', 'verified') $$,
  '55000', 'Fact is already retracted', 'a retracted fact cannot be reviewed');

select throws_ok(
  $$ select public.set_fact_verification('e2e2e2e2-0000-4000-8000-000000000009', 'disputed', '   ') $$,
  '22023', 'A reason is required to dispute a fact', 'a dispute needs a reason');
select throws_ok(
  $$ select public.set_fact_verification('e2e2e2e2-0000-4000-8000-000000000009', 'retracted', 'gone') $$,
  '22023', 'A review can only verify or dispute a fact', 'a review cannot retract');

-- ----------------------------------
-- The existing rules still compose with a real verification
-- ----------------------------------
select lives_ok(
  $$ select public.set_fact_verification('e2e2e2e2-0000-4000-8000-000000000010', 'verified') $$,
  'setup: the owner verifies f10');

select makerkit.authenticate_as('kb18_member');

update public.verified_facts set claim = 'KB-18 fact 10, reworded'
 where id = 'e2e2e2e2-0000-4000-8000-000000000010';

set local role postgres;

select is(
  (select verification_status::text || '|' || coalesce(verified_by_name, 'no name')
     from public.verified_facts where id = 'e2e2e2e2-0000-4000-8000-000000000010'),
  'unverified|no name',
  'editing the claim of a verified fact still resets it, name and all');

select * from finish();

rollback;
