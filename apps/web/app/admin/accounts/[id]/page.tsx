import { cache } from 'react';

import { AdminAccountPage } from '@kit/admin/components/admin-account-page';
import { AdminGuard } from '@kit/admin/components/admin-guard';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

interface Params {
  params: Promise<{
    id: string;
  }>;
}

export const generateMetadata = async (props: Params) => {
  const params = await props.params;
  const account = await loadAccount(params.id);

  return {
    title: `Admin | ${account.name}`,
  };
};

async function AccountPage(props: Params) {
  const params = await props.params;
  const account = await loadAccount(params.id);

  return <AdminAccountPage account={account} />;
}

export default AdminGuard(AccountPage);

const loadAccount = cache(accountLoader);

async function accountLoader(id: string) {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from('accounts')
    .select(`
      id, name, slug, email, picture_url, is_personal_account,
      primary_owner_user_id, created_at, updated_at,
      created_by, updated_by, current_usage_cents, monthly_budget_cents, public_data, public_profile,
      memberships: accounts_memberships (
        account_id, user_id, account_role, created_at, updated_at, created_by, updated_by
      )
    `)
    .eq('id', id)
    .single();

  if (error) {
    throw error;
  }

  return data;
}
