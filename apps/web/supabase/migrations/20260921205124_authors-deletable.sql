-- ==================================
-- Authors no longer block user deletion (FILM-CC-04 KB-1)
-- ==================================
-- Users are hard-deleted through `auth.admin.deleteUser`. Seventeen authorship
-- columns in `public` referenced auth.users with no ON DELETE action, so the
-- delete failed with 23503 as soon as one row named the user — in practice,
-- anyone who had ever created a project:
--
--     update or delete on table "users" violates foreign key constraint
--     "projects_created_by_fkey" on table "projects"
--
-- The row belongs to the account, not to whoever typed it: null the author
-- and keep the row. Same defect and same fix as FILM-1610 (#264) on
-- analytics_experiments and content_tags. Every column below is already
-- nullable; nothing here changes a column, a policy or a type.
--
-- The list is what `pg_constraint` returned on 2026-09-21 for
-- `confrelid = 'auth.users' and confdeltype = 'a'` in `public` — all
-- authorship columns, none recording whose the row is.
--
-- accounts and accounts_memberships come from the upstream Makerkit kit, which
-- declares these four keys without an action. This diverges from it on
-- purpose; an upstream sync that re-creates them brings the bug back.

-- ----------------------------------
-- 1. The triggers that would undo or refuse the key's own action
-- ----------------------------------
-- ON DELETE SET NULL is carried out as an internal
-- `UPDATE ONLY <table> SET <column> = NULL`, and BEFORE UPDATE row triggers
-- fire on it like on any other update. Three of them stood in the way, so the
-- keys alone would not have fixed the bug:
--
--   * trigger_set_user_tracking puts created_by back on every UPDATE. It did
--     that to the key's SET NULL too, and the delete failed on the restored
--     value: 23503 again, 'Key (created_by)=(...) is not present in table
--     "users"'. It also stamps updated_by with auth.uid() — null on GoTrue's
--     connection — erasing a living colleague's name from a row whose
--     *creator* was deleted.
--   * kit.prevent_memberships_update raises unless account_role changes.
--   * enforce_verified_facts_update_rules raises 'Cannot change created_by'.
--
-- Each now steps aside for exactly one thing: an update arriving from inside
-- another trigger (pg_trigger_depth() > 1, which is where a foreign-key action
-- runs) that clears an author. The same exception keep_experiment_creator
-- makes, narrowed to the clearing. An ordinary UPDATE is at depth 1 and is
-- treated as before; authors-deletable.test.sql asserts both halves.

create or replace function public.trigger_set_user_tracking () returns trigger
set
  search_path = '' as $$
begin
    if TG_OP = 'INSERT' then
        new.created_by = auth.uid();
        new.updated_by = auth.uid();

    else
        -- A foreign key clearing a deleted author (FILM-CC-04 KB-1)
        if pg_trigger_depth() > 1
           and ((old.created_by is not null and new.created_by is null)
             or (old.updated_by is not null and new.updated_by is null)) then
            return new;
        end if;

        new.updated_by = auth.uid();

        new.created_by = old.created_by;

    end if;

    return NEW;

end
$$ language plpgsql;

create or replace function kit.prevent_memberships_update () returns trigger
set
  search_path = '' as $$
begin
    if new.account_role <> old.account_role then
        return new;
    end if;

    -- A foreign key clearing a deleted author is not a member editing a
    -- membership (FILM-CC-04 KB-1)
    if pg_trigger_depth() > 1
       and ((old.created_by is not null and new.created_by is null)
         or (old.updated_by is not null and new.updated_by is null)) then
        return new;
    end if;

    raise exception 'Only the account_role can be updated';

end; $$ language plpgsql;

CREATE OR REPLACE FUNCTION enforce_verified_facts_update_rules()
RETURNS TRIGGER AS $$
BEGIN
  -- A foreign key clearing a deleted author, editor or verifier (FILM-CC-04
  -- KB-1). Not an edit: the fact keeps its verification, and updated_by is
  -- not restamped.
  IF pg_trigger_depth() > 1
     AND ((OLD.created_by IS NOT NULL AND NEW.created_by IS NULL)
       OR (OLD.updated_by IS NOT NULL AND NEW.updated_by IS NULL)
       OR (OLD.verified_by IS NOT NULL AND NEW.verified_by IS NULL)) THEN
    RETURN NEW;
  END IF;

  -- Prevent moving facts between projects
  IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    RAISE EXCEPTION 'Cannot move a fact to a different project';
  END IF;

  -- Protect audit columns
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Cannot change created_by';
  END IF;

  -- If any content or source field changed, reset verification to unverified
  IF NEW.claim IS DISTINCT FROM OLD.claim
     OR NEW.source_type IS DISTINCT FROM OLD.source_type
     OR NEW.source_citation IS DISTINCT FROM OLD.source_citation
     OR NEW.source_url IS DISTINCT FROM OLD.source_url
     OR NEW.source_title IS DISTINCT FROM OLD.source_title
     OR NEW.source_authors IS DISTINCT FROM OLD.source_authors
     OR NEW.source_publication_date IS DISTINCT FROM OLD.source_publication_date
     OR NEW.source_doi IS DISTINCT FROM OLD.source_doi
  THEN
    NEW.verification_status := 'unverified';
    NEW.verified_by := NULL;
    NEW.verified_at := NULL;
  END IF;

  -- Set updated_by to current user
  NEW.updated_by := auth.uid();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------
-- 2. The keys
-- ----------------------------------

-- Makerkit core (diverges from the upstream kit, see above)
alter table public.accounts
  drop constraint accounts_created_by_fkey,
  add constraint accounts_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

alter table public.accounts
  drop constraint accounts_updated_by_fkey,
  add constraint accounts_updated_by_fkey
    foreign key (updated_by) references auth.users(id) on delete set null;

alter table public.accounts_memberships
  drop constraint accounts_memberships_created_by_fkey,
  add constraint accounts_memberships_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

alter table public.accounts_memberships
  drop constraint accounts_memberships_updated_by_fkey,
  add constraint accounts_memberships_updated_by_fkey
    foreign key (updated_by) references auth.users(id) on delete set null;

-- Projects
alter table public.projects
  drop constraint projects_created_by_fkey,
  add constraint projects_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

alter table public.projects
  drop constraint projects_updated_by_fkey,
  add constraint projects_updated_by_fkey
    foreign key (updated_by) references auth.users(id) on delete set null;

alter table public.project_members
  drop constraint project_members_created_by_fkey,
  add constraint project_members_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

alter table public.project_members
  drop constraint project_members_updated_by_fkey,
  add constraint project_members_updated_by_fkey
    foreign key (updated_by) references auth.users(id) on delete set null;

alter table public.project_intros
  drop constraint project_intros_created_by_fkey,
  add constraint project_intros_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

-- Facts
alter table public.verified_facts
  drop constraint verified_facts_created_by_fkey,
  add constraint verified_facts_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

alter table public.verified_facts
  drop constraint verified_facts_updated_by_fkey,
  add constraint verified_facts_updated_by_fkey
    foreign key (updated_by) references auth.users(id) on delete set null;

-- An audit column: the fact stays verified, by nobody who can be named. A
-- snapshot of the verifier's name would keep that; it is an open question for
-- the owner (FILM-CC-04), and nulling is still better than refusing the delete.
alter table public.verified_facts
  drop constraint verified_facts_verified_by_fkey,
  add constraint verified_facts_verified_by_fkey
    foreign key (verified_by) references auth.users(id) on delete set null;

alter table public.episode_facts
  drop constraint episode_facts_linked_by_fkey,
  add constraint episode_facts_linked_by_fkey
    foreign key (linked_by) references auth.users(id) on delete set null;

alter table public.fact_extraction_jobs
  drop constraint fact_extraction_jobs_created_by_fkey,
  add constraint fact_extraction_jobs_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

-- Canon. immutable_events is the other audit column; same note as verified_by.
alter table public.immutable_events
  drop constraint immutable_events_created_by_fkey,
  add constraint immutable_events_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

alter table public.character_states
  drop constraint character_states_created_by_fkey,
  add constraint character_states_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

-- Social posts
alter table public.social_posts
  drop constraint social_posts_created_by_fkey,
  add constraint social_posts_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;
