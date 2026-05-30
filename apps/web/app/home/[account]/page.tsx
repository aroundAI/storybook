import { Suspense } from 'react';

import { CompanyDashboardSkeleton } from '@kit/content-analytics/components';
import { getAccountDashboardData } from '@kit/content-analytics/server';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import { withI18n } from '~/lib/i18n/with-i18n';

import { LazyCompanyDashboard } from './_components/lazy-company-dashboard';
import { TeamAccountLayoutPageHeader } from './_components/team-account-layout-page-header';
import { loadTeamWorkspace } from './_lib/server/team-account-workspace.loader';

interface TeamAccountHomePageProps {
  params: Promise<{ account: string }>;
}

export const generateMetadata = async () => {
  const i18n = await createI18nServerInstance();
  const title = i18n.t('teams:home.pageTitle');

  return {
    title,
  };
};

async function DashboardContent({ accountId }: { accountId: string }) {
  const data = await getAccountDashboardData(accountId);
  return <LazyCompanyDashboard accountId={accountId} data={data} />;
}

async function TeamAccountHomePage({ params }: TeamAccountHomePageProps) {
  const account = (await params).account;

  // Load workspace to get accountId
  const workspace = await loadTeamWorkspace(account);
  const accountId = workspace.account.id;

  return (
    <>
      <TeamAccountLayoutPageHeader
        account={account}
        title={<Trans i18nKey={'common:routes.dashboard'} />}
        description={<AppBreadcrumbs />}
      />

      <PageBody>
        <Suspense fallback={<CompanyDashboardSkeleton />}>
          <DashboardContent accountId={accountId} />
        </Suspense>
      </PageBody>
    </>
  );
}

export default withI18n(TeamAccountHomePage);
