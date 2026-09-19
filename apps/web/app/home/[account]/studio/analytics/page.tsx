import { Suspense } from 'react';

import {
  RevenueDashboard,
  RevenueDashboardSkeleton,
} from '@kit/content-analytics/components';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { createTeamAccountsApi } from '@kit/team-accounts/api';
import { Heading } from '@kit/ui/heading';

import { withI18n } from '~/lib/i18n/with-i18n';

export const metadata = {
  title: 'Revenue Analytics | Film Studio',
  description: 'Track your earnings across all platforms',
};

interface PageProps {
  params: Promise<{ account: string }>;
}

async function RevenueAnalyticsPage({ params }: PageProps) {
  const { account } = await params;

  // Get the account ID from the slug
  const client = getSupabaseServerClient();
  const api = createTeamAccountsApi(client);
  const accountData = await api.getTeamAccount(account);

  if (!accountData) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center">
          <Heading level={2}>Account not found</Heading>
          <p className="mt-2 text-muted-foreground">
            The requested account could not be found.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <Suspense fallback={<RevenueDashboardSkeleton />}>
        <RevenueDashboard accountId={accountData.id} />
      </Suspense>
    </div>
  );
}

export default withI18n(RevenueAnalyticsPage);
