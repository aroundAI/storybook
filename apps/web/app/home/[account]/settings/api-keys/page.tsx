import { ApiKeysSettings } from '@kit/film-studio/components';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import { createI18nServerInstance } from '~/lib/i18n/i18n.server';

import { TeamAccountLayoutPageHeader } from '../../_components/team-account-layout-page-header';

export const generateMetadata = async () => {
  const i18n = await createI18nServerInstance();
  const title = i18n.t('teams:apiKeys.pageTitle');

  return {
    title,
    description: i18n.t('teams:apiKeys.pageDescription'),
  };
};

interface ApiKeysPageProps {
  params: Promise<{ account: string }>;
}

async function ApiKeysPage(props: ApiKeysPageProps) {
  const { account } = await props.params;

  return (
    <>
      <TeamAccountLayoutPageHeader
        account={account}
        title={<Trans i18nKey="teams:apiKeys.pageTitle" />}
        description={<AppBreadcrumbs />}
      />

      <PageBody>
        <div className="flex max-w-4xl flex-1 flex-col space-y-6">
          <div>
            <h1 className="text-2xl font-bold">
              <Trans i18nKey="teams:apiKeys.pageTitle" />
            </h1>
            <p className="text-muted-foreground">
              <Trans i18nKey="teams:apiKeys.pageDescription" />
            </p>
          </div>

          <ApiKeysSettings accountSlug={account} />
        </div>
      </PageBody>
    </>
  );
}

export default ApiKeysPage;
