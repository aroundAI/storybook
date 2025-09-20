import { EnvMode } from '@/app/variables/lib/types';
import { EnvModeSelector } from '@/components/env-mode-selector';
import { ServiceCard } from '@/components/status-tile';

import { Page, PageBody, PageHeader } from '@kit/ui/page';

import { createConnectivityService } from './lib/connectivity-service';

type DashboardPageProps = React.PropsWithChildren<{
  searchParams: Promise<{ mode?: EnvMode }>;
}>;

export default async function DashboardPage(props: DashboardPageProps) {
  const mode = (await props.searchParams).mode ?? 'development';
  const connectivityService = createConnectivityService(mode);

  const [supabaseStatus, supabaseAdminStatus, stripeStatus] = await Promise.all(
    [
      connectivityService.checkSupabaseConnectivity(),
      connectivityService.checkSupabaseAdminConnectivity(),
      connectivityService.checkStripeConnected(),
    ],
  );

  return (
    <Page style={'custom'}>
      <PageHeader
        displaySidebarTrigger={false}
        title={'Dev Tool'}
        description={'Check the status of your Supabase and Stripe services'}
      >
        <EnvModeSelector mode={mode} />
      </PageHeader>

      <PageBody className={'space-y-8 py-2'}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <ServiceCard name={'Supabase API'} status={supabaseStatus} />
          <ServiceCard name={'Supabase Admin'} status={supabaseAdminStatus} />
          <ServiceCard name={'Stripe API'} status={stripeStatus} />
        </div>
      </PageBody>
    </Page>
  );
}
