begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(5);

-- KB-93. `experiment_tags_create` checked access to the experiment only, so
-- a user in two accounts could link one account's tag to the other's
-- experiment — reproduced through RLS on 2026-09-24. The same hole
-- `experiment_publishes` had (FILM-1610 review, B5); the table now refuses
-- it the same way. The user in both accounts is the case that matters: RLS
-- lets them see both tags, so only the policy can tell them apart.

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');

select tests.create_supabase_user('other_owner', 'other-owner@storybook.dev');
select makerkit.authenticate_as('other_owner');
select public.create_team_account('Other Co');

set local role postgres;

select set_config('et.story', makerkit.get_account_id_by_slug('storybook')::text, true);
select set_config('et.other', makerkit.get_account_id_by_slug('other-co')::text, true);

-- `member` belongs to both teams.
insert into public.accounts_memberships (user_id, account_id, account_role)
  values (tests.get_supabase_uid('member'), current_setting('et.other')::uuid, 'member');

insert into public.content_tags (id, account_id, dimension, slug, label)
  values ('e7e7e7e7-0000-4000-8000-000000000001', current_setting('et.story')::uuid, 'topic', 'own', 'Own tag'),
         ('e7e7e7e7-0000-4000-8000-000000000002', current_setting('et.other')::uuid, 'topic', 'foreign', 'Foreign tag');

insert into public.analytics_experiments (id, account_id, title, change_description)
  values ('e7e7e7e7-0000-4000-8000-000000000031', current_setting('et.story')::uuid, 'Story change', 'x');

select makerkit.authenticate_as('member');

select results_eq(
  $$ select count(*)::int from public.content_tags
      where id in ('e7e7e7e7-0000-4000-8000-000000000001',
                   'e7e7e7e7-0000-4000-8000-000000000002') $$,
  array[2],
  'The member can see both tags, so only the policy can refuse the foreign one'
);

select lives_ok(
  $$ insert into public.experiment_tags (experiment_id, tag_id)
     values ('e7e7e7e7-0000-4000-8000-000000000031', 'e7e7e7e7-0000-4000-8000-000000000001') $$,
  'A tag from the experiment''s own account can be linked'
);

select throws_ok(
  $$ insert into public.experiment_tags (experiment_id, tag_id)
     values ('e7e7e7e7-0000-4000-8000-000000000031', 'e7e7e7e7-0000-4000-8000-000000000002') $$,
  '42501',
  null,
  'A tag from another account cannot be linked, even by someone in both'
);

select results_eq(
  $$ select tag_id from public.experiment_tags
      where experiment_id = 'e7e7e7e7-0000-4000-8000-000000000031' $$,
  array['e7e7e7e7-0000-4000-8000-000000000001'::uuid],
  'Only the own-account link exists'
);

select tests.create_supabase_user('stranger', 'stranger@storybook.dev');
select makerkit.authenticate_as('stranger');

select throws_ok(
  $$ insert into public.experiment_tags (experiment_id, tag_id)
     values ('e7e7e7e7-0000-4000-8000-000000000031', 'e7e7e7e7-0000-4000-8000-000000000001') $$,
  '42501',
  null,
  'Someone outside the account cannot link to its experiment'
);

select * from finish();

rollback;
