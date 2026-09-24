-- ==================================
-- KB-30: a YouTube channel's audience is the creator's declaration
-- ==================================
-- YouTube requires every upload to say whether it is made for children
-- (COPPA). Every upload path defaulted that to "not made for kids", and the
-- category to 22, and no screen showed or asked either. For a child-directed
-- channel that is a false declaration made in the creator's name.
--
-- The owner decided (2026-09-24): the declaration belongs to the YouTube
-- channel, and there is no default — the first publish to each channel asks
-- for the audience and the category, with nothing pre-selected.
--
-- NULL is load-bearing: it means "not declared", and the product asks. There
-- is no default and no backfill, because the right value is unknowable
-- without the creator.
--
-- Not `platform_connections.metadata`: every OAuth callback upserts that
-- column, so a reconnect would silently erase the answer.

alter table public.platform_connections
  add column if not exists youtube_made_for_kids boolean,
  add column if not exists youtube_category_id text;

alter table public.platform_connections
  add constraint platform_connections_youtube_settings_only_youtube check (
    platform = 'youtube'
    or (youtube_made_for_kids is null and youtube_category_id is null)
  ),
  add constraint platform_connections_youtube_category_numeric check (
    youtube_category_id is null or youtube_category_id ~ '^[0-9]{1,3}$'
  );

comment on column public.platform_connections.youtube_made_for_kids is
  'KB-30: the creator''s made-for-kids (COPPA) declaration for this YouTube channel. NULL = not declared: the app asks and never assumes.';
comment on column public.platform_connections.youtube_category_id is
  'KB-30: the YouTube category id sent with every upload to this channel. NULL = not chosen: the app asks.';

-- Granted by name. The table grant covers them today, but members' access to
-- this table is moving to column-level privileges (KB-43/44); a column that
-- is not named there would silently stop being readable or writable.
grant select (youtube_made_for_kids, youtube_category_id),
      update (youtube_made_for_kids, youtube_category_id)
  on public.platform_connections to authenticated;
