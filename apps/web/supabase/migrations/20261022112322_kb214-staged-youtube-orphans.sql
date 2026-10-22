-- KB-214. A YouTube post is uploaded ahead of its time, private until
-- YouTube publishes it (`publishes.metadata.youtube.videoId`, status still
-- `scheduled`). Deleting its episode (KB-207) deleted that row, and with it
-- the only record that a private video sat on the channel, which SQL cannot
-- delete on YouTube.
--
-- So a staged YouTube row is not deleted with its episode: it is marked
-- `deleting` with `metadata.youtube.orphanedAt`, and the scheduled job's
-- YouTube check deletes the video on YouTube, then the row. `deleting`
-- holds no cadence slot and is never sent. Every other row is cancelled as
-- before.

create or replace function public.cancel_deleted_episode_publishes ()
returns trigger
language plpgsql
security definer
set search_path = '' as $$
begin
  update public.publishes
     set status = 'deleting',
         metadata = jsonb_set(
           metadata,
           '{youtube,orphanedAt}',
           to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
         )
   where episode_id = new.id
     and status = 'scheduled'
     and platform = 'youtube'
     and metadata->'youtube'->>'videoId' is not null;

  delete from public.publishes
   where episode_id = new.id
     and status in ('scheduled', 'queued');

  return new;
end;
$$;

revoke all on function public.cancel_deleted_episode_publishes () from public, anon, authenticated;
