create policy delete_team_account
    on public.accounts
    for delete
    to authenticated
    using (
        auth.uid() = primary_owner_user_id
    );