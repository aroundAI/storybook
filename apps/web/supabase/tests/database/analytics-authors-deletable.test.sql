begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(4);

-- FILM-1610 review, round 3. The analytics tables' `created_by` referenced
-- auth.users with no ON DELETE action, so deleting any user who had ever
-- created a tag or a hook test failed on the constraint. The row belongs to
-- the account, not to its author: deleting the author must succeed and
-- leave the row with no author. (analytics_experiments is covered in
-- experiments-integrity.test.sql.)

select tests.create_supabase_user('author', 'analytics-author@storybook.dev');

set local role postgres;

select set_config('aa.story', makerkit.get_account_id_by_slug('storybook')::text, true);
select set_config('aa.author', tests.get_supabase_uid('author')::text, true);

-- Created by the account owner: the creator trigger on projects needs an
-- auth.uid(), which inserting as postgres does not have.
select makerkit.set_identifier('primary_owner', 'test@storybook.dev');
select makerkit.authenticate_as('primary_owner');

insert into public.projects (id, account_id, name, status)
  values ('b3b3b3b3-0000-4000-8000-000000000001', current_setting('aa.story')::uuid, 'Authors', 'active');

set local role postgres;

insert into public.content_tags (id, account_id, dimension, slug, label, created_by)
  values ('b3b3b3b3-0000-4000-8000-000000000011', current_setting('aa.story')::uuid,
          'topic', 'authors-test', 'Authors test', current_setting('aa.author')::uuid);

insert into public.hook_tests (id, account_id, project_id, name, topic, created_by)
  values ('b3b3b3b3-0000-4000-8000-000000000021', current_setting('aa.story')::uuid,
          'b3b3b3b3-0000-4000-8000-000000000001', 'Hook test', 'Authors',
          current_setting('aa.author')::uuid);

select lives_ok(
  $$ delete from auth.users where id = current_setting('aa.author')::uuid $$,
  'A user who created a tag and a hook test can be deleted'
);

select is(
  (select created_by from public.content_tags where id = 'b3b3b3b3-0000-4000-8000-000000000011'),
  null,
  'The tag stays, with no author'
);

select is(
  (select created_by from public.hook_tests where id = 'b3b3b3b3-0000-4000-8000-000000000021'),
  null,
  'The hook test stays, with no author'
);

select is(
  (select count(*)::int from public.content_tags where id = 'b3b3b3b3-0000-4000-8000-000000000011'),
  1,
  'Deleting the author did not delete the tag'
);

select * from finish();

rollback;
