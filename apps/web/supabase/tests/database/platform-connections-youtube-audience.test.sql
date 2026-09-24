begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- KB-30. Every YouTube upload declared "not made for kids" and category 22,
-- values nobody chose. The creator's declaration now lives on the channel,
-- and "not declared" is a real state (NULL) that makes the product ask. These
-- tests hold the parts the database is responsible for: no default, YouTube
-- rows only, members of the channel's account can set it and nobody else can,
-- and a reconnect does not erase it.
select plan(16);

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');

select tests.create_supabase_user('outsider', 'outsider-kb30@storybook.dev');
select makerkit.authenticate_as('outsider');
select public.create_team_account('KB30 Other Co');

set local role postgres;

select set_config('kb.story', makerkit.get_account_id_by_slug('storybook')::text, true);

insert into public.platform_connections
  (id, account_id, platform, platform_account_id, platform_account_name, access_token_encrypted)
values
  ('30303030-0000-4000-8000-00000000000a', current_setting('kb.story')::uuid, 'youtube',
   'UC-kb30-A', 'Acme Kids', 'enc-access-a'),
  ('30303030-0000-4000-8000-0000000000c1', current_setting('kb.story')::uuid, 'tiktok',
   'tt-kb30', 'acme.tt', 'enc-access-tt');

-- 1. The columns exist, are nullable and have no default: "not declared" is
--    the starting state, never an answer the product picked.
select has_column('public', 'platform_connections', 'youtube_made_for_kids', 'audience column exists');
select has_column('public', 'platform_connections', 'youtube_category_id', 'category column exists');
select col_is_null('public', 'platform_connections', 'youtube_made_for_kids', 'audience is nullable');
select col_is_null('public', 'platform_connections', 'youtube_category_id', 'category is nullable');
select col_hasnt_default('public', 'platform_connections', 'youtube_made_for_kids', 'audience has no default');
select col_hasnt_default('public', 'platform_connections', 'youtube_category_id', 'category has no default');

select is(
  (select row(youtube_made_for_kids, youtube_category_id)::text
     from public.platform_connections where id = '30303030-0000-4000-8000-00000000000a'),
  row(null::boolean, null::text)::text,
  'a new YouTube connection starts undeclared'
);

-- 2. Only YouTube channels carry a YouTube declaration, and a category is an id.
select throws_ok(
  $$ update public.platform_connections set youtube_made_for_kids = true
      where id = '30303030-0000-4000-8000-0000000000c1' $$,
  '23514', null,
  'a TikTok connection cannot carry a YouTube audience'
);
select throws_ok(
  $$ update public.platform_connections set youtube_category_id = 'Film'
      where id = '30303030-0000-4000-8000-00000000000a' $$,
  '23514', null,
  'a category must be a numeric YouTube category id'
);

-- 3. Members read and write the two columns: the grants are explicit, so a
--    move to column-level privileges on this table cannot silently drop them.
select ok(
  has_column_privilege('authenticated', 'public.platform_connections', 'youtube_made_for_kids', 'SELECT')
  and has_column_privilege('authenticated', 'public.platform_connections', 'youtube_made_for_kids', 'UPDATE'),
  'authenticated can select and update the audience'
);
select ok(
  has_column_privilege('authenticated', 'public.platform_connections', 'youtube_category_id', 'SELECT')
  and has_column_privilege('authenticated', 'public.platform_connections', 'youtube_category_id', 'UPDATE'),
  'authenticated can select and update the category'
);

-- 4. A member of the channel's account declares it.
select makerkit.authenticate_as('primary_owner');

update public.platform_connections
   set youtube_made_for_kids = true, youtube_category_id = '1'
 where id = '30303030-0000-4000-8000-00000000000a';

select is(
  (select row(youtube_made_for_kids, youtube_category_id)::text
     from public.platform_connections where id = '30303030-0000-4000-8000-00000000000a'),
  row(true, '1'::text)::text,
  'a member of the account declares their channel'
);

-- 5. Someone outside the account cannot change it: the update matches no row.
select makerkit.authenticate_as('outsider');

select is_empty(
  $$ update public.platform_connections set youtube_made_for_kids = false
      where id = '30303030-0000-4000-8000-00000000000a' returning id $$,
  'an outsider''s update reaches no row'
);

set local role postgres;

select is(
  (select youtube_made_for_kids from public.platform_connections
    where id = '30303030-0000-4000-8000-00000000000a'),
  true,
  'the declaration is unchanged after the outsider''s attempt'
);

-- 6. Reconnecting writes a new token through the OAuth callbacks' upsert,
--    which names only credential and profile columns. The declaration stays.
insert into public.platform_connections
  (account_id, platform, platform_account_id, platform_account_name, access_token_encrypted, metadata)
values
  (current_setting('kb.story')::uuid, 'youtube', 'UC-kb30-A', 'Acme Kids', 'enc-access-new', '{"x": 1}')
on conflict (account_id, platform, platform_account_id) do update
  set access_token_encrypted = excluded.access_token_encrypted,
      platform_account_name = excluded.platform_account_name,
      metadata = excluded.metadata;

select is(
  (select row(youtube_made_for_kids, youtube_category_id)::text
     from public.platform_connections where id = '30303030-0000-4000-8000-00000000000a'),
  row(true, '1'::text)::text,
  'a reconnect keeps the channel''s declaration'
);

select is(
  (select access_token_encrypted from public.platform_connections
    where id = '30303030-0000-4000-8000-00000000000a'),
  'enc-access-new',
  'the reconnect really did write the row (control)'
);

select * from finish();
rollback;
