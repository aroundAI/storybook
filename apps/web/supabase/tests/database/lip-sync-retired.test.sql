begin;

-- FILM-513. Lip-sync is retired and its table dropped, with its four RLS
-- policies, indexes and trigger. Nothing may bring it back unannounced.
select plan(2);

select hasnt_table('public', 'lip_sync_jobs', 'lip_sync_jobs is dropped');

select is(
  (select count(*)::int from pg_policies where policyname like 'lip_sync_jobs%'),
  0,
  'no lip_sync_jobs policy remains'
);

select * from finish();

rollback;
