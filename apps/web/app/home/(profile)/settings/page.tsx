import { use } from 'react';

import { PersonalAccountSettingsContainer } from '@kit/accounts/personal-account-settings';
import { PageBody } from '@kit/ui/page';

import { PlatformConnectFailure } from '~/components/platform-connect-failure';
import authConfig from '~/config/auth.config';
import featureFlagsConfig from '~/config/feature-flags.config';
import pathsConfig from '~/config/paths.config';
import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import { withI18n } from '~/lib/i18n/with-i18n';
import {
  NO_CHOSEN_TEAM_FAILURE_PATH,
  readConnectFailure,
} from '~/lib/platforms/connect-failure';
import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';

const features = {
  enableAccountDeletion: featureFlagsConfig.enableAccountDeletion,
  enablePasswordUpdate: authConfig.providers.password,
  enableAccountLinking: authConfig.enableIdentityLinking,
};

const providers = authConfig.providers.oAuth;

const callbackPath = pathsConfig.auth.callback;
const accountHomePath = pathsConfig.app.accountHome;

const paths = {
  callback: callbackPath + `?next=${accountHomePath}`,
};

export const generateMetadata = async () => {
  const i18n = await createI18nServerInstance();
  const title = i18n.t('account:settingsTab');

  return {
    title,
  };
};

interface PersonalAccountSettingsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function PersonalAccountSettingsPage(props: PersonalAccountSettingsPageProps) {
  const user = use(requireUserInServerComponent());

  // A failed platform connect that could not be placed in one of several
  // teams is shown here, the one page every signed-in person can reach
  // (KB-19, KB-99).
  const failure = readConnectFailure(use(props.searchParams));

  return (
    <PageBody>
      <div className={'flex w-full flex-1 flex-col lg:max-w-2xl'}>
        {failure && (
          <PlatformConnectFailure
            failure={failure}
            dismissHref={NO_CHOSEN_TEAM_FAILURE_PATH}
          />
        )}

        <PersonalAccountSettingsContainer
          userId={user.id}
          features={features}
          paths={paths}
          providers={providers}
        />
      </div>
    </PageBody>
  );
}

export default withI18n(PersonalAccountSettingsPage);
