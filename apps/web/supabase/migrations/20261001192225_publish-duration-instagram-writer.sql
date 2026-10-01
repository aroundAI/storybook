-- ==================================
-- Instagram's duration is written at publish time (FILM-1710)
-- ==================================
-- The column comment said the analytics sync was its only writer. That
-- stays true for YouTube and TikTok, whose platforms report a duration.
-- Meta reports none for an Instagram video, so its publish records the
-- length of the file it uploaded, read from the file's MP4 header
-- (`recordUploadedFileDuration`, service role). Comment only: the column,
-- its check and `publishes_keep_asset_duration` are unchanged.

comment on column public.publishes.duration_seconds is
  'Published asset duration in whole seconds. Null = duration_unknown. YouTube and TikTok: as the platform reports it, written by the analytics asset-duration sync. Instagram: the uploaded file''s length from its MP4 header, written at publish time. Service role only; never the episode''s duration';
