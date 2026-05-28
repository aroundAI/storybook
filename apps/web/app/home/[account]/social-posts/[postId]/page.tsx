import { Suspense } from 'react';

import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import { withI18n } from '~/lib/i18n/with-i18n';

import { TeamAccountLayoutPageHeader } from '../../_components/team-account-layout-page-header';
import { loadTeamWorkspace } from '../../_lib/server/team-account-workspace.loader';
import { SocialPostDetail } from './_components/social-post-detail';
import { SocialPostDetailSkeleton } from './_components/social-post-detail-skeleton';

interface SocialPostDetailPageProps {
  params: Promise<{ account: string; postId: string }>;
}

export const generateMetadata = async () => {
  const i18n = await createI18nServerInstance();

  return {
    title: i18n.t('common:routes.socialPostDetail'),
  };
};

async function SocialPostDetailPage({ params }: SocialPostDetailPageProps) {
  const { account, postId } = await params;
  const workspace = await loadTeamWorkspace(account);

  return (
    <>
      <TeamAccountLayoutPageHeader
        account={account}
        title={<Trans i18nKey={'common:routes.socialPostDetail'} />}
        description={<AppBreadcrumbs />}
      />

      <PageBody>
        <Suspense fallback={<SocialPostDetailSkeleton />}>
          <SocialPostDetail
            postId={postId}
            accountSlug={account}
            accountId={workspace.account.id}
          />
        </Suspense>
      </PageBody>
    </>
  );
}

export default withI18n(SocialPostDetailPage);
