/*
 * Remove the account budget machinery.
 *
 * Owner decision, 2026-09-25: "Remove the budget machinery". It never did
 * anything a user could reach. `monthly_budget_cents` defaulted to NULL
 * (unlimited), and nothing in the app set it: FILM-905's settings page was
 * retired, and the admin account page only displayed it. So every budget
 * check answered "allowed", and the usage counter only grew; nothing reset
 * it (KB-96), and music and SFX never counted (KB-97).
 *
 * This drops:
 *
 * - the functions `check_account_budget` (KB-42 gave it an access check),
 *   `increment_account_usage` (service role only since KB-83) and
 *   `reset_monthly_usage` (never called);
 * - the columns `accounts.current_usage_cents` and
 *   `accounts.monthly_budget_cents`. They held only the counter and the cap;
 *   the drop was approved by the owner;
 * - KB-83's `current_usage_cents` clause in `kit.protect_account_fields`,
 *   which is restored to its original list (20221215192558_schema.sql).
 *
 * Per-generation cost stays where it always was: `generation_jobs.cost_cents`
 * and `estimated_cost_cents`, which this does not touch.
 *
 * Tests: tests/database/account-budget-retired.test.sql, and the repo scan
 * apps/web/test/account-budget-retired.test.ts.
 */

drop function if exists public.check_account_budget(uuid, integer);
drop function if exists public.increment_account_usage(uuid, integer);
drop function if exists public.reset_monthly_usage();

create or replace function kit.protect_account_fields () returns trigger as $$
begin
    if current_user in('authenticated', 'anon') then
	if new.id <> old.id or new.is_personal_account <>
	    old.is_personal_account or new.primary_owner_user_id <>
	    old.primary_owner_user_id or new.email <> old.email then
            raise exception 'You do not have permission to update this field';

        end if;

    end if;

    return NEW;

end
$$ language plpgsql
set
  search_path = '';

alter table public.accounts
  drop column if exists current_usage_cents,
  drop column if exists monthly_budget_cents;
