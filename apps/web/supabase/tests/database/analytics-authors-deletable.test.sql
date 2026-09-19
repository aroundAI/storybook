begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(3);

-- FILM-1610 review, round 3. The analytics tables' `created_by` referenced
-- auth.users with no ON DELETE action, so deleting any user who had ever
-- created a tag failed on the constraint. The row belongs to
-- the account, not to its author: deleting the author must succeed and
-- leave the row with no author. (analytics_experiments is covered in
-- experiments-integrity.test.sql. hook_tests was covered here until Hook
-- Lab was removed; FILM-CC-04 KB-10.)

select tests.create_supabase_user('author', 'analytics-author@storybook.dev');

set local role postgres;

select set_config('aa.story', makerkit.get_account_id_by_slug('storybook')::text, true);
select set_config('aa.author', tests.get_supabase_uid('author')::text, true);

insert into public.content_tags (id, account_id, dimension, slug, label, created_by)
  values ('b3b3b3b3-0000-4000-8000-000000000011', current_setting('aa.story')::uuid,
          'topic', 'authors-test', 'Authors test', current_setting('aa.author')::uuid);

select lives_ok(
  $$ delete from auth.users where id = current_setting('aa.author')::uuid $$,
  'A user who created a tag can be deleted'
);

select is(
  (select created_by from public.content_tags where id = 'b3b3b3b3-0000-4000-8000-000000000011'),
  null,
  'The tag stays, with no author'
);

select is(
  (select count(*)::int from public.content_tags where id = 'b3b3b3b3-0000-4000-8000-000000000011'),
  1,
  'Deleting the author did not delete the tag'
);

select * from finish();

rollback;
