import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import { PlatformConnectFailure } from '~/components/platform-connect-failure';
import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import { withI18n } from '~/lib/i18n/with-i18n';
import {
  connectFailurePath,
  readConnectFailure,
} from '~/lib/platforms/connect-failure';

// local imports
import { HomeLayoutPageHeader } from './_components/home-page-header';

export const generateMetadata = async () => {
  const i18n = await createI18nServerInstance();
  const title = i18n.t('account:homePage');

  return {
    title,
  };
};

interface UserHomePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function UserHomePage(props: UserHomePageProps) {
  // A failed platform connect lands here when no workspace could be chosen
  // for it (KB-19); the message must not be lost on the way.
  const failure = readConnectFailure(await props.searchParams);

  return (
    <>
      <HomeLayoutPageHeader
        title={<Trans i18nKey={'common:routes.home'} />}
        description={<Trans i18nKey={'common:homeTabDescription'} />}
      />

      <PageBody>
        {failure && (
          <div className="max-w-4xl">
            <PlatformConnectFailure
              failure={failure}
              dismissHref={connectFailurePath(null)}
            />
          </div>
        )}
      </PageBody>
    </>
  );
}

export default withI18n(UserHomePage);
