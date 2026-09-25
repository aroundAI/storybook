-- KB-89 / KB-61: project members may remove an episode's thumbnail.
--
-- Members could already add a thumbnail and replace one (a replace deletes
-- the old file), and the storage policy on episodes/<E>/ lets them delete
-- the file itself — but the row's delete policy admitted only owners and
-- admins. The action let members through, so a member's remove deleted the
-- file, matched no row, and reported success (KB-61). Owner decision
-- 2026-09-25: members may remove thumbnails. The delete policy now follows
-- the project-write rule the table's writers use (can_write_project, KB-27).

alter policy "episode_thumbnails_delete" on public.episode_thumbnails
  using (
    exists (
      select 1 from public.episodes e
      where e.id = episode_thumbnails.episode_id
        and public.can_write_project(e.project_id)
    )
  );
