import { listMcpConnections } from '@kit/studio-mcp/server';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import { withI18n } from '~/lib/i18n/with-i18n';

import { TeamAccountLayoutPageHeader } from '../../_components/team-account-layout-page-header';
import { loadTeamWorkspace } from '../../_lib/server/team-account-workspace.loader';
import { ConnectedAppsSettings } from './_components/connected-apps-settings';

export const generateMetadata = async () => {
  const i18n = await createI18nServerInstance();
  const title = i18n.t('common:routes.connectedApps', {
    defaultValue: 'Connected apps',
  });

  return { title };
};

interface PageProps {
  params: Promise<{ account: string }>;
}

async function ConnectedAppsPage(props: PageProps) {
  const slug = (await props.params).account;
  const workspace = await loadTeamWorkspace(slug);
  const client = getSupabaseServerClient();
  const connections = await listMcpConnections(client, workspace.account.id);

  return (
    <>
      <TeamAccountLayoutPageHeader
        account={slug}
        title={
          <Trans
            i18nKey="common:routes.connectedApps"
            defaults="Connected apps"
          />
        }
        description={<AppBreadcrumbs />}
      />

      <PageBody>
        <div className="flex max-w-4xl flex-1 flex-col space-y-8">
          <p className="text-sm text-muted-foreground">
            MCP clients such as Claude Desktop connect to StoryBook at{' '}
            <code>/api/mcp</code> with a token from this page, and act as you
            inside this team.
          </p>

          <ConnectedAppsSettings accountSlug={slug} connections={connections} />
        </div>
      </PageBody>
    </>
  );
}

export default withI18n(ConnectedAppsPage);
