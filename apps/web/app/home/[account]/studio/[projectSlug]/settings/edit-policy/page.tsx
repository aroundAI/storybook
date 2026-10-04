import { SlidersHorizontal } from 'lucide-react';

import { readStoredEditPolicy } from '@kit/desktop-integration';

import { withI18n } from '~/lib/i18n/with-i18n';

import { SettingsSubpageHeader } from '../_components/settings-subpage-header';
import { loadStudioSettingsProject } from '../_lib/server/load-studio-settings-project';
import { EditPolicySettingsForm } from './_components/edit-policy-settings-form';

interface EditPolicySettingsPageProps {
  params: Promise<{ account: string; projectSlug: string }>;
}

export const metadata = {
  title: 'Edit policy',
  description:
    'The rules the StorybookStudio AI editor follows on every run: shot lengths, transitions, music ducking, captions and loudness.',
};

async function EditPolicySettingsPage({ params }: EditPolicySettingsPageProps) {
  const { account, projectSlug } = await params;
  const { project, canManage } = await loadStudioSettingsProject(
    account,
    projectSlug,
  );
  const { value: editPolicy, issues } = readStoredEditPolicy(
    project.edit_policy,
  );

  return (
    <>
      <SettingsSubpageHeader
        account={account}
        projectSlug={projectSlug}
        projectName={project.name}
        title="Edit policy"
        icon={<SlidersHorizontal className="h-5 w-5 text-muted-foreground" />}
        canManage={canManage}
        description={
          <>
            The StorybookStudio AI editor follows these rules on every run, and
            its critic checks the cut against them.
            {issues.length > 0
              ? ' The stored policy did not validate, so the defaults are shown; saving replaces it.'
              : null}
          </>
        }
      />
      <div className="mx-auto max-w-4xl p-6">
        <EditPolicySettingsForm
          projectId={project.id}
          editPolicy={editPolicy}
          canManage={canManage}
        />
      </div>
    </>
  );
}

export default withI18n(EditPolicySettingsPage);
