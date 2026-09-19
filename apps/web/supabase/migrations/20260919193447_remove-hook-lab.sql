-- ==================================
-- Remove Hook Lab (FILM-1510)
-- ==================================
-- Reviewed 2026-09-20 (FILM-CC-04 KB-9, KB-10): no page could create a test
-- or add a variant, retention was read at the wrong place in the video, and
-- a variant could link another account's video and read its retention.
-- Hook tests are redesigned as channel experiments (FILM-1724); nothing of
-- this model carries over, so its code and tables are removed together.
--
-- Guarded: the tables are believed empty in production, but only dropped if
-- they are. If they are not, this migration stops here, nothing is lost,
-- and the app still works — no code reads these tables any more. Export the
-- rows, then decide.

do $$
declare
  test_count bigint;
  variant_count bigint;
begin
  select count(*) into test_count from public.hook_tests;
  select count(*) into variant_count from public.hook_variants;

  if test_count > 0 or variant_count > 0 then
    raise exception
      'Hook Lab has data (% tests, % variants). Not dropping it: export the rows first (FILM-CC-04 KB-10).',
      test_count, variant_count;
  end if;
end;
$$;

drop table public.hook_variants;
drop table public.hook_tests;
