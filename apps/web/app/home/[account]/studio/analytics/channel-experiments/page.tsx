import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { createTeamAccountsApi } from '@kit/team-accounts/api';
import { Heading } from '@kit/ui/heading';

import { withI18n } from '~/lib/i18n/with-i18n';

import { ChannelExperimentsClient } from './_components/channel-experiments-client';

export const metadata = {
  title: 'Channel Experiments | Film Studio',
  description:
    'Tag new uploads by style and see which styles work on your channel, each video measured at the same age',
};

interface PageProps {
  params: Promise<{ account: string }>;
}

async function ChannelExperimentsPage({ params }: PageProps) {
  const { account } = await params;

  const client = getSupabaseServerClient();
  const api = createTeamAccountsApi(client);
  const accountData = await api.getTeamAccount(account);

  if (!accountData) {
    return (
      <div className={'container mx-auto py-8'}>
        <div className={'text-center'}>
          <Heading level={2}>Account not found</Heading>
          <p className={'mt-2 text-muted-foreground'}>
            The requested account could not be found.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={'container mx-auto flex flex-col gap-6 py-8'}>
      <div className={'flex flex-col gap-1'}>
        <Heading level={2}>Channel experiments</Heading>
        <p className={'max-w-3xl text-sm text-muted-foreground'}>
          Make new videos in two to eight styles, tag each upload with its
          style, and compare the styles on one channel, every video measured at
          the same age. To compare the same videos before and after a change,
          use the Change log instead.
        </p>
      </div>

      <ChannelExperimentsClient accountId={accountData.id} />
    </div>
  );
}

export default withI18n(ChannelExperimentsPage);
