import { PageBody, PageHeader } from '@kit/ui/page';

import { PlatformConnectFailure } from '~/components/platform-connect-failure';
import { withI18n } from '~/lib/i18n/with-i18n';
import {
  NO_TEAM_FAILURE_PATH,
  readConnectFailure,
} from '~/lib/platforms/connect-failure';

import { CreateTeamPrompt } from './_components/create-team-form';

interface CreateTeamPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function CreateTeamPage(props: CreateTeamPageProps) {
  // A failed platform connect for someone with no team lands here (KB-19,
  // KB-99): the message must not be lost on the way.
  const failure = readConnectFailure(await props.searchParams);

  return (
    <>
      <PageHeader
        title="Welcome to StoryBook"
        description="Create a team to get started with your projects."
      />
      <PageBody>
        {failure && (
          <div className="max-w-4xl">
            <PlatformConnectFailure
              failure={failure}
              dismissHref={NO_TEAM_FAILURE_PATH}
            />
          </div>
        )}

        <div className="flex min-h-[60vh] items-center justify-center py-8">
          <CreateTeamPrompt />
        </div>
      </PageBody>
    </>
  );
}

export default withI18n(CreateTeamPage);
