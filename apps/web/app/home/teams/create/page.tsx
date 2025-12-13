import { PageBody, PageHeader } from '@kit/ui/page';

import { withI18n } from '~/lib/i18n/with-i18n';

import { CreateTeamPrompt } from './_components/create-team-form';

function CreateTeamPage() {
    return (
        <>
            <PageHeader
                title="Welcome to StoryBook"
                description="Create a team to get started with your projects."
            />
            <PageBody>
                <div className="flex min-h-[60vh] items-center justify-center py-8">
                    <CreateTeamPrompt />
                </div>
            </PageBody>
        </>
    );
}

export default withI18n(CreateTeamPage);
