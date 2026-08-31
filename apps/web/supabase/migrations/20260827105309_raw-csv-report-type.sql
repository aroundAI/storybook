-- FILM-1511: monthly raw-data export report type
-- A full per-video per-day dump so multi-year analysis does not depend on
-- YouTube Studio's limited retention window.

alter table public.scheduled_reports
  drop constraint if exists scheduled_reports_report_type_check;

alter table public.scheduled_reports
  add constraint scheduled_reports_report_type_check
  check (report_type in ('pdf', 'csv', 'raw_csv'));
