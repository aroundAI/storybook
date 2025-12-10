import { PlatformConnections } from '@kit/publishing/components/platform-connections';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import { createI18nServerInstance } from '~/lib/i18n/i18n.server';

import { TeamAccountLayoutPageHeader } from '../../_components/team-account-layout-page-header';
import { loadTeamWorkspace } from '../../_lib/server/team-account-workspace.loader';

export const generateMetadata = async () => {
  const i18n = await createI18nServerInstance();
  const title = i18n.t('platforms:pageTitle');

  return {
    title,
  };
};

interface PlatformConnectionsPageProps {
  params: Promise<{ account: string }>;
}

async function PlatformConnectionsPage(props: PlatformConnectionsPageProps) {
  const slug = (await props.params).account;
  const workspace = await loadTeamWorkspace(slug);
  const accountId = workspace.account.id;

  return (
    <>
      <TeamAccountLayoutPageHeader
        account={slug}
        title={<Trans i18nKey="platforms:pageTitle" />}
        description={<AppBreadcrumbs />}
      />

      <PageBody>
        <div className="flex max-w-2xl flex-1 flex-col space-y-6">
          <div>
            <h1 className="text-2xl font-bold">
              <Trans i18nKey="platforms:pageTitle" />
            </h1>
            <p className="text-muted-foreground">
              <Trans i18nKey="platforms:pageDescription" />
            </p>
          </div>

          <PlatformConnections accountSlug={slug} accountId={accountId} />
        </div>
      </PageBody>
    </>
  );
}

export default PlatformConnectionsPage;
