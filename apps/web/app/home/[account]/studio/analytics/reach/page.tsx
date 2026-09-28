import { notFound } from 'next/navigation';

import {
  ReachOverviewView,
  type ReachTab,
  type ReachView,
} from '@kit/content-analytics/components/reach';
import {
  isAnalyticsPlatform,
  parseReachWindow,
} from '@kit/content-analytics/lib/reach-overview';
import { loadReachOverview } from '@kit/content-analytics/server/reach-overview';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { createTeamAccountsApi } from '@kit/team-accounts/api';
import { Heading } from '@kit/ui/heading';

import { withI18n } from '~/lib/i18n/with-i18n';

export const metadata = {
  title: 'Reach and engagement | Film Studio',
  description:
    'Accounts reached, views, comments and shares per channel and per post, for 7, 30 and 90 days',
};

interface PageProps {
  params: Promise<{ account: string }>;
  searchParams: Promise<{ tab?: string; view?: string; window?: string }>;
}

async function ReachPage({ params, searchParams }: PageProps) {
  const { account } = await params;
  const query = await searchParams;

  const api = createTeamAccountsApi(getSupabaseServerClient());
  const accountData = await api.getTeamAccount(account);

  if (!accountData) notFound();

  const window = parseReachWindow(query.window);
  const tab: ReachTab =
    query.tab && isAnalyticsPlatform(query.tab) ? query.tab : 'all';
  const view: ReachView = query.view === 'posts' ? 'posts' : 'channel';

  const overview = await loadReachOverview({
    accountId: accountData.id,
    window,
  });

  return (
    <div className="container mx-auto flex flex-col gap-6 py-8">
      <Heading level={2}>Reach and engagement</Heading>
      <ReachOverviewView
        overview={overview}
        tab={tab}
        view={view}
        basePath={`/home/${account}/studio/analytics/reach`}
      />
    </div>
  );
}

export default withI18n(ReachPage);
