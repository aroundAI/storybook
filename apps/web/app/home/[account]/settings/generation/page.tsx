import { GenerationSettingsForm } from '@kit/film-studio/components';
import { getGenerationSettings } from '@kit/film-studio/server';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import { createI18nServerInstance } from '~/lib/i18n/i18n.server';

import { TeamAccountLayoutPageHeader } from '../../_components/team-account-layout-page-header';
import { loadTeamWorkspace } from '../../_lib/server/team-account-workspace.loader';

export const generateMetadata = async () => {
  const i18n = await createI18nServerInstance();
  const title = i18n.t('generation:settings.pageTitle');

  return {
    title,
  };
};

interface GenerationSettingsPageProps {
  params: Promise<{ account: string }>;
}

async function GenerationSettingsPage(props: GenerationSettingsPageProps) {
  const slug = (await props.params).account;
  const workspace = await loadTeamWorkspace(slug);
  const accountId = workspace.account.id;

  const settings = await getGenerationSettings(accountId);

  return (
    <>
      <TeamAccountLayoutPageHeader
        account={slug}
        title={<Trans i18nKey="generation:settings.pageTitle" />}
        description={<AppBreadcrumbs />}
      />

      <PageBody>
        <div className="flex max-w-2xl flex-1 flex-col">
          <GenerationSettingsForm settings={settings} accountId={accountId} />
        </div>
      </PageBody>
    </>
  );
}

export default GenerationSettingsPage;
