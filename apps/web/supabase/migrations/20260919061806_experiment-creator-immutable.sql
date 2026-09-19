-- ==================================
-- An experiment's creator cannot be rewritten (FILM-1610 review, round 3)
-- ==================================
-- analytics_experiments_set_creator sets created_by on insert, but the update
-- policy allows any column, so a member could change it afterwards. Keep the
-- original on every update, except when a foreign-key action nulls it — the
-- same exception as the note audit trigger, since created_by references
-- auth.users and a user deletion arrives here nested inside that constraint.

create or replace function public.keep_experiment_creator()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  new.created_by = old.created_by;
  return new;
end;
$$;

create trigger analytics_experiments_keep_creator
  before update of created_by on public.analytics_experiments
  for each row execute function public.keep_experiment_creator();

-- ----------------------------------
-- Deleting a user who created an experiment
-- ----------------------------------
-- created_by referenced auth.users with no ON DELETE action, so deleting any
-- user who had ever logged an experiment failed on this constraint. The
-- experiment belongs to the account, not to its author: null the author and
-- keep the row, as analytics_note_updated_by already does.

alter table public.analytics_experiments
  drop constraint analytics_experiments_created_by_fkey;

alter table public.analytics_experiments
  add constraint analytics_experiments_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

-- The same defect on the other analytics tables that record an author: a
-- user who had ever created a tag or a hook test could not be deleted.
alter table public.content_tags
  drop constraint content_tags_created_by_fkey;

alter table public.content_tags
  add constraint content_tags_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table public.hook_tests
  drop constraint hook_tests_created_by_fkey;

alter table public.hook_tests
  add constraint hook_tests_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;
