-- ==================================
-- Facts can be verified and disputed (FILM-CC-04 KB-18)
-- ==================================
-- The UPDATE policy on verified_facts admits owners, admins and members, and
-- its WITH CHECK requires the new row to be unverified or pending_review with
-- no verifier. That refusal is right for members, and KB-1's tests rely on it,
-- so it stays. But it was never paired with a path for the people who may
-- verify, and verifyFactAction / disputeFactAction wrote through it with the
-- user's client: every review was refused, for every user, owner included.
--
-- This function is that path, and the only one an end user has into
-- `verified` or `disputed`:
--
--   * who: an owner or admin of the fact's project (public.can_edit_project),
--     the rule the DELETE policy, projects_update and the Fact Library link
--     already use. Not the account role the actions used to check, which
--     disagreed with the policies and turned some reviews into silent no-ops.
--   * verified_by is auth.uid(), set here. There is no parameter to name
--     anyone else.
--   * which transitions: unverified or pending_review to verified or disputed.
--     Anything else is refused rather than applied, so a review made from a
--     stale page cannot overwrite another reviewer's decision. A fact is
--     reopened by editing it: enforce_verified_facts_update_rules resets an
--     edited claim or source to unverified.
--
-- It runs as the table owner, so row security does not apply inside it; each
-- check above is explicit, and verified-facts-review.test.sql exercises every
-- one as a real role. The table's BEFORE UPDATE triggers still fire:
-- updated_by is stamped with the caller and verified_by_name is taken from
-- verified_by (20260921211043).
--
-- Refusals are raised with an SQLSTATE the server action maps to a sentence:
--   42501  not an owner or admin of the project
--   P0002  no such fact, or one the caller cannot see (the same answer, so a
--          stranger learns nothing about another account's facts)
--   55000  already reviewed; DETAIL carries the current status
--   22023  not a review outcome, or a dispute without a reason

create or replace function public.set_fact_verification(
  target_fact_id uuid,
  outcome public.verification_status_enum,
  notes text default null
)
returns public.verification_status_enum
language plpgsql
security definer
set search_path = ''
as $$
declare
  fact record;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if outcome is null or outcome not in ('verified', 'disputed') then
    raise exception 'A review can only verify or dispute a fact'
      using errcode = '22023';
  end if;

  if outcome = 'disputed' and coalesce(btrim(notes), '') = '' then
    raise exception 'A reason is required to dispute a fact'
      using errcode = '22023';
  end if;

  select f.project_id, f.verification_status, p.account_id
    into fact
    from public.verified_facts f
    join public.projects p on p.id = f.project_id
   where f.id = target_fact_id
     for update of f;

  if not found then
    raise exception 'Fact not found' using errcode = 'P0002';
  end if;

  if not public.can_edit_project(fact.project_id) then
    if not public.has_role_on_account(fact.account_id) then
      raise exception 'Fact not found' using errcode = 'P0002';
    end if;

    raise exception 'Only the project''s owner or admins can review facts'
      using errcode = '42501';
  end if;

  if fact.verification_status not in ('unverified', 'pending_review') then
    raise exception 'Fact is already %', fact.verification_status
      using errcode = '55000', detail = fact.verification_status::text;
  end if;

  update public.verified_facts
     set verification_status = outcome,
         verified_by = case when outcome = 'verified' then auth.uid() end,
         verified_at = case when outcome = 'verified' then now() end,
         verification_notes = nullif(btrim(notes), '')
   where id = target_fact_id;

  return outcome;
end;
$$;

revoke all on function public.set_fact_verification(uuid, public.verification_status_enum, text)
  from public, anon;

grant execute on function public.set_fact_verification(uuid, public.verification_status_enum, text)
  to authenticated;

comment on function public.set_fact_verification(uuid, public.verification_status_enum, text) is
  'KB-18: the only end-user path to verified/disputed. Project owner/admin only (can_edit_project); verified_by is always auth.uid(); only unverified/pending_review facts can be reviewed.';

comment on policy "Users can update facts for their projects" on public.verified_facts is
  'Members may edit a fact but never into verified/disputed, nor name a verifier. Owners and admins review through public.set_fact_verification (KB-18).';
