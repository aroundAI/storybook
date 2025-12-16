import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';

export default async function TeamsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Ensure user is authenticated
  await requireUserInServerComponent();

  return (
    <div className="from-background to-muted/20 min-h-screen bg-gradient-to-br">
      {children}
    </div>
  );
}
