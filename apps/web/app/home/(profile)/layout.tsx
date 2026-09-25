import { withI18n } from '~/lib/i18n/with-i18n';

import { UserHomeShell } from '../(user)/_components/user-home-shell';

/**
 * Profile settings (password, email, MFA, linked accounts, avatar, account
 * deletion) belong to the person, not to a workspace, so they sit outside
 * `(user)`, whose layout sends everyone to their team when personal accounts
 * are off (KB-99). Before this group existed, production could not reach
 * `/home/settings` at all (KB-100).
 */
function ProfileLayout({ children }: React.PropsWithChildren) {
  return <UserHomeShell>{children}</UserHomeShell>;
}

export default withI18n(ProfileLayout);
