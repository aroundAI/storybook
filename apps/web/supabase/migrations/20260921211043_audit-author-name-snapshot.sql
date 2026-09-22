-- ==================================
-- Audit records keep their author's name (FILM-CC-04 KB-1)
-- ==================================
-- Owner decision, 2026-09-22. 20260921205124 made every authorship key
-- ON DELETE SET NULL so that a user can be deleted. For two of them the author
-- is the point of the record — who established a canon event, who verified a
-- fact — and losing it with the account loses the audit. Those two now keep
-- the author's name beside the key:
--
--     immutable_events.created_by  ->  created_by_name
--     verified_facts.verified_by   ->  verified_by_name
--
-- The key still goes to NULL on deletion; the name stays.
--
-- Which name: the display name the app already shows for a user, their
-- personal account's `accounts.name` (accounts.id = auth.users.id). Not the
-- email — keeping an address after its owner deleted their account is a
-- privacy question this does not need to raise. (`kit.setup_new_user` falls
-- back to the email's local part when a user signs up without a name, so that
-- fragment can be what the name *is*; it is what every screen shows already.)
--
-- When: as the author is written, by trigger — never at delete time, where one
-- missed hook on a schema we do not own would lose the name for good. A rename
-- afterwards does not rewrite the record: it says who they were then.
--
-- From whom: from the id, never from the client. Whatever a caller sends in
-- the name column is discarded, on insert and on update, for every role.

alter table public.immutable_events add column created_by_name text;
alter table public.verified_facts add column verified_by_name text;

comment on column public.immutable_events.created_by_name is
  'Display name of created_by when it was written. Set by trigger from the id; kept when the user is deleted and created_by goes to NULL.';
comment on column public.verified_facts.verified_by_name is
  'Display name of verified_by when the fact was verified. Set by trigger from the id; kept when the user is deleted and verified_by goes to NULL, dropped when the verification is.';

-- The one place the name comes from.
create or replace function kit.author_display_name(author uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(btrim(name), '')
    from public.accounts
   where id = author
     and is_personal_account;
$$;

revoke all on function kit.author_display_name(uuid) from public, anon, authenticated;

-- ----------------------------------
-- immutable_events.created_by_name
-- ----------------------------------
-- The name changes only when created_by is pointed at a user. Clearing
-- created_by — the foreign key's SET NULL, or anything else — leaves it.
-- SECURITY DEFINER: a member cannot read a colleague's personal account, and
-- the name of whoever created_by names must not depend on who is asking.

create or replace function public.immutable_events_snapshot_creator_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by_name := kit.author_display_name(new.created_by);
  elsif new.created_by is not null
        and new.created_by is distinct from old.created_by then
    new.created_by_name := kit.author_display_name(new.created_by);
  else
    new.created_by_name := old.created_by_name;
  end if;

  return new;
end;
$$;

create trigger immutable_events_snapshot_creator_name
  before insert or update on public.immutable_events
  for each row execute function public.immutable_events_snapshot_creator_name();

-- ----------------------------------
-- verified_facts.verified_by_name
-- ----------------------------------
-- The name lasts as long as the verification. With a verifier, it is theirs
-- (looked up when the verifier changes, kept otherwise). With none, it is kept
-- only while verified_at still records a verification — which is the state a
-- deleted verifier leaves — and dropped when the fact is un-verified.
--
-- Named to sort after enforce_verified_facts_update: BEFORE triggers fire in
-- name order, and that one clears verified_by and verified_at when the claim
-- is edited. This has to see its decision. audit-author-snapshot.test.sql
-- fails if the order is ever lost.

create or replace function public.verified_facts_snapshot_verifier_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.verified_by is not null then
    if tg_op = 'UPDATE' and new.verified_by is not distinct from old.verified_by then
      new.verified_by_name := old.verified_by_name;
    else
      new.verified_by_name := kit.author_display_name(new.verified_by);
    end if;
  elsif tg_op = 'UPDATE' and new.verified_at is not null then
    new.verified_by_name := old.verified_by_name;
  else
    new.verified_by_name := null;
  end if;

  return new;
end;
$$;

create trigger verified_facts_snapshot_verifier_name
  before insert or update on public.verified_facts
  for each row execute function public.verified_facts_snapshot_verifier_name();

-- ----------------------------------
-- Existing rows
-- ----------------------------------
-- Written directly, with the tables' own triggers off: the update rules on
-- verified_facts would otherwise stamp updated_by = auth.uid() — NULL here —
-- over every backfilled row, and move updated_at. Rows whose author was
-- already deleted have nothing to recover; none can exist before
-- 20260921205124, since the delete was refused.

alter table public.immutable_events disable trigger user;

update public.immutable_events e
   set created_by_name = kit.author_display_name(e.created_by)
 where e.created_by is not null;

alter table public.immutable_events enable trigger user;

alter table public.verified_facts disable trigger user;

update public.verified_facts f
   set verified_by_name = kit.author_display_name(f.verified_by)
 where f.verified_by is not null;

alter table public.verified_facts enable trigger user;
