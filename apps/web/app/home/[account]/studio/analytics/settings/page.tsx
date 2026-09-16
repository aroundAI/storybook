import { getAnalyticsSettingsAction } from '@kit/content-analytics/server/settings-actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { createTeamAccountsApi } from '@kit/team-accounts/api';
import { Heading } from '@kit/ui/heading';

import { withI18n } from '~/lib/i18n/with-i18n';

import { AccountTargetsForm } from './_components/account-targets-form';
import { ChannelTargetsForm } from './_components/channel-targets-form';

export const metadata = {
  title: 'Analytics Settings | Film Studio',
  description:
    'Set the YouTube Partner Programme targets analytics measures each channel against',
};

interface PageProps {
  params: Promise<{ account: string }>;
}

async function AnalyticsSettingsPage({ params }: PageProps) {
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

  const settings = await getAnalyticsSettingsAction({
    accountId: accountData.id,
  });

  return (
    <div className={'container mx-auto flex max-w-3xl flex-col gap-8 py-8'}>
      <div className={'flex flex-col gap-2'}>
        <Heading level={2}>Analytics settings</Heading>
        <p className={'text-muted-foreground text-sm'}>
          The Partner Programme gate is per channel, so these targets are too. A
          channel resolves its target from its own value, then the account
          default, then the shipped default.
        </p>
      </div>

      <AccountTargetsForm
        accountId={accountData.id}
        initial={{
          yppTargetWatchHours:
            settings.accountSettings?.ypp_target_watch_hours ?? null,
          yppTargetSubscribers:
            settings.accountSettings?.ypp_target_subscribers ?? null,
          tagMinSample: settings.accountSettings?.tag_min_sample ?? null,
        }}
      />

      <div className={'flex flex-col gap-4'}>
        <Heading level={4}>Channels</Heading>

        {settings.channels.length === 0 ? (
          <p
            className={'text-muted-foreground text-sm'}
            data-test={'no-channels'}
          >
            No active YouTube channels are connected to this account. Connect
            one to set a per-channel target.
          </p>
        ) : (
          settings.channels.map((channel) => (
            <ChannelTargetsForm
              key={channel.connectionId}
              channel={channel}
              // Raw, including null. The form passes these straight to the
              // resolver, which distinguishes "the account set nothing" from
              // "the account set the default" — collapsing the two here is
              // what made the override warning fire on every fresh account.
              accountWatchHours={
                settings.accountSettings?.ypp_target_watch_hours ?? null
              }
              accountSubscribers={
                settings.accountSettings?.ypp_target_subscribers ?? null
              }
            />
          ))
        )}
      </div>
    </div>
  );
}

export default withI18n(AnalyticsSettingsPage);
