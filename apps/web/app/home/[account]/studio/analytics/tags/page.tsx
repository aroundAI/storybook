import { resolveTagMinSample } from '@kit/content-analytics/lib/ypp-targets';
import { fetchAccountAnalyticsSettings } from '@kit/content-analytics/server';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { createTeamAccountsApi } from '@kit/team-accounts/api';
import { Heading } from '@kit/ui/heading';

import { withI18n } from '~/lib/i18n/with-i18n';

import { TagManagerClient } from './_components/tag-manager-client';
import { TagMediansPanel } from './_components/tag-medians-panel';

export const metadata = {
  title: 'Content Tags | Film Studio',
  description:
    'Define the topic, format and thumbnail vocabulary used for tag-level performance analysis',
};

interface PageProps {
  params: Promise<{ account: string }>;
}

async function ContentTagsPage({ params }: PageProps) {
  const { account } = await params;

  const client = getSupabaseServerClient();
  const api = createTeamAccountsApi(client);
  const accountData = await api.getTeamAccount(account);

  if (!accountData) {
    return (
      <div className={'container mx-auto py-8'}>
        <div className={'text-center'}>
          <Heading level={2}>Account not found</Heading>
          <p className={'text-muted-foreground mt-2'}>
            The requested account could not be found.
          </p>
        </div>
      </div>
    );
  }

  const [{ data: tags }, settings] = await Promise.all([
    client
      .from('content_tags')
      .select('id, dimension, slug, label')
      .eq('account_id', accountData.id)
      .order('dimension')
      .order('label'),
    // Swallowed on purpose: this read throws by contract, so that the
    // settings *form* cannot upsert blanks over real values. Here it only
    // supplies a median panel's cut-off, and letting it throw would take the
    // whole Content Tags page — the tag manager included — down with it.
    // `resolveTagMinSample(null)` is the shipped default.
    fetchAccountAnalyticsSettings(accountData.id, client).catch(() => null),
  ]);

  return (
    <div className={'container mx-auto flex flex-col gap-6 py-8'}>
      <div className={'flex flex-col gap-1'}>
        <Heading level={2}>Content tags</Heading>
        <p className={'text-muted-foreground text-sm'}>
          Tag videos by topic, format and thumbnail style to compare median
          performance across your library. Individual videos are mostly luck;
          tag medians across 30+ videos are signal.
        </p>
      </div>

      <TagMediansPanel
        accountId={accountData.id}
        minVideos={resolveTagMinSample(settings)}
      />

      <TagManagerClient accountId={accountData.id} initialTags={tags ?? []} />
    </div>
  );
}

export default withI18n(ContentTagsPage);
