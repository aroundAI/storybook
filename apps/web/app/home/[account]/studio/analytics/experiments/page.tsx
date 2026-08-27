import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { createTeamAccountsApi } from '@kit/team-accounts/api';
import { Heading } from '@kit/ui/heading';

import { withI18n } from '~/lib/i18n/with-i18n';

import { ExperimentsClient } from './_components/experiments-client';

export const metadata = {
  title: 'Experiment Log | Film Studio',
  description:
    'Record what you changed, what you expected, and what actually happened',
};

interface PageProps {
  params: Promise<{ account: string }>;
}

async function ExperimentsPage({ params }: PageProps) {
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

  return (
    <div className={'container mx-auto flex flex-col gap-6 py-8'}>
      <div className={'flex flex-col gap-1'}>
        <Heading level={2}>Experiment log</Heading>
        <p className={'text-muted-foreground text-sm'}>
          Analytics tell you what the numbers did, not what you changed. Log
          each deliberate change with its expected result — metric baselines
          are captured automatically so the comparison is honest.
        </p>
      </div>

      <ExperimentsClient accountId={accountData.id} />
    </div>
  );
}

export default withI18n(ExperimentsPage);
