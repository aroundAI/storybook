-- FILM-2209. A channel's Shorts post on every Nth day, and wait 2 hours
-- after their long video unless told otherwise.
--
-- The owner's posting plan (2026-10-18) has Shorts "every day, every 2
-- days…", and FILM-719 had no way to say it: min_days_between spaces long
-- videos only. every_n_days counts local days from the channel's Shorts
-- queue (packages/features/publishing/src/lib/cadence/cadence.ts,
-- nextFreeSlot); days_of_week still applies. A long-video row keeps 1: its
-- spacing is min_days_between.
--
-- start_after_hours defaulted to 0 here and to 20 in the code; both are 2
-- now, so a row written without it waits as a channel with no row does.

alter table public.channel_posting_cadences
  add column every_n_days smallint not null default 1
    check (every_n_days between 1 and 30),
  add constraint channel_posting_cadences_every_n_days_shorts_check
    check (content_type = 'short' or every_n_days = 1);

comment on column public.channel_posting_cadences.every_n_days is
  'Shorts: post on every Nth local day, counted from the channel''s Shorts queue. Long videos: always 1 (min_days_between spaces them). FILM-2209';

alter table public.channel_posting_cadences
  alter column start_after_hours set default 2;
