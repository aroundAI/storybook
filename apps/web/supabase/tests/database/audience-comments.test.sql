begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(24);

-- FILM-1733. The audience comments on a team's videos (audience_comments),
-- their labels (comment_labels), where each video's sync reached
-- (audience_comment_syncs), and the functions the labellers read.
--
-- Foreign ids are stashed with set_config while still postgres, because
-- makerkit.get_account_id_by_slug answers NULL for an account the caller
-- cannot see (revenue-records-rls.test.sql).

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');

select tests.create_supabase_user('ac_outsider', 'ac-outsider@storybook.dev');
select makerkit.authenticate_as('ac_outsider');
select public.create_team_account('Comments Other Co');

set local role postgres;

select set_config('ac.story', makerkit.get_account_id_by_slug('storybook')::text, true);
select set_config('ac.other', makerkit.get_account_id_by_slug('comments-other-co')::text, true);

insert into public.platform_connections (id, account_id, platform, platform_account_name)
values
  ('17330000-0000-4000-8000-0000000000c1', current_setting('ac.story')::uuid, 'youtube', 'Story Channel'),
  ('17330000-0000-4000-8000-0000000000c2', current_setting('ac.other')::uuid, 'youtube', 'Other Channel');

insert into public.projects (id, account_id, name, slug)
values
  ('17330000-0000-4000-8000-0000000000a1', current_setting('ac.story')::uuid, 'Comments probe', 'comments-probe'),
  ('17330000-0000-4000-8000-0000000000a2', current_setting('ac.other')::uuid, 'Other probe', 'other-probe');

insert into public.episodes (id, project_id, number, title)
values
  ('17330000-0000-4000-8000-0000000000e1', '17330000-0000-4000-8000-0000000000a1', 1, 'Ep 1'),
  ('17330000-0000-4000-8000-0000000000e2', '17330000-0000-4000-8000-0000000000a2', 1, 'Ep 1');

insert into public.publishes
  (id, episode_id, platform_connection_id, platform, status, platform_content_id, published_at)
values
  ('17330000-0000-4000-8000-0000000000f1', '17330000-0000-4000-8000-0000000000e1',
   '17330000-0000-4000-8000-0000000000c1', 'youtube', 'published', 'vid-story', now()),
  ('17330000-0000-4000-8000-0000000000f2', '17330000-0000-4000-8000-0000000000e2',
   '17330000-0000-4000-8000-0000000000c2', 'youtube', 'published', 'vid-other', now());

-- What the sync writes, as the service role
set local role service_role;

insert into public.audience_comments
  (id, account_id, platform_connection_id, publish_id, platform, platform_comment_id, text, commented_at)
values
  ('17330000-0000-4000-8000-000000000101', current_setting('ac.story')::uuid,
   '17330000-0000-4000-8000-0000000000c1', '17330000-0000-4000-8000-0000000000f1',
   'youtube', 'yt-1', 'Loved the ending, part 2 please', now()),
  ('17330000-0000-4000-8000-000000000102', current_setting('ac.story')::uuid,
   '17330000-0000-4000-8000-0000000000c1', '17330000-0000-4000-8000-0000000000f1',
   'youtube', 'yt-2', 'Too slow in the middle', now()),
  ('17330000-0000-4000-8000-000000000201', current_setting('ac.other')::uuid,
   '17330000-0000-4000-8000-0000000000c2', '17330000-0000-4000-8000-0000000000f2',
   'youtube', 'yt-3', 'Another team''s comment', now());

select throws_ok(
  $$ insert into public.audience_comments
       (account_id, platform_connection_id, publish_id, platform, platform_comment_id, text, commented_at)
     values (current_setting('ac.story')::uuid, '17330000-0000-4000-8000-0000000000c1',
             '17330000-0000-4000-8000-0000000000f1', 'youtube', 'yt-1', 'again', now()) $$,
  '23505', null,
  'a platform''s comment is stored once'
);

select throws_ok(
  $$ insert into public.audience_comments
       (account_id, platform_connection_id, publish_id, platform, platform_comment_id, text, commented_at)
     values (current_setting('ac.story')::uuid, '17330000-0000-4000-8000-0000000000c2',
             '17330000-0000-4000-8000-0000000000f1', 'youtube', 'yt-x', 'x', now()) $$,
  '23503', null,
  'a comment cannot name one team and another team''s channel'
);

select throws_ok(
  $$ insert into public.audience_comments
       (account_id, platform_connection_id, publish_id, platform, platform_comment_id, text, commented_at)
     values (current_setting('ac.story')::uuid, '17330000-0000-4000-8000-0000000000c1',
             '17330000-0000-4000-8000-0000000000f1', 'tiktok', 'tt-1', 'x', now()) $$,
  '23514', null,
  'only platforms whose comments can be read are stored'
);

-- ==================================
-- Who reads and writes comments
-- ==================================

select makerkit.authenticate_as('member');

select results_eq(
  $$ select platform_comment_id from public.audience_comments order by platform_comment_id $$,
  $$ values ('yt-1'::text), ('yt-2'::text) $$,
  'a member reads the team''s comments, and no other team''s'
);

select throws_ok(
  $$ insert into public.audience_comments
       (account_id, platform_connection_id, publish_id, platform, platform_comment_id, text, commented_at)
     values (current_setting('ac.story')::uuid, '17330000-0000-4000-8000-0000000000c1',
             '17330000-0000-4000-8000-0000000000f1', 'youtube', 'yt-9', 'planted', now()) $$,
  '42501', null,
  'a person cannot write a comment: only the sync does'
);

