-- FILM-809 / KB-99. generated_reports (20260930140000) has an FK to accounts
-- but was created after the KB-99 guard, so a personal account could hold
-- rows. Same trigger as every other account-keyed workspace table.

do $$
declare
  n bigint;
begin
  select count(*) into n
  from public.generated_reports t
  join public.accounts a on a.id = t.account_id
  where a.is_personal_account;

  if n > 0 then
    raise exception 'KB-99: generated_reports has % rows on personal accounts; nothing was changed', n;
  end if;
end;
$$;

create trigger require_team_account
  before insert or update of account_id on public.generated_reports
  for each row execute function kit.require_team_account();
