begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- KB-53: who may write an account's picture into the account_image bucket.
-- A fixed plan, so a run that aborts early fails as a plan mismatch.
select plan(21);

-- The bucket's policy keys on the file name: `<accountId>.<ext>` belongs to
-- that account. public.can_write_account_image is that rule, and the presign
-- route asks the same function, so R2 (where no policy runs) applies it too.
--
-- Fixtures:
--   T  team account of kb53_owner. kb53_member is a member (the seeded member
--      role holds settings.manage); kb53_viewer has a role with no
--      permissions.
--   kb53_personal writes their own picture. kb53_stranger belongs to nothing.
--
-- Storage cases insert into storage.objects as `authenticated`: the row the
-- Storage API writes under a user's session.

select tests.create_supabase_user('kb53_owner', 'kb53-owner@storybook.dev');
select tests.create_supabase_user('kb53_member', 'kb53-member@storybook.dev');
select tests.create_supabase_user('kb53_viewer', 'kb53-viewer@storybook.dev');
select tests.create_supabase_user('kb53_personal', 'kb53-personal@storybook.dev');
select tests.create_supabase_user('kb53_stranger', 'kb53-stranger@storybook.dev');

select makerkit.authenticate_as('kb53_owner');
select public.create_team_account('KB53 Team');

set local role postgres;

select set_config('kb53.team', makerkit.get_account_id_by_slug('kb53-team')::text, true);
select set_config('kb53.personal', tests.get_supabase_uid('kb53_personal')::text, true);

insert into public.roles (name, hierarchy_level) values ('kb53_no_permissions', 90);

insert into public.accounts_memberships (user_id, account_id, account_role)
values
  (tests.get_supabase_uid('kb53_member'), current_setting('kb53.team')::uuid, 'member'),
  (tests.get_supabase_uid('kb53_viewer'), current_setting('kb53.team')::uuid, 'kb53_no_permissions');

-- ==================================
-- The bucket
-- ==================================

select results_eq(
  $$ select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'account_image' $$,
  $$ values (true, 10485760::bigint, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]) $$,
  'account_image: public, 10 MB, the four image types the route admits'
);

-- ==================================
-- public.can_write_account_image
-- ==================================

select makerkit.authenticate_as('kb53_personal');
select ok(public.can_write_account_image(current_setting('kb53.personal') || '.png'), 'a user may write their own picture');
select ok(not public.can_write_account_image(current_setting('kb53.team') || '.png'), 'a user may not write a team''s picture they do not belong to');

select makerkit.authenticate_as('kb53_owner');
select ok(public.can_write_account_image(current_setting('kb53.team') || '.jpg'), 'the team owner may write the team picture');
select ok(not public.can_write_account_image(current_setting('kb53.personal') || '.png'), 'the team owner may not write another user''s picture');

select makerkit.authenticate_as('kb53_member');
select ok(public.can_write_account_image(current_setting('kb53.team') || '.webp'), 'a member whose role has settings.manage may write the team picture');

select makerkit.authenticate_as('kb53_viewer');
select ok(not public.can_write_account_image(current_setting('kb53.team') || '.png'), 'a member without settings.manage may not');

select makerkit.authenticate_as('kb53_stranger');
select ok(not public.can_write_account_image(current_setting('kb53.team') || '.png'), 'a stranger may not write the team picture');

select makerkit.authenticate_as('kb53_personal');
select is(
  public.can_write_account_image(current_setting('kb53.personal') || '/avatar-1790000000000.png'),
  false,
  'the pre-KB-53 avatar name is refused, not an error'
);
select is(public.can_write_account_image('avatar.png'), false, 'a name that is not an account id is refused');

-- ==================================
-- The policy calls the same rule
-- ==================================

select makerkit.authenticate_as('kb53_personal');

select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('account_image', current_setting('kb53.personal') || '.png', auth.uid()::text) $$,
  'a user stores their own picture'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('account_image', current_setting('kb53.personal') || '/avatar-1790000000000.png', auth.uid()::text) $$,
  '42501', null,
  'the pre-KB-53 avatar name is refused by the policy, not failed by a uuid cast'
);

-- An avatar upload overwrites (upsert): the owner may update their own row.
update storage.objects set metadata = '{"v": 2}'
 where bucket_id = 'account_image' and name = current_setting('kb53.personal') || '.png';

select results_eq(
  $$ select metadata->>'v' from storage.objects where bucket_id = 'account_image' and name = current_setting('kb53.personal') || '.png' $$,
  $$ values ('2') $$,
  'a user overwrites their own picture'
);

select makerkit.authenticate_as('kb53_owner');

select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('account_image', current_setting('kb53.team') || '.png', auth.uid()::text) $$,
  'the team owner stores the team picture'
);

select makerkit.authenticate_as('kb53_member');

select lives_ok(
  $$ update storage.objects set metadata = '{"v": 3}' where bucket_id = 'account_image' and name = current_setting('kb53.team') || '.png' $$,
  'a member with settings.manage may overwrite the team picture'
);

select makerkit.authenticate_as('kb53_viewer');

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('account_image', current_setting('kb53.team') || '.jpg', auth.uid()::text) $$,
  '42501', null,
  'a member without settings.manage may not store the team picture'
);

-- USING passes (has_role_on_account); WITH CHECK refuses the new row.
select throws_ok(
  $$ update storage.objects set metadata = '{"v": 4}' where bucket_id = 'account_image' and name = current_setting('kb53.team') || '.png' $$,
  '42501', null,
  'a member without settings.manage may not overwrite the team picture'
);

select makerkit.authenticate_as('kb53_stranger');

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('account_image', current_setting('kb53.personal') || '.gif', auth.uid()::text) $$,
  '42501', null,
  'a stranger may not store another user''s picture'
);

update storage.objects set metadata = '{"v": 5}'
 where bucket_id = 'account_image' and name = current_setting('kb53.personal') || '.png';

set local role postgres;

select results_eq(
  $$ select metadata->>'v' from storage.objects where bucket_id = 'account_image' and name = current_setting('kb53.personal') || '.png' $$,
  $$ values ('2') $$,
  'a stranger''s overwrite of another user''s picture touches nothing'
);

select results_eq(
  $$ select metadata->>'v' from storage.objects where bucket_id = 'account_image' and name = current_setting('kb53.team') || '.png' $$,
  $$ values ('3') $$,
  'the team picture holds the member''s overwrite, not the refused one'
);

-- ==================================
-- Grants
-- ==================================

select ok(
  not has_function_privilege('anon', 'public.can_write_account_image(text)', 'EXECUTE'),
  'anon may not call can_write_account_image'
);

select * from finish();

rollback;
