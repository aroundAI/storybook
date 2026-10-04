import { Palette } from 'lucide-react';

import { readStoredBrand } from '@kit/desktop-integration';

import { withI18n } from '~/lib/i18n/with-i18n';

import { SettingsSubpageHeader } from '../_components/settings-subpage-header';
import {
  loadProjectAssetChoices,
  loadStudioSettingsProject,
} from '../_lib/server/load-studio-settings-project';
import { BrandSettingsForm } from './_components/brand-settings-form';

interface BrandSettingsPageProps {
  params: Promise<{ account: string; projectSlug: string }>;
}

export const metadata = {
  title: 'Brand',
  description:
    "The project's fonts, colours, caption style, logo, intro and outro, which the StorybookStudio editor applies.",
};

async function BrandSettingsPage({ params }: BrandSettingsPageProps) {
  const { account, projectSlug } = await params;
  const { project, canManage } = await loadStudioSettingsProject(
    account,
    projectSlug,
  );
  const assets = await loadProjectAssetChoices(project.id);
  const { value: brand, issues } = readStoredBrand(project.brand);

  return (
    <>
      <SettingsSubpageHeader
        account={account}
        projectSlug={projectSlug}
        projectName={project.name}
        title="Brand"
        icon={<Palette className="h-5 w-5 text-muted-foreground" />}
        canManage={canManage}
        description={
          <>
            The StorybookStudio editor styles captions, graphics and transitions
            with these values. Fields you never set use the defaults shown.
            {issues.length > 0
              ? ' The stored brand did not validate, so the defaults are shown; saving replaces it.'
              : null}
          </>
        }
      />
      <div className="mx-auto max-w-6xl p-6">
        <BrandSettingsForm
          projectId={project.id}
          brand={brand}
          assets={assets}
          canManage={canManage}
        />
      </div>
    </>
  );
}

export default withI18n(BrandSettingsPage);
