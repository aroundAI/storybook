-- KB-51: `anon` held every privilege on youtube_report_jobs.
--
-- 20260827095855_youtube-report-jobs.sql revoked from `authenticated` and
-- `service_role` and granted back what each needs, but never touched `anon`,
-- so Supabase's default grant stood: SELECT, INSERT, UPDATE, DELETE,
-- TRUNCATE, REFERENCES, TRIGGER. Row-level security kept the row commands
-- empty (no policy names anon), but it does not govern TRUNCATE.
--
-- Nothing reads this table as anon: the report-ingest cron uses the service
-- role, and signed-in reads go through `authenticated`. The same default grant
-- stands on most public tables; that sweep is KB-85's.
--
-- Guarded by tests/database/youtube-report-jobs-rls.test.sql.

revoke all on public.youtube_report_jobs from anon;
