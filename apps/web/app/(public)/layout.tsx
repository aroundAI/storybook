import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { SiteFooter } from '~/(marketing)/_components/site-footer';
import { SiteHeader } from '~/(marketing)/_components/site-header';

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const client = getSupabaseServerClient();
  const user = await requireUser(client, { verifyMfa: false });

  return (
    <div className="flex min-h-screen flex-col bg-white font-sans dark:bg-slate-950">
      {/* Reuse the same header as marketing page for consistency */}
      <SiteHeader user={user.data} />

      {/* Main Content */}
      <main className="flex flex-1 flex-col">{children}</main>

      {/* Reuse the same footer as marketing page */}
      <SiteFooter />
    </div>
  );
}
