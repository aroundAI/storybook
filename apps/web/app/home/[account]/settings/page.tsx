import { ApiKeysSettings } from '@kit/film-studio/components';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { createTeamAccountsApi } from '@kit/team-accounts/api';
import { TeamAccountSettingsContainer } from '@kit/team-accounts/components';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import featuresFlagConfig from '~/config/feature-flags.config';
import pathsConfig from '~/config/paths.config';
import { createI18nServerInstance } from '~/lib/i18n/i18n.server';

// local imports
import { TeamAccountLayoutPageHeader } from '../_components/team-account-layout-page-header';

export const generateMetadata = async () => {
  const i18n = await createI18nServerInstance();
  const title = i18n.t('teams:settings:pageTitle');

  return {
    title,
  };
};

interface TeamAccountSettingsPageProps {
  params: Promise<{ account: string }>;
}

const paths = {
  teamAccountSettings: pathsConfig.app.accountSettings,
};

async function TeamAccountSettingsPage(props: TeamAccountSettingsPageProps) {
  const api = createTeamAccountsApi(getSupabaseServerClient());
  const slug = (await props.params).account;
  const data = await api.getTeamAccount(slug);

  const account = {
    id: data.id,
    name: data.name,
    pictureUrl: data.picture_url,
    slug: data.slug as string,
    primaryOwnerUserId: data.primary_owner_user_id,
  };

  const features = {
    enableTeamDeletion: featuresFlagConfig.enableTeamDeletion,
  };

  return (
    <>
      <TeamAccountLayoutPageHeader
        account={account.slug}
        title={<Trans i18nKey={'teams:settings.pageTitle'} />}
        description={<AppBreadcrumbs />}
      />

      <PageBody>
        <div className={'flex max-w-2xl flex-1 flex-col space-y-8'}>
          <TeamAccountSettingsContainer
            account={account}
            paths={paths}
            features={features}
          />

          {/* API Keys Section */}
          <div className="border-t pt-8">
            <h2 className="text-xl font-semibold mb-2">
              <Trans i18nKey="teams:apiKeys.pageTitle" defaults="API Keys" />
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              <Trans i18nKey="teams:apiKeys.pageDescription" defaults="Manage API keys for external services like ElevenLabs" />
            </p>
            <ApiKeysSettings accountSlug={account.slug} />
          </div>
        </div>
      </PageBody>
    </>
  );
}

export default TeamAccountSettingsPage;

