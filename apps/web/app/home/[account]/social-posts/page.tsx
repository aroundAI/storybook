import { Suspense } from 'react';

import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import { withI18n } from '~/lib/i18n/with-i18n';

import { TeamAccountLayoutPageHeader } from '../_components/team-account-layout-page-header';
import { loadTeamWorkspace } from '../_lib/server/team-account-workspace.loader';
import { SocialPostsDashboard } from './_components/social-posts-dashboard';
import { SocialPostsSkeleton } from './_components/social-posts-skeleton';

interface SocialPostsPageProps {
  params: Promise<{ account: string }>;
}

export const generateMetadata = async () => {
  const i18n = await createI18nServerInstance();

  return {
    title: i18n.t('common:routes.socialPosts'),
  };
};

async function SocialPostsPage({ params }: SocialPostsPageProps) {
  const account = (await params).account;
  const workspace = await loadTeamWorkspace(account);

  return (
    <>
      <TeamAccountLayoutPageHeader
        account={account}
        title={<Trans i18nKey={'common:routes.socialPosts'} />}
        description={<AppBreadcrumbs />}
      />

      <PageBody>
        <Suspense fallback={<SocialPostsSkeleton />}>
          <SocialPostsDashboard
            accountId={workspace.account.id}
            accountSlug={account}
          />
        </Suspense>
      </PageBody>
    </>
  );
}

export default withI18n(SocialPostsPage);
