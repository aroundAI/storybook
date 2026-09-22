import { PlatformConnections } from '@kit/publishing/components';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import { PlatformConnectFailure } from '~/components/platform-connect-failure';
import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import { withI18n } from '~/lib/i18n/with-i18n';
import {
  connectFailurePath,
  readConnectFailure,
} from '~/lib/platforms/connect-failure';

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
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function PlatformConnectionsPage(props: PlatformConnectionsPageProps) {
  const slug = (await props.params).account;
  const workspace = await loadTeamWorkspace(slug);
  const accountId = workspace.account.id;
  const failure = readConnectFailure(await props.searchParams);

  return (
    <>
      <TeamAccountLayoutPageHeader
        account={slug}
        title={<Trans i18nKey="platforms:pageTitle" />}
        description={<AppBreadcrumbs />}
      />

      <PageBody>
        <div
          className="flex max-w-4xl flex-1 flex-col"
          data-test="platform-connections"
        >
          {failure && (
            <PlatformConnectFailure
              failure={failure}
              dismissHref={connectFailurePath(slug)}
            />
          )}

          <PlatformConnections accountSlug={slug} accountId={accountId} />
        </div>
      </PageBody>
    </>
  );
}

export default withI18n(PlatformConnectionsPage);
