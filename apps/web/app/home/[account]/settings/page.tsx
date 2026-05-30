import {
  MultiFactorAuthFactorsList,
  UpdatePasswordFormContainer,
} from '@kit/accounts/personal-account-settings';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { createTeamAccountsApi } from '@kit/team-accounts/api';
import { TeamAccountSettingsContainer } from '@kit/team-accounts/components';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import featuresFlagConfig from '~/config/feature-flags.config';
import pathsConfig from '~/config/paths.config';
import { createI18nServerInstance } from '~/lib/i18n/i18n.server';

// local imports
import { TeamAccountLayoutPageHeader } from '../_components/team-account-layout-page-header';
import { ApiKeysSettings } from './_components/api-keys-settings';

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
  const client = getSupabaseServerClient();
  const api = createTeamAccountsApi(client);
  const slug = (await props.params).account;
  const [
    data,
    {
      data: { user },
    },
  ] = await Promise.all([api.getTeamAccount(slug), client.auth.getUser()]);

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

  const callbackPath = `/home/${account.slug}/settings`;

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
            <h2 className="mb-2 text-xl font-semibold">
              <Trans i18nKey="teams:apiKeys.pageTitle" defaults="API Keys" />
            </h2>
            <p className="text-muted-foreground mb-6 text-sm">
              <Trans
                i18nKey="teams:apiKeys.pageDescription"
                defaults="Manage API keys for external services like ElevenLabs"
              />
            </p>
            <ApiKeysSettings accountSlug={account.slug} />
          </div>

          {/* Personal Settings Section (for MFA, password) */}
          {user && (
            <div className="border-t pt-8">
              <h2 className="mb-6 text-xl font-semibold">
                <Trans
                  i18nKey="account:personalSettings"
                  defaults="Personal Settings"
                />
              </h2>

              <div className="space-y-6">
                {/* Multi-Factor Authentication */}
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <Trans i18nKey={'account:multiFactorAuth'} />
                    </CardTitle>
                    <CardDescription>
                      <Trans i18nKey={'account:multiFactorAuthDescription'} />
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <MultiFactorAuthFactorsList userId={user.id} />
                  </CardContent>
                </Card>

                {/* Password Update */}
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <Trans i18nKey={'account:updatePasswordCardTitle'} />
                    </CardTitle>
                    <CardDescription>
                      <Trans
                        i18nKey={'account:updatePasswordCardDescription'}
                      />
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <UpdatePasswordFormContainer callbackPath={callbackPath} />
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </div>
      </PageBody>
    </>
  );
}

export default TeamAccountSettingsPage;
