import { ProfileAccountDropdownContainer } from '~/components/personal-account-dropdown-container';
import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';

export default async function TeamsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Ensure user is authenticated
  const user = await requireUserInServerComponent();

  // Someone with no team lands here (KB-99): the user menu is their way to
  // profile settings and to sign out (KB-100).
  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
      <div className="flex justify-end p-4">
        <ProfileAccountDropdownContainer user={user} showProfileName={false} />
      </div>

      {children}
    </div>
  );
}
