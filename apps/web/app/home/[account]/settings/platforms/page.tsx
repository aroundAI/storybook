import { Settings2 } from 'lucide-react';

import {
  OAuthAppConfig,
  PlatformConnections,
} from '@kit/publishing/components';
import {
  getAccountOAuthApps,
} from '@kit/publishing/server';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody } from '@kit/ui/page';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { Trans } from '@kit/ui/trans';

import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import { withI18n } from '~/lib/i18n/with-i18n';

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

  // Fetch OAuth apps for the account
  const oauthApps = await getAccountOAuthApps(accountId);

  return (
    <>
      <TeamAccountLayoutPageHeader
        account={slug}
        title={<Trans i18nKey="platforms:pageTitle" />}
        description={<AppBreadcrumbs />}
      />

      <PageBody>
        <div className="flex max-w-4xl flex-1 flex-col">
          <Tabs defaultValue="credentials" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="credentials">
                <Settings2 className="mr-2 h-4 w-4" />
                App Credentials
              </TabsTrigger>
              <TabsTrigger value="connections">
                Connect Accounts
              </TabsTrigger>
            </TabsList>

            <TabsContent value="credentials" className="mt-6">
              <OAuthAppConfig
                accountId={accountId}
                existingApps={oauthApps}
              />
            </TabsContent>

            <TabsContent value="connections" className="mt-6">
              <PlatformConnections
                accountSlug={slug}
                accountId={accountId}
              />
            </TabsContent>
          </Tabs>
        </div>
      </PageBody>
    </>
  );
}

export default withI18n(PlatformConnectionsPage);
