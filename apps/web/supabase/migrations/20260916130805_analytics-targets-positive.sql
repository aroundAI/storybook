-- ==================================
-- Analytics targets must be positive (FILM-1608 follow-up)
-- ==================================
-- Every one of these numbers is a denominator. `getYppProgressAction`
-- computes `Math.min(1, watchHours / targetWatchHours)`, so a stored zero
-- does not fail — it reports the gate as **met**:
--
--   Math.min(1, 500 / 0) === 1      -> the bar renders 100% complete
--   Math.min(1, 0 / 0)   === NaN    -> NaN reaches <Progress value={...}>
--
-- Neither is an error anyone would see; the first is a confident wrong
-- answer about whether a channel has qualified for monetisation.
--
-- The Zod schema already rejects zero with `.positive()`, but that guards one
-- writer. `service_role`, psql, a future action and any backfill all reach
-- these columns without passing through it, which is exactly the set of
-- writers the FILM-1609 post-mortem says to ask about. The invariant belongs
-- on the table.
--
-- NULL stays legal on every column: in SQL a CHECK passes when it evaluates
-- to NULL, so `null > 0` is not a violation. That matters — null is how a
-- channel says "inherit" and an account says "use the shipped default", and
-- these constraints must not take that away.

alter table public.analytics_settings
  add constraint analytics_settings_targets_positive
  check (
    ypp_target_watch_hours is null or ypp_target_watch_hours > 0
  ) not valid;

alter table public.analytics_settings
  add constraint analytics_settings_subscribers_positive
  check (
    ypp_target_subscribers is null or ypp_target_subscribers > 0
  ) not valid;

alter table public.analytics_settings
  add constraint analytics_settings_tag_min_sample_positive
  check (tag_min_sample is null or tag_min_sample > 0) not valid;

alter table public.channel_analytics_settings
  add constraint channel_analytics_settings_watch_hours_positive
  check (
    ypp_target_watch_hours is null or ypp_target_watch_hours > 0
  ) not valid;

alter table public.channel_analytics_settings
  add constraint channel_analytics_settings_subscribers_positive
  check (
    ypp_target_subscribers is null or ypp_target_subscribers > 0
  ) not valid;

-- `not valid` skips the scan of existing rows, then these validate them
-- immediately. Both tables are empty in every environment, so this is a
-- formality rather than a saving — but it is spelled out because `not valid`
-- on its own postpones the *scan*, not the rule, and a constraint left
-- unvalidated is one that reports itself as such forever. The FILM-1609
-- post-mortem has the long version.
alter table public.analytics_settings
  validate constraint analytics_settings_targets_positive;
alter table public.analytics_settings
  validate constraint analytics_settings_subscribers_positive;
alter table public.analytics_settings
  validate constraint analytics_settings_tag_min_sample_positive;
alter table public.channel_analytics_settings
  validate constraint channel_analytics_settings_watch_hours_positive;
alter table public.channel_analytics_settings
  validate constraint channel_analytics_settings_subscribers_positive;
