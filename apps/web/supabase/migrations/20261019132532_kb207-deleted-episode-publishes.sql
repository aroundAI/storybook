-- KB-207. Deleting an episode cancels the posts it has not made yet.
--
-- Episodes are soft-deleted (`episodes.deleted_at`), and nothing touched
-- their publishes: a deleted episode's `scheduled` long video was still
-- posted by the scheduled-publish job when its time came, and it held its
-- channel's cadence slot, so the re-uploaded episode could not be
-- scheduled in its place.
--
-- When `deleted_at` goes from null to a time, the episode's publishes that
-- have not started (`scheduled`, `queued`) are deleted, as cancelling them
-- one by one would. Rows that have started or finished (`publishing`,
-- `published`, `failed`, `deleted`) are history and stay.
--
-- Security definer: whoever may soft-delete the episode cancels its posts,
-- although `publishes_delete` lets only project owners and admins delete a
-- publish.

create or replace function public.cancel_deleted_episode_publishes ()
returns trigger
language plpgsql
security definer
set search_path = '' as $$
begin
  delete from public.publishes
   where episode_id = new.id
     and status in ('scheduled', 'queued');

  return new;
end;
$$;

revoke all on function public.cancel_deleted_episode_publishes () from public, anon, authenticated;

drop trigger if exists cancel_deleted_episode_publishes on public.episodes;

create trigger cancel_deleted_episode_publishes
  after update of deleted_at on public.episodes
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.cancel_deleted_episode_publishes ();

-- Episodes deleted before this trigger: their posts are cancelled now
delete from public.publishes p
 using public.episodes e
 where e.id = p.episode_id
   and e.deleted_at is not null
   and p.status in ('scheduled', 'queued');
