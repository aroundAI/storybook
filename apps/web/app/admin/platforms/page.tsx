import { headers } from 'next/headers';

import { AdminGuard } from '@kit/admin/components/admin-guard';
import { GlobalOAuthAppConfig } from '@kit/publishing/components';
import { getGlobalOAuthApps } from '@kit/publishing/server/queries';
import { PageBody, PageHeader } from '@kit/ui/page';

export const metadata = {
  title: 'Platform Credentials | Super Admin',
};

async function AdminPlatformsPage() {
  // Get the app URL from headers
  const headersList = await headers();
  const host = headersList.get('host') ?? 'localhost:3000';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const appUrl = `${protocol}://${host}`;

  // Fetch existing global OAuth apps
  const existingApps = await getGlobalOAuthApps();

  return (
    <>
      <PageHeader
        title="Platform Credentials"
        description="Configure OAuth credentials for YouTube, TikTok, and Meta integrations. These settings apply globally to all users."
      />

      <PageBody>
        <div className="flex max-w-4xl flex-1 flex-col">
          <GlobalOAuthAppConfig existingApps={existingApps} appUrl={appUrl} />
        </div>
      </PageBody>
    </>
  );
}

export default AdminGuard(AdminPlatformsPage);
