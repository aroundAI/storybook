begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(7);

-- KB-175. An episode number is unique per project among live episodes:
-- the create code (insertEpisode) has always assumed it. A second live
-- episode with a taken number fails with 23505 on the number index even
-- when its title, and so its slug, differs; a soft-deleted episode frees
-- its number; another project may reuse it.

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');
select makerkit.authenticate_as('primary_owner');
set local role postgres;

select set_config('en.story', makerkit.get_account_id_by_slug('storybook')::text, true);

insert into public.projects (id, account_id, name, slug)
  values ('e7e7b000-0000-4000-8000-000000000011', current_setting('en.story')::uuid, 'EN one', 'en-one'),
         ('e7e7b000-0000-4000-8000-000000000021', current_setting('en.story')::uuid, 'EN two', 'en-two');
insert into public.episodes (id, project_id, number, title, slug)
  values ('e7e7b000-0000-4000-8000-000000000012', 'e7e7b000-0000-4000-8000-000000000011', 1, 'First', 'episode-1-first');

select throws_ok(
  $$ insert into public.episodes (project_id, number, title, slug)
     values ('e7e7b000-0000-4000-8000-000000000011', 1, 'Clash', 'episode-1-clash') $$,
  '23505',
  null,
  'A second live episode with a taken number is refused, whatever its title'
);

select is(
  (select count(*)::int from public.episodes
   where project_id = 'e7e7b000-0000-4000-8000-000000000011'),
  1,
  'The refused insert left no row behind'
);

select lives_ok(
  $$ insert into public.episodes (project_id, number, title, slug)
     values ('e7e7b000-0000-4000-8000-000000000011', 2, 'Second', 'episode-2-second') $$,
  'The next number is accepted'
);

select lives_ok(
  $$ insert into public.episodes (project_id, number, title, slug)
     values ('e7e7b000-0000-4000-8000-000000000021', 1, 'Other project', 'episode-1-other-project') $$,
  'Another project may use the same number'
);

update public.episodes set deleted_at = now()
  where id = 'e7e7b000-0000-4000-8000-000000000012';

select lives_ok(
  $$ insert into public.episodes (project_id, number, title, slug)
     values ('e7e7b000-0000-4000-8000-000000000011', 1, 'Reused', 'episode-1-reused') $$,
  'A soft-deleted episode frees its number'
);

select throws_ok(
  $$ update public.episodes set number = 1
     where project_id = 'e7e7b000-0000-4000-8000-000000000011' and number = 2 $$,
  '23505',
  null,
  'Renumbering a live episode onto a taken number is refused'
);

select ok(
  exists (
    select 1 from pg_index
    where indexrelid = 'public.idx_episodes_project_number'::regclass
      and indisunique
      and pg_get_expr(indpred, indrelid) like '%deleted_at IS NULL%'
  ),
  'The number index is unique over live episodes'
);

select * from finish();
rollback;
