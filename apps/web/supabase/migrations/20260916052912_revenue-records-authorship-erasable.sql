-- Authorship may be erased. It may not be moved.
--
-- 20260916010318 froze `created_by` against any change, to stop a project
-- member seizing a colleague's entry and with it the delete right that column
-- grants. The rule was right and the statement of it was too broad.
--
-- `created_by uuid references auth.users(id) on delete set null` is
-- implemented by Postgres as an internal `UPDATE ONLY public.revenue_records
-- SET created_by = NULL`, and a user-defined BEFORE UPDATE FOR EACH ROW
-- trigger fires on that like any other update. So the freeze rejected the
-- foreign key's own set-null and aborted the DELETE:
--
--     ERROR:  revenue_records.created_by is immutable
--     CONTEXT: SQL statement "UPDATE ONLY "public"."revenue_records"
--              SET "created_by" = NULL WHERE $1 OPERATOR(pg_catalog.=) "created_by""
--
-- **Anyone who had ever saved a single manual revenue entry became
-- undeletable**, which takes `deleteUserAction` and personal-account
-- self-deletion with it — a path that has to work for reasons beyond this
-- feature.
--
-- The narrower rule: a change is refused only when it names somebody. Erasing
-- is allowed, which is what the foreign key needs; claiming (null -> someone)
-- and transferring (someone -> someone else) stay refused, which is the whole
-- of the escalation.
--
-- A member can now also null a colleague's authorship by hand. That is
-- vandalism rather than escalation — they could already edit the row, it
-- grants them nothing, and it costs them the delete right if the row was
-- theirs. Blocking it precisely would mean asking whether the old author still
-- exists, which needs a privileged read of `auth.users` from inside a trigger
-- on every update; the cost is not worth the difference.

create or replace function public.revenue_records_freeze_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_by is not null
     and new.created_by is distinct from old.created_by then
    raise exception 'revenue_records.created_by is immutable'
      using hint = 'Authorship is recorded on insert. A correction does not transfer it, and a deleted user''s entries keep their figures without an author.';
  end if;

  return new;
end;
$$;

comment on function public.revenue_records_freeze_created_by() is
  'Rejects any UPDATE that points revenue_records.created_by at a user. The update and delete policies authorize on that column, so letting a writer set it lets them choose who those policies answer to. Clearing it is allowed: the auth.users foreign key does exactly that, as an UPDATE, when an author is deleted.';
