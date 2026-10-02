begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(8);

-- FILM-1717. Genome attributes are tags: the table takes the observable
-- dimensions, and the yes/no and banded ones take only their own values,
-- so `face_present:true` on one account cannot sit beside
-- `face_present:yes` on another. Run as postgres: these are table rules,
-- not policies, and hold for every writer.

set local role postgres;

select set_config('gn.story', makerkit.get_account_id_by_slug('storybook')::text, true);

select lives_ok(
  $$ insert into public.content_tags (account_id, dimension, slug, label)
     values (current_setting('gn.story')::uuid, 'result_first', 'yes', 'Result first') $$,
  'a genome dimension takes one of its values'
);

select lives_ok(
  $$ insert into public.content_tags (account_id, dimension, slug, label)
     values (current_setting('gn.story')::uuid, 'cuts_per_minute', '15-to-30', '15 to 30 cuts') $$,
  'a banded dimension takes one of its bands'
);

select lives_ok(
  $$ insert into public.content_tags (account_id, dimension, slug, label)
     values (current_setting('gn.story')::uuid, 'hook_type', 'cold-open', 'Cold open') $$,
  'hook_type stays an account''s own vocabulary'
);

select lives_ok(
  $$ insert into public.content_tags (account_id, dimension, slug, label)
     values (current_setting('gn.story')::uuid, 'opening_visual', 'whiteboard', 'Whiteboard') $$,
  'an open genome dimension takes any slug'
);

select throws_ok(
  $$ insert into public.content_tags (account_id, dimension, slug, label)
     values (current_setting('gn.story')::uuid, 'face_present', 'true', 'True') $$,
  '23514',
  null,
  'a yes/no dimension refuses any other value'
);

select throws_ok(
  $$ insert into public.content_tags (account_id, dimension, slug, label)
     values (current_setting('gn.story')::uuid, 'scene_changes', 'lots', 'Lots') $$,
  '23514',
  null,
  'a banded dimension refuses a band of its own'
);

select throws_ok(
  $$ insert into public.content_tags (account_id, dimension, slug, label)
     values (current_setting('gn.story')::uuid, 'transmission', 'high', 'High') $$,
  '23514',
  null,
  'a funnel stage is not a dimension: performance is measured, never tagged'
);

select throws_ok(
  $$ update public.content_tags set slug = 'maybe'
      where account_id = current_setting('gn.story')::uuid
        and dimension = 'result_first' and slug = 'yes' $$,
  '23514',
  null,
  'an update cannot move a closed dimension off its values'
);

select * from finish();
rollback;