select throws_ok(
  $$ update public.audience_comments set text = 'edited'
      where id = '17330000-0000-4000-8000-000000000101' $$,
  '42501', null,
  'nor change one'
);

select throws_ok(
  $$ delete from public.audience_comments
      where id = '17330000-0000-4000-8000-000000000101' $$,
  '42501', null,
  'nor delete one'
);

-- ==================================
-- Labels
-- ==================================

select lives_ok(
  $$ insert into public.comment_labels
       (comment_id, account_id, sentiment, topics, source, model, prompt_version)
     values ('17330000-0000-4000-8000-000000000101', current_setting('ac.story')::uuid,
             'positive', '{story,wants_more}', 'mcp', 'claude-opus-5-5', 'desk-1') $$,
  'a member labels the team''s comment, as their AI over MCP does'
);

select lives_ok(
  $$ update public.comment_labels set sentiment = 'neutral'
      where comment_id = '17330000-0000-4000-8000-000000000101' $$,
  'and relabels it'
);

select throws_ok(
  $$ insert into public.comment_labels
       (comment_id, account_id, sentiment, topics, source, model, prompt_version)
     values ('17330000-0000-4000-8000-000000000201', current_setting('ac.other')::uuid,
             'negative', '{}', 'mcp', 'm', '1') $$,
  '42501', null,
  'not another team''s comment'
);

set local role postgres;

select throws_ok(
  $$ insert into public.comment_labels
       (comment_id, account_id, sentiment, topics, source, model, prompt_version)
     values ('17330000-0000-4000-8000-000000000201', current_setting('ac.story')::uuid,
             'negative', '{}', 'mcp', 'm', '1') $$,
  '23503', null,
  'a label names its comment''s own team, even as postgres'
);

select makerkit.authenticate_as('member');

select throws_ok(
  $$ insert into public.comment_labels
       (comment_id, account_id, sentiment, topics, source, model, prompt_version)
     values ('17330000-0000-4000-8000-000000000102', current_setting('ac.story')::uuid,
             'negative', '{boring}', 'mcp', 'm', '1') $$,
  '23514', null,
  'a topic comes from the closed list'
);

select throws_ok(
  $$ insert into public.comment_labels
       (comment_id, account_id, sentiment, topics, source, model, prompt_version)
     values ('17330000-0000-4000-8000-000000000102', current_setting('ac.story')::uuid,
             'furious', '{pacing}', 'mcp', 'm', '1') $$,
  '23514', null,
  'so does a sentiment'
);

select makerkit.authenticate_as('ac_outsider');

select is_empty(
  $$ select 1 from public.comment_labels
      where comment_id = '17330000-0000-4000-8000-000000000101' $$,
  'another team does not see the label'
);

select is_empty(
  $$ delete from public.comment_labels
      where comment_id = '17330000-0000-4000-8000-000000000101' returning 1 $$,
  'nor remove it'
);

-- ==================================
-- What the labellers read
-- ==================================

select makerkit.authenticate_as('member');

select results_eq(
  $$ select id from public.unlabelled_audience_comments(current_setting('ac.story')::uuid) $$,
  $$ values ('17330000-0000-4000-8000-000000000102'::uuid) $$,
  'the unlabelled list is the team''s comments that have no label'
);

select is_empty(
  $$ select 1 from public.unlabelled_audience_comments(current_setting('ac.other')::uuid) $$,
  'and asked for another team, it is empty: RLS decides'
);

select throws_ok(
  $$ select * from public.projects_with_unlabelled_comments() $$,
  '42501', null,
  'a person cannot call the sync''s list of projects to label'
);

set local role service_role;

select results_eq(
  $$ select account_id, project_id from public.projects_with_unlabelled_comments()
      where account_id in (current_setting('ac.story')::uuid, current_setting('ac.other')::uuid)
      order by project_id $$,
  $$ values (current_setting('ac.story')::uuid, '17330000-0000-4000-8000-0000000000a1'::uuid),
            (current_setting('ac.other')::uuid, '17330000-0000-4000-8000-0000000000a2'::uuid) $$,
  'the sync sees each project with an unlabelled comment, once'
);

-- ==================================
-- Sync records, and deletion
-- ==================================

insert into public.audience_comment_syncs (publish_id, account_id, last_status, last_synced_at)
values ('17330000-0000-4000-8000-0000000000f1', current_setting('ac.story')::uuid, 'ok', now());

select makerkit.authenticate_as('member');

select is(
  (select last_status from public.audience_comment_syncs
    where publish_id = '17330000-0000-4000-8000-0000000000f1'),
  'ok',
  'a member reads where the video''s sync reached'
);

select throws_ok(
  $$ update public.audience_comment_syncs set last_status = 'failed' $$,
  '42501', null,
  'and cannot change it'
);

set local role service_role;

select is(
  public.purge_connection_vendor_rows('17330000-0000-4000-8000-0000000000c1')
    -> 'audience_comments',
  '2'::jsonb,
  'purging the channel removes its comments'
);

select is(
  (select count(*)::int from public.comment_labels
    where account_id = current_setting('ac.story')::uuid),
  0,
  'their labels go with them'
);

select is(
  (select count(*)::int from public.audience_comments
    where account_id = current_setting('ac.other')::uuid),
  1,
  'and nothing of another channel''s'
);

select * from finish();

rollback;
