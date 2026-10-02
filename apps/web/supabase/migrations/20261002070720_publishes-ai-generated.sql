-- ==================================
-- The creator's AI declaration on a publish (FILM-1731)
-- ==================================
-- Owner, 2026-10-02: "add an option to mark it as AI Labeled". The creator
-- declares it on the publish screen, once per publish, and every upload of
-- that publish sends it on the platform's own field: Instagram's
-- is_ai_generated, YouTube's status.containsSyntheticMedia, TikTok's
-- post_info.is_aigc and X's made_with_ai. Facebook Pages have no such field.
--
-- Its own column, not a key in `metadata`: metadata is the platform settings
-- bag the pipeline rewrites on failure and retry, and the declaration must
-- reach the scheduled paths (the in-app cron, the scheduled-publish lambda
-- and the publish worker) exactly as it was made.
--
-- NOT NULL DEFAULT false: off is the screen's default, and every row written
-- before the option existed was published without a label, which is what
-- false records. A constant default is metadata-only in Postgres, so the
-- table is not rewritten.
--
-- No new policy: the existing publishes policies govern who may write a
-- publish, and so who may declare it.

alter table public.publishes
  add column if not exists ai_generated boolean not null default false;

comment on column public.publishes.ai_generated is
  'The creator declared this video AI-generated: sent as each platform''s AI label (FILM-1731)';
