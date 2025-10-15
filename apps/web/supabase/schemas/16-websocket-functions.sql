/*
 * -------------------------------------------------------
 * Section: WebSocket Authorization Functions
 * Functions to support WebSocket authorization checks
 * -------------------------------------------------------
 */

/**
 * Check if two users share a team membership (atomic query)
 * This function uses a JOIN to check if sender and target share any account_id
 * in a single atomic query, preventing TOCTOU race conditions.
 *
 * @param sender_user_id - The userId of the sender
 * @param target_user_id - The userId of the target
 * @returns true if users share at least one team account, false otherwise
 */
create or replace function public.check_shared_team_membership(
  sender_user_id uuid,
  target_user_id uuid
) returns boolean
language sql
security invoker
set search_path = '' as $$
  select exists (
    select 1
    from public.accounts_memberships sender_accts
    inner join public.accounts_memberships target_accts
      on sender_accts.account_id = target_accts.account_id
    where sender_accts.user_id = sender_user_id
      and target_accts.user_id = target_user_id
  );
$$;

-- Grant execute permission to service_role for WebSocket handlers
grant execute on function public.check_shared_team_membership(uuid, uuid) to service_role;

comment on function public.check_shared_team_membership is
  'Atomically checks if two users share any team account membership. Used by WebSocket handlers for authorization.';
