/*
 * KB-83: voice spend is counted, and nobody but the server can move the
 * counter.
 *
 * `increment_account_usage` stays EXECUTE-able by the service role only.
 * The voice actions now call it with the server's client, for the account
 * they have already authorised (KB-46's LlmJobTarget), and the voice worker
 * with its own service-role client. Granting it to `authenticated` instead
 * would let any writer on a team call it directly with any amount and use
 * up the team's budget, so it is not granted.
 *
 * Two things this adds:
 *
 * 1. The function refuses a negative (or null) amount, for every caller. A
 *    counter of spend only goes up.
 *
 * 2. `kit.protect_account_fields` refuses a change to `current_usage_cents`
 *    from an API role. Reproduced before this migration: an account's
 *    primary owner could `update accounts set current_usage_cents = -1000`
 *    over PostgREST (`accounts_self_update` allows it, and the trigger did
 *    not cover the column). `monthly_budget_cents` stays writable by the
 *    owner: their own cap is theirs to set (owner decision, 2026-09-24).
 *    SECURITY DEFINER functions run as their owner, and the service role is
 *    not an API role here, so the increment and admin writes still pass.
 *
 * Tests: tests/database/account-usage.test.sql.
 */

create or replace function public.increment_account_usage(
  p_account_id uuid,
  p_amount_cents integer
)
returns table (
  new_usage_cents integer,
  budget_cents integer,
  is_over_budget boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_usage integer;
  v_budget integer;
begin
  if p_amount_cents is null or p_amount_cents < 0 then
    raise exception 'Usage can only be increased: %', p_amount_cents
      using errcode = '22023';
  end if;

  update public.accounts
  set current_usage_cents = current_usage_cents + p_amount_cents,
      updated_at = now()
  where id = p_account_id
  returning current_usage_cents, monthly_budget_cents
  into v_new_usage, v_budget;

  if not found then
    raise exception 'Account not found: %', p_account_id;
  end if;

  return query select
    v_new_usage,
    v_budget,
    case
      when v_budget is null then false
      else v_new_usage > v_budget
    end;
end;
$$;

revoke all on function public.increment_account_usage(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.increment_account_usage(uuid, integer)
  to service_role;

create or replace function kit.protect_account_fields () returns trigger as $$
begin
    if current_user in('authenticated', 'anon') then
	if new.id <> old.id or new.is_personal_account <>
	    old.is_personal_account or new.primary_owner_user_id <>
	    old.primary_owner_user_id or new.email <> old.email
	    or new.current_usage_cents is distinct from old.current_usage_cents then
            raise exception 'You do not have permission to update this field';

        end if;

    end if;

    return NEW;

end
$$ language plpgsql
set
  search_path = '';
