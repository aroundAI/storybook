-- Add 'queued' status to publishes table
-- Used by SQS-based publish worker to prevent duplicate processing

-- Drop the old constraint
alter table public.publishes drop constraint if exists publishes_status_check;

-- Add the new constraint with 'queued' status
alter table public.publishes add constraint publishes_status_check 
  check (status in ('draft', 'scheduled', 'queued', 'publishing', 'published', 'failed', 'unlisted', 'deleted'));

-- Update schema comment
comment on column public.publishes.status is 'Publish status: draft, scheduled, queued, publishing, published, failed, unlisted, deleted';
