import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { createTeamAccountsApi } from '@kit/team-accounts/api';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import { createI18nServerInstance } from '~/lib/i18n/i18n.server';

import { TeamAccountLayoutPageHeader } from '../../_components/team-account-layout-page-header';
import { PublicProfileSettingsForm } from './_components/public-profile-form';

export const generateMetadata = async () => {
  const i18n = await createI18nServerInstance();
  const title = i18n.t('teams:publicProfile.pageTitle', {
    defaultValue: 'Public Profile',
  });

  return {
    title,
  };
};

interface PageProps {
  params: Promise<{ account: string }>;
}

async function PublicProfileSettingsPage(props: PageProps) {
  const client = getSupabaseServerClient();
  const api = createTeamAccountsApi(client);
  const slug = (await props.params).account;
  const accountData = await api.getTeamAccount(slug);

  // Fetch current public_profile
  const { data: account } = await client
    .from('accounts')
    .select('id, name, slug, picture_url, public_profile')
    .eq('id', accountData.id)
    .single();

  const publicProfile = (account?.public_profile as Record<
    string,
    unknown
  >) || {
    is_public: false,
    display_name: '',
    bio: '',
    website_url: '',
    social_links: {},
    custom_styles: {},
  };

  return (
    <>
      <TeamAccountLayoutPageHeader
        account={slug}
        title={
          <Trans
            i18nKey="teams:publicProfile.pageTitle"
            defaults="Public Profile"
          />
        }
        description={<AppBreadcrumbs />}
      />

      <PageBody>
        <div className="flex max-w-2xl flex-1 flex-col space-y-8">
          <div>
            <h2 className="mb-2 text-xl font-semibold">
              <Trans
                i18nKey="teams:publicProfile.title"
                defaults="Public Sharing Settings"
              />
            </h2>
            <p className="text-muted-foreground mb-6 text-sm">
              <Trans
                i18nKey="teams:publicProfile.description"
                defaults="Configure how your company appears on public pages"
              />
            </p>

            <PublicProfileSettingsForm
              accountId={accountData.id}
              accountName={accountData.name}
              accountSlug={slug}
              currentProfile={publicProfile}
            />
          </div>
        </div>
      </PageBody>
    </>
  );
}

export default PublicProfileSettingsPage;
