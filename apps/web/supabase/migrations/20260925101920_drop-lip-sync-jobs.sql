-- FILM-513: lip-sync (SyncLabs, Wav2Lip) is retired (owner, 2026-09-22) and its
-- code is deleted. Nothing could ever write this table successfully: the editor
-- was mounted nowhere and neither provider had an API key in any environment.
--
-- The owner approved this drop on 2026-09-25, when production held 0 rows
-- (checked by the owner that day). If a database has rows anyway, this refuses
-- rather than destroying rows: export or delete them deliberately, then re-run.
--
-- A plain DROP (no CASCADE, no IF EXISTS), so an unexpected dependent or a
-- missing table fails loudly. Its four RLS policies, four indexes, the
-- set_lip_sync_jobs_updated_at trigger, its constraints and grants go with it.
-- There is no schemas/ file for this table, so nothing to mirror.
do $$
declare
  n bigint;
begin
  select count(*) into n from public.lip_sync_jobs;

  if n > 0 then
    raise exception 'lip_sync_jobs is not empty (% rows); refusing to drop', n
      using hint = 'Export or delete the rows deliberately, then re-run. See FILM-513.';
  end if;
end $$;

drop table public.lip_sync_jobs;
