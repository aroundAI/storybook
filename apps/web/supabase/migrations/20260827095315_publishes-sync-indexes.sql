-- FILM-1502: indexes supporting the analytics sync queue query
-- (fetchPublishesForSync filters status='published' and orders by published_at desc)
create index if not exists idx_publishes_published_at on public.publishes(published_at desc)
  where status = 'published';
create index if not exists idx_publishes_status on public.publishes(status);
