import { use } from 'react';

import { redirect } from 'next/navigation';

import featureFlagsConfig from '~/config/feature-flags.config';
import { withI18n } from '~/lib/i18n/with-i18n';

import { UserHomeShell } from './_components/user-home-shell';
import { loadUserWorkspace } from './_lib/server/load-user-workspace';

function UserHomeLayout({ children }: React.PropsWithChildren) {
  // Team accounts only (KB-99): the personal home, projects and billing pages
  // send the user to their team. Profile settings live outside this group, in
  // `(profile)`, so they stay reachable (KB-100).
  if (!featureFlagsConfig.enablePersonalAccounts) {
    const workspace = use(loadUserWorkspace());

    // If user has team accounts, redirect to the first one
    // Note: accounts have { label, value (slug), image }
    if (workspace.accounts && workspace.accounts.length > 0) {
      const firstTeam = workspace.accounts[0];
      if (firstTeam?.value) {
        redirect(`/home/${firstTeam.value}`);
      }
    }

    // If no team accounts, redirect to create team
    redirect('/home/teams/create');
  }

  return <UserHomeShell>{children}</UserHomeShell>;
}

export default withI18n(UserHomeLayout);
