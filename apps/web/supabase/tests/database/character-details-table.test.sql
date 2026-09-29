begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(16);

-- FILM-101e (character_details). The extension table for character assets:
-- what it accepts (NULL, minimal and maximal attributes, long prompts, empty
-- and long arrays), what it refuses (malformed JSON), the cascade from the
-- asset, and the attribute query the GIN index serves. Two of the spec's
-- items are not here on purpose: "an asset that is not a character is
-- refused" (no such constraint exists, and Postgres cannot CHECK a subquery)
-- and the voice_asset_id foreign key (the column became elevenlabs_voice_id
-- text in 20251225160000). Fixture ids start with 101e.

select tests.create_supabase_user('cd_owner', 'cd-owner@storybook.dev');

select makerkit.authenticate_as('cd_owner');
set local role postgres;
insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
values ('101e0000-0000-4000-8000-00000000000a', 'FILM-101e team', false, tests.get_supabase_uid('cd_owner'));
insert into public.projects (id, account_id, name, status) values
  ('101e0000-0000-4000-8000-000000000001', '101e0000-0000-4000-8000-00000000000a', 'FILM-101e', 'active');

insert into public.assets (id, project_id, type, name) values
  ('101e0000-0000-4000-8000-0000000000a1', '101e0000-0000-4000-8000-000000000001', 'character', 'Ada'),
  ('101e0000-0000-4000-8000-0000000000a2', '101e0000-0000-4000-8000-000000000001', 'character', 'Bram'),
  ('101e0000-0000-4000-8000-0000000000a3', '101e0000-0000-4000-8000-000000000001', 'character', 'Cleo'),
  ('101e0000-0000-4000-8000-0000000000a4', '101e0000-0000-4000-8000-000000000001', 'character', 'Dov'),
  ('101e0000-0000-4000-8000-0000000000a5', '101e0000-0000-4000-8000-000000000001', 'character', 'Edda'),
  ('101e0000-0000-4000-8000-0000000000a6', '101e0000-0000-4000-8000-000000000001', 'character', 'Finn');

-- Ada: full details.
select lives_ok(
  $$ insert into public.character_details
       (asset_id, physical_attributes, personality, element_prompt, reference_images)
     values ('101e0000-0000-4000-8000-0000000000a1',
             '{"age": 34, "hair": "brown", "eyes": "green", "build": "athletic"}',
             'dry humour', 'a woman in a grey coat', array['https://x.test/a.png']) $$,
  'details for a character asset, with valid JSON attributes, are accepted'
);

-- Bram: no attributes at all.
select lives_ok(
  $$ insert into public.character_details (asset_id, physical_attributes)
     values ('101e0000-0000-4000-8000-0000000000a2', null) $$,
  'physical_attributes may be NULL'
);

select is(
  (select physical_attributes is null from public.character_details
    where asset_id = '101e0000-0000-4000-8000-0000000000a2'),
  true,
  'a character with no attributes reads back as NULL, not an empty object'
);

select throws_ok(
  $$ insert into public.character_details (asset_id, physical_attributes)
     values ('101e0000-0000-4000-8000-0000000000a3', '{"age": ') $$,
  '22P02', null,
  'malformed JSON is refused'
);

-- Cleo: only an age.
insert into public.character_details (asset_id, physical_attributes)
values ('101e0000-0000-4000-8000-0000000000a3', '{"age": 61}');

select is(
  (select physical_attributes ->> 'age' from public.character_details
    where asset_id = '101e0000-0000-4000-8000-0000000000a3'),
  '61',
  'minimal attributes (just an age) round-trip'
);

-- Dov: every field the app writes, nested.
insert into public.character_details (asset_id, physical_attributes)
values ('101e0000-0000-4000-8000-0000000000a4', jsonb_build_object(
  'age', 8, 'height', '120cm', 'build', 'small', 'hair', 'black', 'eyes', 'brown',
  'skin', 'olive', 'clothing', jsonb_build_object('top', 'yellow raincoat', 'shoes', 'boots'),
  'distinguishing', jsonb_build_array('gap tooth', 'scar on chin')));

select is(
  (select physical_attributes -> 'clothing' ->> 'top' from public.character_details
    where asset_id = '101e0000-0000-4000-8000-0000000000a4'),
  'yellow raincoat',
  'maximal, nested attributes round-trip'
);

-- Edda: a very long prompt and no reference images.
insert into public.character_details (asset_id, element_prompt, reference_images)
values ('101e0000-0000-4000-8000-0000000000a5', repeat('p', 5001), '{}');

select is(
  (select length(element_prompt) from public.character_details
    where asset_id = '101e0000-0000-4000-8000-0000000000a5'),
  5001,
  'an element prompt over 5000 characters is stored whole'
);

select is(
  (select coalesce(array_length(reference_images, 1), 0) from public.character_details
    where asset_id = '101e0000-0000-4000-8000-0000000000a5'),
  0,
  'an empty reference_images array is stored as empty'
);

-- Finn: twenty-five reference images.
insert into public.character_details (asset_id, reference_images)
select '101e0000-0000-4000-8000-0000000000a6',
       array_agg('https://x.test/ref-' || n || '.png' order by n)
from generate_series(1, 25) n;

select is(
  (select array_length(reference_images, 1) from public.character_details
    where asset_id = '101e0000-0000-4000-8000-0000000000a6'),
  25,
  'a reference_images array of 25 URLs is stored'
);

select is(
  (select reference_images[25] from public.character_details
    where asset_id = '101e0000-0000-4000-8000-0000000000a6'),
  'https://x.test/ref-25.png',
  'and read back in order'
);

select is(
  (select reference_images from public.character_details
    where asset_id = '101e0000-0000-4000-8000-0000000000a1'),
  array['https://x.test/a.png'],
  'a reference_images array stores and retrieves as written'
);

select results_eq(
  $$ select a.name::text from public.character_details cd
       join public.assets a on a.id = cd.asset_id
      where cd.physical_attributes ->> 'hair' = 'brown'
        and (cd.physical_attributes ->> 'age')::int > 30 $$,
  $$ values ('Ada') $$,
  'characters can be found by an attribute such as hair colour'
);

select results_eq(
  $$ select a.name::text from public.character_details cd
       join public.assets a on a.id = cd.asset_id
      where cd.physical_attributes @> '{"skin": "olive"}' $$,
  $$ values ('Dov') $$,
  'and by containment, the query the GIN index serves'
);

select is(
  (select indexdef ~ 'USING gin \(physical_attributes\)' from pg_indexes
    where schemaname = 'public' and indexname = 'idx_character_details_physical_attributes'),
  true,
  'physical_attributes has a GIN index'
);

-- "Improves query performance" cannot be timed on six rows; what a test can
-- show is that the planner uses the index for a containment query once a
-- sequential scan is not on offer.
create function pg_temp.plan_of(q text) returns text language plpgsql as $f$
declare line text; out text := '';
begin
  for line in execute 'explain ' || q loop out := out || line || E'\n'; end loop;
  return out;
end $f$;

set local enable_seqscan = off;

select alike(
  pg_temp.plan_of($q$ select asset_id from public.character_details
                       where physical_attributes @> '{"hair": "brown"}' $q$),
  '%idx_character_details_physical_attributes%',
  'the planner answers an attribute containment query from the GIN index'
);

reset enable_seqscan;

delete from public.assets where id = '101e0000-0000-4000-8000-0000000000a1';

select is(
  (select count(*)::int from public.character_details
    where asset_id = '101e0000-0000-4000-8000-0000000000a1'),
  0,
  'deleting the character asset deletes its details'
);

select * from finish();
rollback;
